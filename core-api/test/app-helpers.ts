import { createHmac, randomInt, randomUUID } from "node:crypto";
import { buildApp, type BuiltApp, type ProxyFetch } from "../src/app.ts";
import type { BotDeps, FetchLike } from "../src/bot.ts";
import type { OutboxDeps } from "../src/outbox.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { createDb, type Db } from "../src/db.ts";
import { loadLocalEnv, TEST_DB } from "./helpers.ts";

loadLocalEnv();

export const SESSION = "bytogam-pruebas";
export const NOW = new Date("2030-06-01T12:00:00Z");

export type Call = { url: string; headers: Record<string, string>; body: string };

export type TestApp = {
  app: BuiltApp;
  botDeps: BotDeps;
  outboxDeps: OutboxDeps;
  sleeps: number[];
  db: Db;
  config: Config;
  env: NodeJS.ProcessEnv;
  botCalls: Call[];
  wahaCalls: Call[];
  /** Replace what the fake bot answers: a status, "down" or a function that can wait. */
  botAnswers: { next: (call: Call) => Promise<{ ok: boolean; status: number }> };
  wahaAnswers: { next: (call: Call) => Promise<{ ok: boolean; status: number }> };
  clock: { now: Date };
  close: () => Promise<void>;
};

const testEnv = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: "test",
  PGDATABASE: TEST_DB,
  POSTGREST_URL: "http://127.0.0.1:55301",
  OUTBOX_PACE_MIN_MS: "0",
  OUTBOX_PACE_MAX_MS: "0",
  ADMIN_DEV_SUB: randomUUID(),
  BOT_URL_JAVIER: "http://bot.test/webhook/javier",
  WAHA_BASE_URL: "http://waha.test",
  ...overrides,
});

export const createTestApp = (overrides: Record<string, string | undefined> = {}): TestApp => {
  const env = testEnv(overrides);
  const config = loadConfig(env);
  const db = createDb(config);
  const clock = { now: new Date(NOW) };
  const botCalls: Call[] = [];
  const wahaCalls: Call[] = [];
  const botAnswers = { next: async (_call: Call) => ({ ok: true, status: 200 }) };
  const wahaAnswers = { next: async (_call: Call) => ({ ok: true, status: 201 }) };

  const record = (calls: Call[], answers: typeof botAnswers): FetchLike => async (url, init) => {
    const call = { url, headers: init.headers, body: init.body };
    calls.push(call);
    return answers.next(call);
  };

  const proxyFetch: ProxyFetch = (url, init) => fetch(url, init);
  const botFetch = record(botCalls, botAnswers);
  const wahaFetch = record(wahaCalls, wahaAnswers);
  const app = buildApp({
    config,
    env,
    db,
    fetch: botFetch,
    outboxFetch: wahaFetch,
    proxyFetch,
    now: () => clock.now,
  });

  const sleeps: number[] = [];
  const botDeps: BotDeps = { config, env, db, fetch: botFetch, log: app.log, now: () => clock.now };
  const outboxDeps: OutboxDeps = {
    config,
    db,
    fetch: wahaFetch,
    log: app.log,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  };

  return {
    app,
    botDeps,
    outboxDeps,
    sleeps,
    db,
    config,
    env,
    botCalls,
    wahaCalls,
    botAnswers,
    wahaAnswers,
    clock,
    close: async () => {
      await app.idle();
      await app.close();
      await db.close();
    },
  };
};

export const channelSecret = (): string => process.env.WAHA_HMAC_BYTOGAM_PRUEBAS!;

/** A fictional number in the NANP 202 area, unique per call. */
export const fakePhone = (): { digits: string; e164: string } => {
  const digits = `1202555${randomInt(1000, 9999)}`;
  return { digits, e164: `+${digits}` };
};

export type DeliveryOptions = {
  id?: string;
  from?: string;
  body?: string | null;
  session?: string;
  event?: string;
  fromMe?: boolean | string;
  senderAlt?: string;
  sender?: string;
  participant?: string;
  pushName?: string;
  hasMedia?: boolean;
  timestampSeconds?: number;
};

/** The envelope documented by WAHA, with the fields the Router of the TEST workflow reads. */
export const delivery = (options: DeliveryOptions = {}): Record<string, unknown> => {
  const phone = fakePhone();
  const from = options.from ?? `${phone.digits}@c.us`;
  return {
    event: options.event ?? "message",
    session: options.session ?? SESSION,
    engine: "WEBJS",
    payload: {
      id: options.id ?? `false_${from}_${randomUUID().replaceAll("-", "").toUpperCase()}`,
      timestamp: options.timestampSeconds ?? Math.floor(NOW.getTime() / 1000),
      from,
      fromMe: options.fromMe ?? false,
      ...(options.participant ? { participant: options.participant } : {}),
      body: options.body === undefined ? "Hola, quiero cotizar" : options.body,
      hasMedia: options.hasMedia ?? false,
      _data: { Info: { SenderAlt: options.senderAlt, Sender: options.sender, PushName: options.pushName } },
    },
  };
};

export type SignOptions = {
  secret?: string;
  timestampMs?: number;
  algorithmHeader?: string | null;
  signature?: string | null;
  signedBody?: string;
};

export const signHeaders = (raw: string, options: SignOptions = {}): Record<string, string> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature =
    options.signature === undefined
      ? createHmac("sha512", options.secret ?? channelSecret()).update(options.signedBody ?? raw).digest("hex")
      : options.signature;
  if (signature !== null) headers["x-webhook-hmac"] = signature;
  if (options.algorithmHeader !== null) headers["x-webhook-hmac-algorithm"] = options.algorithmHeader ?? "sha512";
  headers["x-webhook-timestamp"] = String(options.timestampMs ?? NOW.getTime());
  return headers;
};

export const post = (test: TestApp, body: Record<string, unknown> | string, sign: SignOptions = {}) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return test.app.inject({ method: "POST", url: "/hooks/whatsapp", headers: signHeaders(raw, sign), payload: raw });
};
