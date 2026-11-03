import { createHmac, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepPendingDispatches } from "../src/bot.ts";
import { signBotRequest } from "../src/signature.ts";
import { verifyConversationToken } from "../src/token.ts";
import {
  channelSecret,
  createTestApp,
  delivery,
  fakePhone,
  NOW,
  post,
  SESSION,
  type TestApp,
} from "./app-helpers.ts";
import { ownerClient } from "./helpers.ts";

describe("webhook", () => {
  let test: TestApp;
  let owner: pg.Client;

  beforeAll(async () => {
    test = createTestApp();
    owner = await ownerClient();
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const scalar = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows[0]?.n as number;
  const messagesWithId = (id: string) => scalar("select count(*)::int as n from core.messages where provider_message_id = $1", [id]);
  const lastBotBody = () => JSON.parse(test.botCalls.at(-1)!.body);
  const idOf = (body: Record<string, unknown>) => (body.payload as { id: string }).id;
  const send = async (options: Parameters<typeof delivery>[0] = {}) => {
    const body = delivery(options);
    const response = await post(test, body);
    await test.app.idle();
    return { response, body, id: idOf(body) };
  };

  describe("signature (every failure is a bare 401 that changes nothing)", () => {
    const rejected = async (sign: Parameters<typeof post>[2]) => {
      const callsBefore = test.botCalls.length;
      const body = delivery();
      const response = await post(test, body, sign);
      await test.app.idle();
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe("");
      expect(await messagesWithId(idOf(body))).toBe(0);
      expect(test.botCalls.length).toBe(callsBefore);
    };

    it("rejects a signature made with another secret", () => rejected({ secret: "x".repeat(40) }));
    it("rejects a missing signature", () => rejected({ signature: null }));
    it("rejects a garbage signature", () => rejected({ signature: "abc" }));
    it("rejects a signature over another body", () => rejected({ signedBody: "{}" }));
    it("rejects a missing algorithm header", () => rejected({ algorithmHeader: null }));
    it("rejects the wrong algorithm", () => rejected({ algorithmHeader: "sha256" }));

    it("rejects a timestamp older than 5 minutes", () => rejected({ timestampMs: NOW.getTime() - 5 * 60_000 - 1 }));
    it("rejects a timestamp from the future", () => rejected({ timestampMs: NOW.getTime() + 5 * 60_000 + 1 }));
    it("rejects a timestamp in seconds", () => rejected({ timestampMs: Math.floor(NOW.getTime() / 1000) }));

    it("accepts a timestamp inside the window", async () => {
      const response = await post(test, delivery(), { timestampMs: NOW.getTime() - 4 * 60_000 });
      await test.app.idle();
      expect(response.statusCode).toBe(200);
    });

    it("rejects a channel whose secret is not configured", async () => {
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref)
         values (1, 'waha', 'no-secret-session', 'javier', 'SECRET_THAT_DOES_NOT_EXIST') on conflict do nothing`,
      );
      const response = await post(test, delivery({ session: "no-secret-session" }));
      expect(response.statusCode).toBe(401);
    });

    it("never accepts a signature made with the secret of another channel", async () => {
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref)
         values (1, 'waha', 'other-session', 'javier', 'WAHA_API_KEY') on conflict do nothing`,
      );
      const response = await post(test, delivery({ session: "other-session" }), { secret: channelSecret() });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("what it accepts and what it ignores", () => {
    it("rejects a signed body with no message id, which the duplicate check needs", async () => {
      const body = delivery();
      delete (body.payload as Record<string, unknown>).id;
      expect((await post(test, body)).statusCode).toBe(400);
    });

    it("rejects a body that is not JSON, and one with no session", async () => {
      expect((await post(test, "not json")).statusCode).toBe(400);
      expect((await post(test, { payload: {} })).statusCode).toBe(400);
    });

    it("rejects a body over 1 MB", async () => {
      const response = await post(test, delivery({ body: "x".repeat(10) }), {});
      expect(response.statusCode).toBe(200);
      const big = await test.app.inject({
        method: "POST",
        url: "/hooks/whatsapp",
        headers: { "content-type": "application/json" },
        payload: `{"session":"${SESSION}","pad":"${"x".repeat(1_100_000)}"}`,
      });
      expect(big.statusCode).toBe(413);
    });

    it.each([
      ["a group", { from: "12025550123-1600000000@g.us" }],
      ["a status", { from: "status@broadcast" }],
      ["my own message", { fromMe: true }],
      ["an event that is not an incoming message", { event: "message.any" }],
      ["an empty message", { body: "   " }],
    ])("ignores %s: nothing is stored and the bot is not called", async (_name, options) => {
      const contacts = await scalar("select count(*)::int as n from public.contacts");
      const calls = test.botCalls.length;
      const { response, id } = await send(options);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ignored" });
      expect(await messagesWithId(id)).toBe(0);
      expect(await scalar("select count(*)::int as n from public.contacts")).toBe(contacts);
      expect(test.botCalls.length).toBe(calls);
    });

    it("answers a bare 404 for anything that is not a route", async () => {
      for (const [method, url] of [["GET", "/hooks/whatsapp"], ["POST", "/tools/ficha"], ["GET", "/admin"], ["GET", "/"], ["PUT", "/healthz"]] as const) {
        const response = await test.app.inject({ method, url });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json()).toEqual({ error: "not_found" });
      }
    });
  });

  describe("unknown channels", () => {
    it("records the session without content and never reaches a bot", async () => {
      const contacts = await scalar("select count(*)::int as n from public.contacts");
      const calls = test.botCalls.length;
      const session = `unknown-${randomUUID().slice(0, 8)}`;

      const first = await post(test, delivery({ session }), { secret: "z".repeat(40) });
      const again = await post(test, delivery({ session }), { secret: "z".repeat(40) });

      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ status: "unrouted" });
      expect(again.statusCode).toBe(200);
      expect(await scalar("select count(*)::int as n from core.unrouted_events where identifier = $1", [session])).toBe(1);
      expect(await scalar("select count(*)::int as n from public.contacts")).toBe(contacts);
      expect(test.botCalls.length).toBe(calls);
    });

    it("treats an inactive channel as unknown", async () => {
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, active)
         values (1, 'waha', 'switched-off', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', false) on conflict do nothing`,
      );
      const response = await post(test, delivery({ session: "switched-off" }));
      expect(response.json()).toEqual({ status: "unrouted" });
    });
  });

  describe("duplicates", () => {
    it("stores one message and calls the bot once when the same delivery arrives twice", async () => {
      const calls = test.botCalls.length;
      const body = delivery();
      const first = await post(test, body);
      await test.app.idle();
      const second = await post(test, body);
      await test.app.idle();

      expect(first.json()).toEqual({ status: "accepted" });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ status: "duplicate" });
      expect(await messagesWithId(idOf(body))).toBe(1);
      expect(test.botCalls.length - calls).toBe(1);
    });

    it("lets exactly one of five simultaneous deliveries through", async () => {
      const calls = test.botCalls.length;
      const body = delivery();
      const responses = await Promise.all(Array.from({ length: 5 }, () => post(test, body)));
      await test.app.idle();

      expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(responses.filter((r) => r.json().status === "accepted")).toHaveLength(1);
      expect(await messagesWithId(idOf(body))).toBe(1);
      expect(test.botCalls.length - calls).toBe(1);
    });

    it("treats the same id on another channel as another message", async () => {
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
         values (1, 'waha', 'second-session', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true) on conflict do nothing`,
      );
      const body = delivery();
      await post(test, body);
      const other = await post(test, { ...body, session: "second-session" });
      await test.app.idle();
      expect(other.json()).toEqual({ status: "accepted" });
      expect(await messagesWithId(idOf(body))).toBe(2);
    });
  });

  describe("who writes", () => {
    it("creates contact, identity, holder, conversation, opportunity and message with the first message", async () => {
      const phone = fakePhone();
      const { id } = await send({ from: `${phone.digits}@c.us`, pushName: "Carlos" });

      const { rows } = await owner.query(
        `select c.first_name, c.last_name, c.is_test, c.phone_jsonb, c.brand_id::int,
                i.type, i.value, h.valid_to, cv.closed_at, cv.bot_paused,
                d.stage, d.name as deal_name, d.primary_contact_id = c.id as deal_linked,
                m.body, m.direction, m.sender, m.bot_dispatched_at
         from core.messages m
         join core.conversations cv on cv.id = m.conversation_id
         join core.contact_identities i on i.id = cv.identity_id
         join core.identity_holders h on h.identity_id = i.id
         join public.contacts c on c.id = h.contact_id
         join public.deals d on d.primary_contact_id = c.id
         where m.provider_message_id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        first_name: "Carlos",
        last_name: `••${phone.digits.slice(-4)}`,
        is_test: true, // the sample channel is the BYTOGAM test session
        phone_jsonb: [{ number: phone.e164, type: "Mobile" }],
        brand_id: 1,
        type: "phone_e164",
        value: phone.e164,
        valid_to: null,
        closed_at: null,
        bot_paused: false,
        stage: "opportunity",
        deal_linked: true,
        body: "Hola, quiero cotizar",
        direction: "in",
        sender: "client",
      });
      expect(rows[0].bot_dispatched_at).not.toBeNull();
    });

    it("reuses everything for the same number and opens a new opportunity only after the last one closes", async () => {
      const phone = fakePhone();
      const from = `${phone.digits}@c.us`;
      await send({ from });
      await send({ from });

      const count = (table: string) =>
        scalar(
          `select count(*)::int as n from ${table} x where x.${table === "public.deals" ? "primary_contact_id" : "contact_id"} in
             (select contact_id from core.identity_holders h join core.contact_identities i on i.id = h.identity_id where i.value = $1)`,
          [phone.e164],
        );
      expect(await count("core.conversations")).toBe(1);
      expect(await count("public.deals")).toBe(1);
      expect(await scalar("select count(*)::int as n from core.contact_identities where value = $1", [phone.e164])).toBe(1);

      await owner.query(
        `update public.deals set stage = 'lost' where primary_contact_id in
           (select contact_id from core.identity_holders h join core.contact_identities i on i.id = h.identity_id where i.value = $1)`,
        [phone.e164],
      );
      await send({ from });
      expect(await count("public.deals")).toBe(2);
    });

    it("gives two numbers two contacts", async () => {
      const before = await scalar("select count(*)::int as n from public.contacts");
      await send();
      await send();
      expect(await scalar("select count(*)::int as n from public.contacts")).toBe(before + 2);
    });

    it("keeps a lid as identity when WhatsApp gives no number", async () => {
      const lid = `${Date.now()}${Math.floor(Math.random() * 1000)}@lid`;
      await send({ from: lid });
      const { rows } = await owner.query("select type, value from core.contact_identities where value = $1", [lid]);
      expect(rows).toEqual([{ type: "wa_lid", value: lid }]);
      expect((await owner.query("select phone_jsonb from public.contacts where first_name = 'WhatsApp' order by id desc limit 1")).rows[0].phone_jsonb).toBeNull();
    });

    it("finds the number in SenderAlt when the chat id is a lid", async () => {
      const phone = fakePhone();
      await send({ from: `${Date.now()}@lid`, senderAlt: `${phone.digits}@s.whatsapp.net` });
      expect(await scalar("select count(*)::int as n from core.contact_identities where value = $1 and type = 'phone_e164'", [phone.e164])).toBe(1);
    });

    it("marks a real (non test) channel's contact and opportunity as real", async () => {
      await owner.query(
        `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
         values (1, 'waha', 'real-session', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', false) on conflict do nothing`,
      );
      const phone = fakePhone();
      await send({ session: "real-session", from: `${phone.digits}@c.us` });
      const { rows } = await owner.query(
        `select c.is_test as contact_test, d.is_test as deal_test
         from core.identity_holders h join core.contact_identities i on i.id = h.identity_id
         join public.contacts c on c.id = h.contact_id join public.deals d on d.primary_contact_id = c.id
         where i.value = $1`,
        [phone.e164],
      );
      expect(rows).toEqual([{ contact_test: false, deal_test: false }]);
    });

    it("redacts card numbers before storing and before the bot sees them", async () => {
      const { id } = await send({ body: "mi tarjeta 4111 1111 1111 1111 y mi zip es 32801" });
      const stored = (await owner.query("select body from core.messages where provider_message_id = $1", [id])).rows[0].body;
      expect(stored).toBe("mi tarjeta [TARJETA REDACTADA] y mi zip es 32801");
      expect(test.botCalls.at(-1)!.body).not.toContain("4111");
      expect(lastBotBody().mensaje.texto).toBe(stored);
    });

    it("keeps a voice note or file as a marker", async () => {
      const { id } = await send({ body: "", hasMedia: true });
      expect((await owner.query("select body from core.messages where provider_message_id = $1", [id])).rows[0].body).toContain("nota de voz");
    });
  });

  describe("the call to the bot", () => {
    it("answers WAHA before the bot finishes", async () => {
      let release!: () => void;
      const calls = test.botCalls.length;
      test.botAnswers.next = () => new Promise((resolve) => (release = () => resolve({ ok: true, status: 200 })));
      try {
        const response = await post(test, delivery());
        expect(response.statusCode).toBe(200);
        await new Promise((done) => setTimeout(done, 50));
        expect(test.botCalls.length - calls).toBe(1);
      } finally {
        release();
        test.botAnswers.next = async () => ({ ok: true, status: 200 });
      }
      await test.app.idle();
    });

    it("sends the documented contract, signed, with a 15 minute token, and no customer ids or full phone", async () => {
      const phone = fakePhone();
      const { id } = await send({ from: `${phone.digits}@c.us`, pushName: "Ana", body: "Hola" });
      expect(id).toContain(phone.digits); // the provider id carries the number, so it must not reach the bot
      const call = test.botCalls.at(-1)!;
      const body = JSON.parse(call.body);

      expect(call.url).toBe("http://bot.test/webhook/javier");
      expect(Object.keys(body).sort()).toEqual(["bot", "canal", "contacto", "ficha", "historial", "mensaje", "tenant", "token"]);
      expect(body).toMatchObject({
        tenant: "salvionix",
        bot: "javier",
        canal: "whatsapp",
        mensaje: { id: expect.stringMatching(/^msg_\d+$/), texto: "Hola" },
        contacto: { nombre: "Ana", nuevo: true, reverificar: false, idioma: null },
        historial: [],
        ficha: { etapa: "opportunity", zip: null, cotizacion_vigente: null, cita: null },
      });
      expect(body.contacto.telefono_enmascarado).toMatch(/^\+1•+0123$|^\+1•+\d{4}$/);
      expect(call.body).not.toContain(phone.digits);
      expect(call.body).not.toContain(phone.e164);
      expect(call.body).not.toContain(id);

      const timestamp = Number(call.headers["X-Core-Timestamp"]);
      expect(timestamp).toBe(Math.floor(NOW.getTime() / 1000));
      expect(call.headers["X-Core-Signature"]).toBe(signBotRequest(test.env.BOT_HMAC_SECRET!, timestamp, call.body));
      expect(call.headers["X-Core-Signature"]).toBe(createHmac("sha256", test.env.BOT_HMAC_SECRET!).update(`${timestamp}.${call.body}`).digest("hex"));

      const verified = await verifyConversationToken(test.env.CONVERSATION_TOKEN_SECRET!, body.token, NOW);
      expect(verified).toMatchObject({ ok: true, claims: { brandId: 1 } });
      const conversation = (await owner.query("select conversation_id from core.messages where provider_message_id = $1", [id])).rows[0].conversation_id;
      expect(verified.ok && verified.claims.conversationId).toBe(Number(conversation));
      expect(await verifyConversationToken(test.env.CONVERSATION_TOKEN_SECRET!, body.token, new Date(NOW.getTime() + 16 * 60_000))).toEqual({ ok: false });
    });

    it("sends the history without the current message, with replies the bot already gave", async () => {
      const phone = fakePhone();
      const from = `${phone.digits}@c.us`;
      await send({ from, body: "Hola" });
      const conversation = (await owner.query("select id from core.conversations order by id desc limit 1")).rows[0].id;
      await test.db.query("select api.enqueue_outbound($1, $2)", [conversation, "Hola, soy Javier"]);
      await send({ from, body: "Quiero cotizar" });

      const body = lastBotBody();
      expect(body.mensaje.texto).toBe("Quiero cotizar");
      expect(body.contacto.nuevo).toBe(false);
      expect(body.historial).toEqual([
        { de: "cliente", texto: "Hola" },
        { de: "bot", texto: "Hola, soy Javier" },
      ]);
    });

    it("asks the bot to confirm the name after a long silence, and not before", async () => {
      const phone = fakePhone();
      const from = `${phone.digits}@c.us`;
      await send({ from, timestampSeconds: Math.floor(NOW.getTime() / 1000) - 100 * 86_400 });
      await send({ from, timestampSeconds: Math.floor(NOW.getTime() / 1000) - 10 * 86_400 });
      expect(lastBotBody().contacto.reverificar).toBe(false);

      const other = fakePhone();
      await send({ from: `${other.digits}@c.us`, timestampSeconds: Math.floor(NOW.getTime() / 1000) - 100 * 86_400 });
      await send({ from: `${other.digits}@c.us` });
      expect(lastBotBody().contacto.reverificar).toBe(true);
    });

    it("stores the message but does not call the bot while the conversation is paused", async () => {
      const phone = fakePhone();
      const from = `${phone.digits}@c.us`;
      await send({ from });
      await owner.query("update core.conversations set bot_paused = true where id = (select max(id) from core.conversations)");
      const calls = test.botCalls.length;

      const { id } = await send({ from, body: "¿Hay alguien?" });
      expect(test.botCalls.length).toBe(calls);
      expect(await messagesWithId(id)).toBe(1);
      expect(await sweepPendingDispatches(test.botDeps, 0)).toBe(0);
      expect(test.botCalls.length).toBe(calls);
    });

    it("leaves a message to retry when the bot is down, and delivers it later", async () => {
      test.botAnswers.next = async () => {
        throw new Error("connection refused");
      };
      const { id } = await send();
      test.botAnswers.next = async () => ({ ok: false, status: 502 });
      await sweepPendingDispatches(test.botDeps, 0);
      const stuck = () => scalar("select count(*)::int as n from core.messages where provider_message_id = $1 and bot_dispatched_at is null", [id]);
      expect(await stuck()).toBe(1);

      test.botAnswers.next = async () => ({ ok: true, status: 200 });
      expect(await sweepPendingDispatches(test.botDeps, 0)).toBeGreaterThanOrEqual(1);
      expect(await stuck()).toBe(0);
      expect(await sweepPendingDispatches(test.botDeps, 0)).toBe(0);
    });

    it("does not retry a message the bot already accepted", async () => {
      const calls = test.botCalls.length;
      await send();
      expect(test.botCalls.length - calls).toBe(1);
      expect(await sweepPendingDispatches(test.botDeps, 0)).toBe(0);
      expect(test.botCalls.length - calls).toBe(1);
    });

    it("does nothing, and tells nobody, when the bot has no URL", async () => {
      const noUrl = createTestApp({ BOT_URL_JAVIER: undefined });
      try {
        const response = await post(noUrl, delivery());
        await noUrl.app.idle();
        expect(response.statusCode).toBe(200);
        expect(noUrl.botCalls).toHaveLength(0);
      } finally {
        await noUrl.close();
      }
    });
  });
});
