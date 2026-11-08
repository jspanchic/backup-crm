import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOutboxOnce } from "../src/outbox.ts";
import { createTestApp, delivery, post, type TestApp } from "./app-helpers.ts";
import { clearOutboxForTest, ownerClient } from "./helpers.ts";

describe("outbox", () => {
  let test: TestApp;
  let owner: pg.Client;

  beforeAll(async () => {
    test = createTestApp({ WAHA_API_KEY: "k".repeat(32) });
    owner = await ownerClient();
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const startConversation = async (options: Parameters<typeof delivery>[0] = {}) => {
    await post(test, delivery(options));
    await test.app.idle();
    return Number((await owner.query("select max(id) as id from core.conversations")).rows[0].id);
  };
  const enqueue = async (conversationId: number, text: string) =>
    Number((await test.db.query("select api.enqueue_outbound($1, $2) as id", [conversationId, text])).rows[0].id);
  const outbox = async (id: number) => (await owner.query("select * from core.outbox where id = $1", [id])).rows[0];
  const reset = () => {
    test.wahaCalls.length = 0;
    test.sleeps.length = 0;
    test.wahaAnswers.next = async () => ({ ok: true, status: 201 });
  };
  // Other tests' leftovers must not be sent by this one.
  const drain = async () => {
    await clearOutboxForTest(owner);
    reset();
  };

  it("sends a queued reply through WAHA and records it as sent", async () => {
    await drain();
    const conversation = await startConversation();
    const id = await enqueue(conversation, "Hola, soy Javier");

    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 1, failed: 0 });

    const call = test.wahaCalls.find((request) => request.url.endsWith("/api/sendText"))!;
    expect(call.url).toBe("http://waha.test/api/sendText");
    expect(call.headers["X-Api-Key"]).toBe("k".repeat(32));
    expect(JSON.parse(call.body)).toEqual({
      session: "bytogam-pruebas",
      chatId: expect.stringMatching(/^1202\d{7}@c\.us$/),
      text: "Hola, soy Javier",
    });
    expect(await outbox(id)).toMatchObject({ status: "sent", attempts: 1, last_error: null });
    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 0, failed: 0 });
  });

  it("writes the reply into the conversation history when it is queued", async () => {
    const conversation = await startConversation();
    await enqueue(conversation, "Te espero");
    const { rows } = await owner.query(
      "select direction, sender, body from core.messages where conversation_id = $1 order by id desc limit 1",
      [conversation],
    );
    expect(rows[0]).toEqual({ direction: "out", sender: "bot", body: "Te espero" });
  });

  it("sends to a lid chat id as it is", async () => {
    await drain();
    const conversation = await startConversation({ from: `${Date.now()}@lid` });
    await enqueue(conversation, "Hola");
    await runOutboxOnce(test.outboxDeps);
    const call = test.wahaCalls.find((request) => request.url.endsWith("/api/sendText"))!;
    expect(JSON.parse(call.body).chatId).toMatch(/@lid$/);
  });

  it("tries again after a safe failure, with a growing wait, and gives up after three attempts", async () => {
    await drain();
    const conversation = await startConversation();
    const id = await enqueue(conversation, "no llega");
    const failing = { ...test.outboxDeps, sleep: async () => { throw new Error("timer interrupted"); } };

    await runOutboxOnce(failing);
    expect(await outbox(id)).toMatchObject({ status: "pending", attempts: 1, last_error: "WAHA preparation failed" });
    expect((await outbox(id)).scheduled_at.getTime()).toBeGreaterThan(Date.now() + 25_000);

    // Not due yet: nothing is sent.
    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 0, failed: 0 });

    for (const attempt of [2, 3]) {
      await owner.query("update core.outbox set scheduled_at = now() - interval '1 second' where id = $1", [id]);
      await runOutboxOnce(failing);
      expect((await outbox(id)).attempts).toBe(attempt);
    }
    expect(await outbox(id)).toMatchObject({ status: "failed", attempts: 3 });

    await owner.query("update core.outbox set scheduled_at = now() - interval '1 day' where id = $1", [id]);
    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 0, failed: 0 });
  });

  it("treats a network error like a failure, without leaking the address", async () => {
    await drain();
    const id = await enqueue(await startConversation(), "sin red");
    test.wahaAnswers.next = async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED", address: "10.1.2.3" } });
    };
    await runOutboxOnce(test.outboxDeps);
    expect(await outbox(id)).toMatchObject({ status: "pending", last_error: "WAHA send response unconfirmed" });
  });

  it("recovers a worker that stopped before authorizing the send", async () => {
    await drain();
    const conversation = await startConversation();
    const stuck = await enqueue(conversation, "colgado");
    await owner.query("update core.outbox set status = 'sending', attempts = 1, claim_expires_at = now() - interval '1 second' where id = $1", [stuck]);

    expect(await runOutboxOnce(test.outboxDeps)).toEqual({ sent: 0, failed: 0 });
    expect(await outbox(stuck)).toMatchObject({ status: "pending", attempts: 1, last_error: "worker_claim_expired" });
    await owner.query("update core.outbox set scheduled_at = now() - interval '1 second' where id = $1", [stuck]);

    await runOutboxOnce(test.outboxDeps);

    expect(test.wahaCalls.filter((call) => call.url.endsWith("/api/sendText")).map((call) => JSON.parse(call.body).text)).toEqual(["colgado"]);
    expect(await outbox(stuck)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does not let anyone but the database function finish a message that is not being sent", async () => {
    await drain();
    const id = await enqueue(await startConversation(), "x");
    await test.db.query("select api.finish_paced_outbox($1, 1, 'sent', null)", [id]);
    expect((await outbox(id)).status).toBe("pending");
  });

  it("rejects a reply for a conversation that does not exist, and an invalid sender", async () => {
    await expect(test.db.query("select api.enqueue_outbound(999999999, 'x')")).rejects.toMatchObject({ code: "CX004" });
    const conversation = await startConversation();
    await expect(test.db.query("select api.enqueue_outbound($1, 'x', 'client')", [conversation])).rejects.toMatchObject({ code: "CX004" });
  });
});
