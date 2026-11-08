import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakePhone } from "../app-helpers.ts";
import { clearOutboxForTest, coreApiClient, createQuote, createTechnician, insertHold, ownerClient } from "../helpers.ts";

describe("team reset", () => {
  let owner: pg.Client;
  let service: pg.Client;
  const allow = (phone: string, brand = 1) =>
    owner.query("insert into core.team_reset_numbers (brand_id, phone_e164) values ($1, $2)", [brand, phone]);

  beforeAll(async () => {
    owner = await ownerClient();
    service = await coreApiClient();
  });

  afterAll(async () => {
    await Promise.all([owner.end(), service.end()]);
  });

  const channel = async (brand = 1): Promise<{ id: number; session: string }> => {
    const session = "team-reset-" + randomUUID();
    const { rows: [row] } = await owner.query<{ id: number }>(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref)
       values ($1, 'waha', $2, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS') returning id::int`, [brand, session],
    );
    return { id: row.id, session };
  };

  const ingest = async (session: string, id: string, phone: string, body = "Hello") => {
    const { rows: [row] } = await service.query<{ result: { status: string; conversation_id?: number } }>(
      "select api.ingest_inbound('waha', $1, $2, now(), $3, $4, null, 'Team', $5) as result",
      [session, id, body, phone, phone.slice(1) + "@c.us"],
    );
    return row.result;
  };

  const reset = async (session: string, id: string, phone: string, chat: string, db = service) => {
    const { rows: [row] } = await db.query<{ status: string }>(
      "select api.try_team_reset($1, $2, $3, $4) as status", [session, id, phone, chat],
    );
    return row.status;
  };

  const records = async (conversation: number | undefined) => {
    const { rows: [row] } = await owner.query<{ contactId: number; dealId: number; is_test: boolean; deal_is_test: boolean }>(
      `select c.id::int as "contactId", d.id::int as "dealId", c.is_test, d.is_test as deal_is_test
       from core.conversations v join public.contacts c on c.id = v.contact_id
       join public.deals d on d.primary_contact_id = c.id where v.id = $1`, [conversation],
    );
    return row;
  };

  it("removes the test ficha, conversation, appointment and PDF records, while keeping an authorized ACK paced and durable", async () => {
    await clearOutboxForTest(owner);
    const { session, id: channelId } = await channel();
    const phone = fakePhone();
    await allow(phone.e164);
    const initial = await ingest(session, "setup", phone.e164);
    const lead = await records(initial.conversation_id);
    expect(lead).toMatchObject({ is_test: true, deal_is_test: true });
    const quoteId = await createQuote(owner, lead.dealId);
    const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const hold = await insertHold(owner, lead, await createTechnician(owner), start.toISOString(), end.toISOString());
    const { rows: [{ id: documentId }] } = await owner.query<{ id: number }>(
      "insert into core.documents (document_type, deal_id, quote_id, payload) values ('quote', $1, $2, '{}') returning id::int",
      [lead.dealId, quoteId],
    );
    const { rows: [{ fileId }] } = await service.query<{ fileId: string }>(
      `select api.record_document_file($1, 'quote', 'test', repeat('a', 64), 100) as "fileId"`, [documentId],
    );
    await expect(owner.query("delete from core.documents where id = $1", [documentId])).rejects.toMatchObject({ code: "CX001" });
    await service.query("select api.escalate($1, 'Example')", [initial.conversation_id]);
    const { rows: [{ id: queuedId }] } = await owner.query<{ id: number }>(
      `insert into core.outbox (brand_id, channel_id, conversation_id, destination, body, document_file_id)
       values (1, $1, $2, $3, 'Test delivery', $4) returning id::int`,
      [channelId, initial.conversation_id, phone.digits + "@c.us", fileId],
    );
    const { rows: [claimed] } = await service.query<{ id: string; attempts: number }>("select * from api.claim_outbox(1)");
    expect(Number(claimed.id)).toBe(queuedId);
    expect((await service.query("select api.begin_outbox_send($1, $2) as status", [claimed.id, claimed.attempts])).rows[0].status)
      .toBe("send");

    const originalChat = "1000012345:2@lid";
    const another = await coreApiClient();
    try {
      const results = await Promise.all([
        reset(session, "reset", phone.e164, originalChat),
        reset(session, "reset", phone.e164, originalChat, another),
      ]);
      expect(results.sort()).toEqual(["duplicate", "reset"]);
    } finally {
      await another.end();
    }

    const { rows: [remaining] } = await owner.query(
      `select exists(select 1 from public.contacts where id = $1) as contact,
              exists(select 1 from public.tasks where contact_id = $1) as task,
              exists(select 1 from core.conversations where id = $2) as conversation,
              exists(select 1 from core.messages where conversation_id = $2) as message,
              exists(select 1 from public.deals where id = $3) as deal,
              exists(select 1 from core.quotes where id = $4) as quote,
              exists(select 1 from core.appointments where id = $5) as appointment,
              exists(select 1 from core.documents where id = $6) as document,
              exists(select 1 from core.document_files where id = $7) as file`,
      [lead.contactId, initial.conversation_id, lead.dealId, quoteId, hold.id, documentId, fileId],
    );
    expect(remaining).toEqual({
      contact: false, task: false, conversation: false, message: false, deal: false, quote: false,
      appointment: false, document: false, file: false,
    });
    expect(await ingest(session, "setup", phone.e164)).toEqual({ status: "duplicate" });

    const { rows: [ack] } = await owner.query(
      `select destination, body, sender, conversation_id
       from core.outbox where channel_id = $1 and status = 'pending'`, [channelId],
    );
    expect(ack).toEqual({
      destination: originalChat,
      body: "Listo. Reinicié tu conversación y borré tus datos de prueba.",
      sender: "human",
      conversation_id: null,
    });
    expect((await service.query("select * from api.claim_outbox(1)")).rowCount).toBe(0);
    expect((await owner.query("select count(*)::int as total from core.outbox_send_attempts where outbox_id = $1", [queuedId])).rows[0].total)
      .toBe(1);
    await service.query("select api.finish_paced_outbox($1, $2, 'retry', null)", [claimed.id, claimed.attempts]);
    expect((await owner.query("select status, body, destination, last_error from core.outbox where id = $1", [queuedId])).rows[0])
      .toEqual({ status: "failed", body: "", destination: "", last_error: "team_reset" });
    await owner.query("update core.outbox_send_attempts set started_at = now() - interval '2 minutes' where outbox_id = $1", [queuedId]);
    expect((await service.query("select destination, body from api.claim_outbox(1)")).rows[0]).toEqual({
      destination: originalChat, body: ack.body,
    });

    const after = await ingest(session, "new-message", phone.e164);
    expect(after).toMatchObject({ status: "accepted" });
    expect((await records(after.conversation_id)).contactId).not.toBe(lead.contactId);
    expect((await records(after.conversation_id)).is_test).toBe(true);
    await clearOutboxForTest(owner);
  });

  it("keeps earlier customer records safe and limits authorization to the current brand", async () => {
    const { session, id: channelId } = await channel();
    const phone = fakePhone();
    const chat = phone.digits + "@c.us";
    expect(await reset(session, "unauthorized", phone.e164, chat)).toBe("not_authorized");
    const accepted = await ingest(session, "unauthorized", phone.e164, "reiniciar");
    const lead = await records(accepted.conversation_id);
    expect(lead).toMatchObject({ is_test: false, deal_is_test: false });

    const { rows: [{ id: otherBrand }] } = await owner.query<{ id: number }>(
      "insert into core.brands (slug, name, timezone) values ('another-reset-brand', 'Another brand', 'UTC') returning id::int",
    );
    await allow(phone.e164, otherBrand);
    expect(await reset(session, "still-unauthorized", phone.e164, chat)).toBe("not_authorized");

    await allow(phone.e164);
    expect(await reset(session, "protected", phone.e164, chat)).toBe("protected");
    expect(await records(accepted.conversation_id)).toEqual(lead);
    expect(await reset(session, "protected", phone.e164, chat)).toBe("duplicate");
    const { rows } = await owner.query("select destination, body from core.outbox where channel_id = $1 and status = 'pending'", [channelId]);
    expect(rows).toEqual([{ destination: chat, body: "No reinicié la conversación porque hay datos fuera del entorno de pruebas." }]);
    await clearOutboxForTest(owner);
  });

  it("keeps an escalated LID webhook deduplicated after the phone becomes known", async () => {
    const { session, id } = await channel();
    const phone = fakePhone();
    await allow(phone.e164);
    const chat = "1029384756@lid";
    await owner.query(
      "insert into core.waha_lid_escalations (channel_id, provider_message_id, chat_id) values ($1, $2, $3)",
      [id, "already-escalated", chat],
    );
    expect(await reset(session, "already-escalated", phone.e164, chat)).toBe("duplicate");
    expect((await owner.query("select count(*)::int as total from core.outbox where channel_id = $1", [id])).rows[0].total).toBe(0);
  });
});
