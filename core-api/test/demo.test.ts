import { createHmac } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDemo } from "../dev/demo.ts";
import { startMockBot, type MockBot } from "../dev/mock-bot.ts";
import { sendInbound, sendTwice, startWahaServer, type SimConfig, type WahaServer } from "../dev/waha-sim.ts";
import { buildApp, type BuiltApp } from "../src/app.ts";
import { startBackground } from "../src/background.ts";
import type { FetchLike } from "../src/bot.ts";
import { loadConfig } from "../src/config.ts";
import { createDb, type Db } from "../src/db.ts";
import { signBotRequest } from "../src/signature.ts";
import { channelSecret } from "./app-helpers.ts";
import { ownerClient, TEST_DB } from "./helpers.ts";

/**
 * The demo against a real, listening core-api: real HTTP between the simulator, core-api and the scripted
 * bot, real database. Only WhatsApp (the simulator) and Claude (the scripted bot) are replaced.
 */
describe("demo with the scripted bot", () => {
  let waha: WahaServer;
  let mock: MockBot;
  let app: BuiltApp;
  let db: Db;
  let owner: pg.Client;
  let stop: () => void;
  let sim: SimConfig;
  let coreApiUrl: string;
  const env: NodeJS.ProcessEnv = {};

  beforeAll(async () => {
    owner = await ownerClient();
    await owner.query(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
       values (1, 'waha', 'demo', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', false) on conflict (provider, identifier) do nothing`,
    );
    waha = await startWahaServer({ port: 0, apiKey: "k".repeat(32) });
    Object.assign(env, process.env, {
      NODE_ENV: "test",
      PGDATABASE: TEST_DB,
      POSTGREST_URL: "http://127.0.0.1:55301",
      WAHA_BASE_URL: waha.url,
      WAHA_API_KEY: "k".repeat(32),
      OUTBOX_PACE_MIN_MS: "0",
      OUTBOX_PACE_MAX_MS: "0",
      LOG_LEVEL: "silent",
    });
    const config = loadConfig(env);
    db = createDb(config);
    const http: FetchLike = (url, init) => fetch(url, init);
    app = buildApp({
      config,
      env,
      db,
      fetch: http,
      outboxFetch: http,
      proxyFetch: (url, init) => fetch(url, init),
      now: () => new Date(),
      logger: false,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    coreApiUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    mock = await startMockBot({ port: 0, coreApiUrl, botHmacSecret: env.BOT_HMAC_SECRET! });
    env.BOT_URL_JAVIER = mock.url;
    stop = startBackground(
      {
        app,
        db,
        bot: { config, env, db, fetch: http, log: app.log, now: () => new Date() },
        outbox: { config, db, fetch: http, log: app.log, sleep: async () => {}, random: () => 0 },
      },
      { outboxMs: 100, sweepMs: 60_000, expiryMs: 60_000 },
    );
    sim = { coreApiUrl, session: "demo", hmacSecret: channelSecret() };
  });
  afterAll(async () => {
    stop();
    await app.close();
    await app.idle();
    await db.close();
    await mock.close();
    await waha.close();
    await owner.end();
  });

  it("runs every step of the demo and every check passes", async () => {
    const lines: string[] = [];
    const { checks } = await runDemo({ sim, waha, db: owner, print: (line) => lines.push(line) });

    const failed = checks.filter((entry) => !entry.ok).map((entry) => entry.label);
    expect(failed, lines.join("\n")).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(40);
    // The narration names all the steps the demo promises.
    const story = lines.join("\n");
    for (const title of ["Cliente nuevo", "El cliente vuelve", "Cotización", "Horarios libres, reserva y confirmación", "cruce rechazado", "Escalar", "Prueba X", "Número reasignado"]) {
      expect(story).toContain(title);
    }
  }, 180_000);

  it("never lets the review stop the scripted bot: its replies are all legitimate", async () => {
    // Only the demo channel: other test files write rejected replies to this same database at the same time.
    const rejected = await owner.query(
      `select count(*)::int as n from core.reply_reviews r
         join core.conversations c on c.id = r.conversation_id
         join core.channels ch on ch.id = c.channel_id
        where ch.identifier = 'demo' and r.created_at > now() - interval '10 minutes'`,
    );
    expect(rejected.rows[0].n).toBe(0);
    expect(mock.calls.filter((call) => call.path === "responder" && call.status === 422)).toEqual([]);
  });

  it("uses only the tools, with a token, and never gets a 401", async () => {
    expect(mock.calls.length).toBeGreaterThan(30);
    expect(mock.calls.filter((call) => call.status === 401)).toEqual([]);
    for (const tool of ["ficha", "guardar_datos", "cotizar", "horarios_libres", "reservar", "confirmar", "escalar", "responder", "confirmar_titular"]) {
      expect(mock.calls.some((call) => call.path === tool), tool).toBe(true);
    }
  });
});

describe("the simulator and the scripted bot as tools", () => {
  let waha: WahaServer;

  beforeAll(async () => {
    waha = await startWahaServer({ port: 0, apiKey: "s".repeat(32) });
  });
  afterAll(() => waha.close());

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${waha.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("keeps what core-api sends to a chat, in order, and waits for it", async () => {
    const headers = { "x-api-key": "s".repeat(32) };
    await post("/api/sendText", { session: "s", chatId: "12025550001@c.us", text: "uno" }, headers);
    await post("/api/sendText", { session: "s", chatId: "12025550001@c.us", text: "dos" }, headers);
    await post("/api/sendText", { session: "s", chatId: "12025550002@c.us", text: "otro" }, headers);
    expect(waha.to("12025550001").map((m) => m.text)).toEqual(["uno", "dos"]);
    await expect(waha.waitFor("12025550001", 2)).resolves.toHaveLength(2);
    await expect(waha.waitFor("12025550001", 3, 200)).rejects.toThrow(/timed out/);
  });

  it("refuses a wrong key, other routes and an invalid body, as WAHA would", async () => {
    expect((await post("/api/sendText", { session: "s", chatId: "x@c.us", text: "t" }, { "x-api-key": "wrong" })).status).toBe(401);
    expect((await post("/api/other", {}, { "x-api-key": "s".repeat(32) })).status).toBe(404);
    expect((await post("/api/sendText", { session: "s" }, { "x-api-key": "s".repeat(32) })).status).toBe(422);
  });

  it("signs deliveries over the exact bytes it sends, in hexadecimal SHA-512, with the timestamp in milliseconds", async () => {
    let seen: { raw: string; headers: Headers } | undefined;
    const server = await import("node:http").then(
      ({ createServer }) =>
        new Promise<import("node:http").Server>((resolve) => {
          const s = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (c: Buffer) => chunks.push(c));
            request.on("end", () => {
              seen = { raw: Buffer.concat(chunks).toString(), headers: new Headers(request.headers as Record<string, string>) };
              response.writeHead(200, { "content-type": "application/json" }).end('{"status":"accepted"}');
            });
          });
          s.listen(0, "127.0.0.1", () => resolve(s));
        }),
    );
    try {
      const port = (server.address() as { port: number }).port;
      const now = new Date("2030-06-01T12:00:00Z");
      await sendInbound({ coreApiUrl: `http://127.0.0.1:${port}`, session: "demo", hmacSecret: "h".repeat(40), now: () => now }, { phone: "12025550123", text: "Hola", pushName: "Ana" });

      expect(seen!.headers.get("x-webhook-hmac")).toBe(createHmac("sha512", "h".repeat(40)).update(seen!.raw).digest("hex"));
      expect(seen!.headers.get("x-webhook-hmac-algorithm")).toBe("sha512");
      expect(seen!.headers.get("x-webhook-timestamp")).toBe(String(now.getTime()));
      const body = JSON.parse(seen!.raw);
      expect(body).toMatchObject({ event: "message", session: "demo", payload: { from: "12025550123@c.us", fromMe: false, body: "Hola", _data: { Info: { PushName: "Ana" } } } });
      expect(body.payload.id).toMatch(/^false_12025550123@c\.us_[0-9A-F]{32}$/);
      expect(body.payload.timestamp).toBe(Math.floor(now.getTime() / 1000));
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("sends the same message id twice when asked, which is how a retry looks", async () => {
    const ids: string[] = [];
    const server = await import("node:http").then(
      ({ createServer }) =>
        new Promise<import("node:http").Server>((resolve) => {
          const s = createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (c: Buffer) => chunks.push(c));
            request.on("end", () => {
              ids.push(JSON.parse(Buffer.concat(chunks).toString()).payload.id);
              response.writeHead(200).end("{}");
            });
          });
          s.listen(0, "127.0.0.1", () => resolve(s));
        }),
    );
    try {
      const port = (server.address() as { port: number }).port;
      await sendTwice({ coreApiUrl: `http://127.0.0.1:${port}`, session: "demo", hmacSecret: "h".repeat(40) }, { phone: "12025550123", text: "Hola" });
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  describe("scripted bot", () => {
    let bot: MockBot;
    const secret = "b".repeat(40);

    beforeAll(async () => {
      bot = await startMockBot({ port: 0, coreApiUrl: "http://127.0.0.1:1", botHmacSecret: secret });
    });
    afterAll(() => bot.close());

    const call = (body: string, headers: Record<string, string>, url = bot.url) => fetch(url, { method: "POST", headers, body });
    const signed = (body: string, timestamp = Math.floor(Date.now() / 1000), key = secret) => ({
      "x-core-timestamp": String(timestamp),
      "x-core-signature": signBotRequest(key, timestamp, body),
    });

    it("answers 200 to a message that core-api signed, and 401 to anything else", async () => {
      const body = JSON.stringify({ token: "t", mensaje: { id: "msg_1", texto: "Hola" }, contacto: {}, historial: [] });
      expect((await call(body, signed(body))).status).toBe(200);
      expect((await call(body, signed(body, undefined, "x".repeat(40)))).status).toBe(401);
      expect((await call(body, signed(body, Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
      expect((await call(body, {})).status).toBe(401);
      expect((await call(`${body} `, signed(body))).status).toBe(401);
      expect((await call(body, signed(body), `${bot.url}x`)).status).toBe(401);
    });
  });
});
