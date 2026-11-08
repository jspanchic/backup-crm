import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchToBot } from "../src/bot.ts";
import { runOutboxOnce } from "../src/outbox.ts";
import { createTestApp, delivery, fakePhone, post, SESSION, type TestApp } from "./app-helpers.ts";
import { ownerClient } from "./helpers.ts";

describe("runtime bot controls per brand", () => {
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

  const createBrand = async (agendaEnabled = true) => {
    const session = `switch-${randomUUID()}`;
    const { rows: [{ id }] } = await owner.query<{ id: number }>(
      `insert into core.brands (slug, name, timezone, bot_agenda_enabled)
       values ($1, 'Switch test', 'America/New_York', $2) returning id::int`,
      [session, agendaEnabled],
    );
    await owner.query(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
       values ($1, 'waha', $2, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true)`,
      [id, session],
    );
    return { id, session };
  };

  const setBot = (brandId: number, enabled: boolean) =>
    owner.query("update core.brands set bot_enabled = $1 where id = $2", [enabled, brandId]);

  const receive = async (session: string, from = `${fakePhone().digits}@c.us`) => {
    const providerId = randomUUID();
    const response = await post(test, delivery({ id: providerId, session, from }));
    expect(response.json()).toEqual({ status: "accepted" });
    await test.app.idle();
    const { rows: [message] } = await owner.query<{ id: number; conversationId: number; terminal: boolean }>(
      `select id::int, conversation_id::int as "conversationId", bot_dispatched_at is not null as terminal
       from core.messages where provider_message_id = $1`,
      [providerId],
    );
    return { ...message, from };
  };

  const latestToken = (): string => JSON.parse(test.botCalls.at(-1)!.body).token;

  const call = (token: string, method: "GET" | "POST", name: string, payload?: object) =>
    test.app.inject({ method, url: `/tools/${name}`, headers: { authorization: `Bearer ${token}` }, payload });

  const enqueue = async (conversationId: number, body: string, sender: "human" | "bot") =>
    Number((await test.db.query("select api.enqueue_outbound($1, $2, $3) as id", [conversationId, body, sender])).rows[0].id);

  const outboxState = async (id: number) =>
    (await owner.query("select status, attempts, last_error from core.outbox where id = $1", [id])).rows[0];

  // Other suites share the throwaway database and may leave unrelated replies queued.
  const drainOutbox = () => owner.query("update core.outbox set status = 'sent' where status in ('pending', 'sending')");

  it("keeps inbound messages in the CRM, skips retries and revokes existing tokens", async () => {
    const brand = await createBrand();
    const first = await receive(brand.session);
    const previousToken = latestToken();
    test.botAnswers.next = async () => ({ ok: false, status: 503 });
    const pending = await receive(brand.session, first.from);
    expect(pending.terminal).toBe(false);
    test.botAnswers.next = async () => ({ ok: true, status: 200 });

    await setBot(brand.id, false);
    const callsBefore = test.botCalls.length;
    const paused = await receive(brand.session, first.from);
    expect(paused).toMatchObject({ terminal: true, conversationId: first.conversationId });
    expect(test.botCalls).toHaveLength(callsBefore);

    for (const result of [
      await call(previousToken, "GET", "ficha"),
      await call(previousToken, "POST", "responder", { texto: "Hola" }),
    ]) {
      expect(result.statusCode).toBe(409);
      expect(result.json()).toEqual({ error: "bot_disabled" });
    }
    await expect(enqueue(first.conversationId, "Bot in flight", "bot")).rejects.toMatchObject({ code: "CX007" });

    await receive(SESSION);
    expect(test.botCalls).toHaveLength(callsBefore + 1);
    await setBot(brand.id, true);
    expect(await dispatchToBot(test.botDeps, pending.id)).toBe("skipped");
    expect(await dispatchToBot(test.botDeps, paused.id)).toBe("skipped");
    expect((await call(previousToken, "POST", "responder", { texto: "Hola" })).statusCode).toBe(401);
    await receive(brand.session, first.from);
    expect(test.botCalls).toHaveLength(callsBefore + 2);
    expect((await call(latestToken(), "GET", "ficha")).statusCode).toBe(200);
  });

  it("rejects the three bot agenda tools for the configured brand", async () => {
    const brand = await createBrand(false);
    await receive(brand.session);
    const token = latestToken();
    expect((await call(token, "GET", "ficha")).statusCode).toBe(200);

    for (const [name, payload] of [
      ["horarios_libres", {}],
      ["reservar", { inicio: "2030-06-01T16:00:00Z" }],
      ["confirmar", {}],
    ] as const) {
      const response = await call(token, "POST", name, payload);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "agenda_disabled" });
    }
  });

  it("cancels pending and claimed bot deliveries while allowing human messages", async () => {
    await drainOutbox();
    test.wahaCalls.length = 0;
    const brand = await createBrand();
    const { conversationId } = await receive(brand.session);
    const manual = await enqueue(conversationId, "Human", "human");
    const claimed = await enqueue(conversationId, "Bot claimed", "bot");
    const pending = await enqueue(conversationId, "Bot pending", "bot");

    expect(await runOutboxOnce({ ...test.outboxDeps, sleep: async () => { await setBot(brand.id, false); } }, 2))
      .toEqual({ sent: 1, failed: 0 });
    expect(await outboxState(manual)).toMatchObject({ status: "sent" });
    expect(await outboxState(claimed)).toEqual({ status: "failed", attempts: 1, last_error: "bot_disabled" });
    expect(await outboxState(pending)).toEqual({ status: "failed", attempts: 0, last_error: "bot_disabled" });

    const afterStop = await enqueue(conversationId, "Human while off", "human");
    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 1, failed: 0 });
    expect(await outboxState(afterStop)).toMatchObject({ status: "sent" });
    await setBot(brand.id, true);
    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 0, failed: 0 });
    expect(test.wahaCalls.map((item) => JSON.parse(item.body).text)).toEqual(["Human", "Human while off"]);
  });

  it("does not claim any messages when WhatsApp sending is disabled globally", async () => {
    await drainOutbox();
    test.wahaCalls.length = 0;
    const brand = await createBrand();
    const { conversationId } = await receive(brand.session);
    const id = await enqueue(conversationId, "Dry run", "bot");
    const config = { ...test.config, WAHA_SEND_ENABLED: false };

    expect(await runOutboxOnce({ ...test.outboxDeps, config })).toEqual({ sent: 0, failed: 0 });
    expect(await outboxState(id)).toEqual({ status: "pending", attempts: 0, last_error: null });
    expect(test.wahaCalls).toEqual([]);
  });
});
