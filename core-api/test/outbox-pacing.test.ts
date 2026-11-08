import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runOutboxOnce } from "../src/outbox.ts";
import { createTestApp, delivery, fakePhone, post, type Call, type TestApp } from "./app-helpers.ts";
import { ownerClient } from "./helpers.ts";

const endpoint = (call: Call): string => new URL(call.url).pathname;
const textCalls = (test: TestApp): Call[] => test.wahaCalls.filter((call) => endpoint(call) === "/api/sendText");

describe("WAHA pacing across outbox workers", () => {
  let test: TestApp;
  let otherWorker: TestApp;
  let owner: pg.Client;
  const sessions: string[] = [];

  const clearQueue = async () => {
    await owner.query(
      `update core.outbox set status = 'failed', claim_expires_at = null, last_error = 'cleared by pacing test'
       where status in ('pending', 'sending') or claim_expires_at is not null`,
    );
    await owner.query("truncate core.outbox_send_attempts");
  };

  beforeAll(async () => {
    test = createTestApp();
    otherWorker = createTestApp();
    owner = await ownerClient();
  });

  beforeEach(async () => {
    await clearQueue();
    for (const worker of [test, otherWorker]) {
      worker.wahaCalls.length = 0;
      worker.presenceCalls.length = 0;
      worker.inboundSteps.length = 0;
      worker.wahaAnswers.next = async () => ({ ok: true, status: 201 });
      worker.presenceAnswers.next = async () => ({ ok: true, status: 201 });
    }
  });

  afterEach(async () => {
    await owner.query("update core.channels set active = false where identifier = any($1)", [sessions.splice(0)]);
  });

  afterAll(async () => {
    await clearQueue();
    await Promise.all([test.close(), otherWorker.close(), owner.end()]);
  });

  const brand = async (maxPerMinute = 6) => {
    const session = `outbox-${randomUUID()}`;
    const { rows: [{ id }] } = await owner.query<{ id: number }>(
      `insert into core.brands (slug, name, timezone) values ($1, $1, 'UTC') returning id::int`,
      [`brand-${randomUUID()}`],
    );
    await owner.query(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test,
         waha_before_seen_ms, waha_before_typing_ms, waha_before_send_ms, waha_messages_per_minute)
       values ($1, 'waha', $2, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true, 550, 750, 850, $3)`,
      [id, session, maxPerMinute],
    );
    sessions.push(session);
    return session;
  };

  const receive = async (session: string, chatId = `${fakePhone().digits}@c.us`, options: Parameters<typeof delivery>[0] = {}) => {
    const envelope = delivery({ session, from: chatId, ...options });
    const messageId = (envelope.payload as { id: string }).id;
    const response = await post(test, envelope);
    expect(response.json()).toEqual({ status: "accepted" });
    await test.app.idle();
    const { rows: [{ id }] } = await owner.query<{ id: number }>(
      "select conversation_id::int as id from core.messages where provider_message_id = $1",
      [messageId],
    );
    return { conversationId: id, messageId, chatId };
  };

  const enqueue = async (conversationId: number, message: string): Promise<number> =>
    Number((await test.db.query("select api.enqueue_outbound($1, $2) as id", [conversationId, message])).rows[0].id);

  const state = async (id: number) => (await owner.query<{
    status: string; attempts: number; last_error: string | null; scheduled_at: Date;
  }>("select status, attempts, last_error, scheduled_at from core.outbox where id = $1", [id])).rows[0];

  const ageAttempts = (seconds: number) =>
    owner.query("update core.outbox_send_attempts set started_at = clock_timestamp() - make_interval(secs => $1)", [seconds]);

  const makeDue = (id: number) => owner.query("update core.outbox set scheduled_at = now() - interval '1 second' where id = $1", [id]);

  it("waits, marks the inbound seen, waits, types, invokes the bot, then waits, sends and stops", async () => {
    const session = await brand();
    const phone = fakePhone().digits;
    const { messageId, chatId } = await receive(session, "9988776644@lid", { senderAlt: `${phone}@s.whatsapp.net` });
    const botRequest = test.botCalls.at(-1)!;
    const { token } = JSON.parse(botRequest.body) as { token: string };
    expect(test.inboundSteps).toEqual([550, "/api/sendSeen", 750, "/api/startTyping", "bot"]);
    expect(test.presenceCalls.map((call) => JSON.parse(call.body))).toEqual([
      { session, chatId, messageIds: [messageId] }, { session, chatId },
    ]);
    expect(botRequest.body).not.toContain(chatId);
    expect(botRequest.body).not.toContain(session);
    expect(botRequest.body).not.toContain(messageId);

    // A delayed response uses its original chat ID, even if the same contact now sends from a phone JID.
    await receive(session, `${phone}@c.us`);
    const reply = await test.app.inject({
      method: "POST", url: "/tools/responder", headers: { authorization: `Bearer ${token}` }, payload: { texto: "abc" },
    });
    expect(reply.statusCode).toBe(200);
    const events: (string | number)[] = [];
    const deps = {
      ...test.outboxDeps,
      fetch: async (...args: Parameters<TestApp["outboxDeps"]["fetch"]>) => {
        events.push(new URL(args[0]).pathname);
        return test.outboxDeps.fetch(...args);
      },
      sleep: async (ms: number) => void events.push(ms),
    };

    expect(await runOutboxOnce(deps, 1)).toEqual({ sent: 1, failed: 0 });
    expect(events).toEqual([850, "/api/sendText", "/api/stopTyping"]);
    expect(test.wahaCalls.map((call) => JSON.parse(call.body))).toEqual([
      { session, chatId, text: "abc" },
      { session, chatId },
    ]);
  });

  it("dispatches the media marker even when both inbound presence requests fail", async () => {
    test.presenceAnswers.next = async (call) => {
      if (endpoint(call) === "/api/sendSeen") return { ok: false, status: 503 };
      throw new TypeError("failed to start presence");
    };
    await receive(await brand(), undefined, { body: null, hasMedia: true });
    expect(test.inboundSteps).toEqual([550, "/api/sendSeen", 750, "/api/startTyping", "bot"]);
    expect(JSON.parse(test.botCalls.at(-1)!.body).mensaje.texto).toBe("[El cliente envió un audio o archivo sin texto]");
  });

  it("keeps consecutive replies to a chat in order while another worker polls", async () => {
    const { conversationId } = await receive(await brand());
    await enqueue(conversationId, "first");
    const secondId = await enqueue(conversationId, "second");
    let reachedStopTyping!: () => void;
    let releaseStopTyping!: () => void;
    const stopping = new Promise<void>((resolve) => { reachedStopTyping = resolve; });
    const release = new Promise<void>((resolve) => { releaseStopTyping = resolve; });
    test.wahaAnswers.next = async (call) => {
      if (endpoint(call) === "/api/stopTyping") {
        reachedStopTyping();
        await release;
      }
      return { ok: true, status: 201 };
    };

    const first = runOutboxOnce(test.outboxDeps, 1);
    try {
      await Promise.race([stopping, first.then(() => { throw new Error("First reply never reached stopTyping"); })]);
      // Leave capacity in the global send window so only the chat's in-flight job can hold the second reply.
      await ageAttempts(61);
      expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
      expect(otherWorker.wahaCalls).toEqual([]);
      expect(await state(secondId)).toMatchObject({ status: "pending", attempts: 0 });
    } finally {
      releaseStopTyping();
      await first;
    }

    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
    expect([test, otherWorker].flatMap(textCalls).map((call) => JSON.parse(call.body).text)).toEqual(["first", "second"]);
  });

  it("spaces sends and applies one rolling cap across brands, chats and workers", async () => {
    const firstSession = await brand(2);
    const secondSession = await brand(2);
    const first = await receive(firstSession);
    const second = await receive(secondSession);
    const third = await receive(secondSession);
    await enqueue(first.conversationId, "one");
    const secondId = await enqueue(second.conversationId, "two");
    const thirdId = await enqueue(third.conversationId, "three");

    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(textCalls(otherWorker)).toHaveLength(0);

    await ageAttempts(31);
    await makeDue(secondId);
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });

    // Both starts are within the minute, but the spacing requirement no longer blocks the next send.
    await ageAttempts(31);
    await makeDue(thirdId);
    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(textCalls(test)).toHaveLength(1);

    await ageAttempts(61);
    await makeDue(thirdId);
    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
  });

  it("retries a pre-send failure only after the backoff and delivers one copy", async () => {
    const { conversationId } = await receive(await brand());
    const id = await enqueue(conversationId, "retry");
    const failedPreparation = { ...test.outboxDeps, sleep: async () => { throw new Error("timer interrupted"); } };
    expect(await runOutboxOnce(failedPreparation, 1)).toEqual({ sent: 0, failed: 1 });
    const failedAttempt = await state(id);
    expect(failedAttempt).toMatchObject({ status: "pending", attempts: 1 });
    expect(failedAttempt.scheduled_at.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(textCalls(test)).toEqual([]);
    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });

    test.wahaAnswers.next = async () => ({ ok: true, status: 201 });
    await makeDue(id);
    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
    expect(await state(id)).toMatchObject({ status: "sent", attempts: 2 });
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect([test, otherWorker].flatMap(textCalls)).toHaveLength(1);
  });

  it("does not retry if WAHA accepted the message but the response was lost", async () => {
    const session = await brand();
    const { conversationId } = await receive(session);
    const id = await enqueue(conversationId, "accepted before the disconnect");
    const followUp = await enqueue(conversationId, "same chat, must wait for review");
    const differentChat = await receive(session);
    await enqueue(differentChat.conversationId, "different chat, can proceed");
    test.wahaAnswers.next = async (call) => {
      if (endpoint(call) === "/api/sendText") throw new TypeError("Connection closed after acceptance");
      return { ok: true, status: 201 };
    };

    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 0, failed: 1 });
    expect(await state(id)).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^delivery_uncertain/) });
    expect(test.wahaCalls.at(-1)?.url).toBe("http://waha.test/api/stopTyping");

    await ageAttempts(61);
    await makeDue(id);
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
    expect(textCalls(otherWorker).map((call) => JSON.parse(call.body).text)).toEqual(["different chat, can proceed"]);
    expect(await state(followUp)).toMatchObject({ status: "pending", attempts: 0 });
    await ageAttempts(61);
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(textCalls(test)).toHaveLength(1);
    expect(textCalls(otherWorker)).toHaveLength(1);
  });

  it("backs off after an explicit WAHA rejection and only one attempt is accepted", async () => {
    const { conversationId } = await receive(await brand());
    const id = await enqueue(conversationId, "rate-limited by WAHA");
    let accepted = 0;
    test.wahaAnswers.next = async (call) => endpoint(call) === "/api/sendText"
      ? { ok: false, status: 429 }
      : { ok: true, status: 201 };
    otherWorker.wahaAnswers.next = async (call) => {
      if (endpoint(call) === "/api/sendText") accepted++;
      return { ok: true, status: 201 };
    };

    expect(await runOutboxOnce(test.outboxDeps, 1)).toEqual({ sent: 0, failed: 1 });
    expect(await state(id)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(accepted).toBe(0);

    await ageAttempts(61);
    await makeDue(id);
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 1, failed: 0 });
    expect(await state(id)).toMatchObject({ status: "sent", attempts: 2 });
    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(accepted).toBe(1);
  });

  it("does not resend a fenced job left by a worker that stopped responding", async () => {
    const { conversationId } = await receive(await brand());
    const id = await enqueue(conversationId, "possibly accepted before the worker stopped");
    const { rows: [claim] } = await test.db.query<{ id: string; attempts: number }>("select * from api.claim_outbox(1)");
    expect(Number(claim.id)).toBe(id);
    const { rows: [{ decision }] } = await test.db.query<{ decision: string }>(
      "select api.begin_outbox_send($1, $2) as decision", [id, claim.attempts],
    );
    expect(decision).toBe("send");
    await owner.query("update core.outbox set claim_expires_at = now() - interval '1 second' where id = $1", [id]);
    await ageAttempts(61);

    expect(await runOutboxOnce(otherWorker.outboxDeps, 1)).toEqual({ sent: 0, failed: 0 });
    expect(otherWorker.wahaCalls).toEqual([]);
    expect(await state(id)).toMatchObject({ status: "failed", attempts: 1, last_error: expect.stringMatching(/^delivery_uncertain/) });
  });
});
