import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakePhone } from "../app-helpers.ts";
import { createLead, ownerClient } from "../helpers.ts";

describe("what the full panel reads", () => {
  let db: pg.Client;
  let channelId: number;

  beforeAll(async () => {
    db = await ownerClient();
    const { rows } = await db.query<{ id: number }>(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
       values (1, 'waha', $1, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', false) returning id::int`,
      [`panel-${randomUUID()}`],
    );
    channelId = rows[0].id;
  });
  afterAll(() => db.end());

  const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query(sql, params)).rows[0].v as T;

  describe("the conversation of a contact", () => {
    const conversationOf = async (contactId: number) => {
      const identity = await db.query<{ id: number }>(
        "insert into core.contact_identities (brand_id, type, value) values (1, 'phone_e164', $1) returning id::int",
        [fakePhone().e164],
      );
      const conversation = await db.query<{ id: number }>(
        "insert into core.conversations (brand_id, channel_id, identity_id, contact_id) values (1, $1, $2, $3) returning id::int",
        [channelId, identity.rows[0].id, contactId],
      );
      return conversation.rows[0].id;
    };
    const say = (conversationId: number, direction: "in" | "out", sender: "client" | "bot" | "human", body: string, at: string) =>
      db.query(
        `insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, sent_at)
         values (1, $1, $2, $3, $4, $5, $6)`,
        [conversationId, channelId, direction, sender, body, at],
      );

    it("gives each contact only its own messages, with who said them", async () => {
      const first = await createLead(db);
      const second = await createLead(db);
      const firstConversation = await conversationOf(first.contactId);
      const secondConversation = await conversationOf(second.contactId);
      await say(firstConversation, "in", "client", "Hola", "2026-01-01T10:00:00Z");
      await say(firstConversation, "out", "bot", "Hola, soy Javier", "2026-01-01T10:00:05Z");
      await say(secondConversation, "in", "client", "Otro cliente", "2026-01-01T10:01:00Z");

      const { rows } = await db.query(
        "select direction, sender, body from public.conversation_messages where contact_id = $1 order by sent_at",
        [first.contactId],
      );
      expect(rows).toEqual([
        { direction: "in", sender: "client", body: "Hola" },
        { direction: "out", sender: "bot", body: "Hola, soy Javier" },
      ]);
    });

    it("keeps the history with the previous holder of a number that changed owner", async () => {
      const old = await createLead(db);
      const conversation = await conversationOf(old.contactId);
      await say(conversation, "in", "client", "Soy el titular anterior", "2026-01-01T10:00:00Z");
      // The number now belongs to somebody else: the old contact keeps what was said while it was theirs.
      const other = await createLead(db);
      await db.query("update core.conversations set closed_at = now(), closed_reason = 'reassigned', superseded_by = $1 where id = $2", [
        await conversationOf(other.contactId),
        conversation,
      ]);
      expect(await scalar<number>("select count(*)::int v from public.conversation_messages where contact_id = $1", [old.contactId])).toBe(1);
      expect(await scalar<number>("select count(*)::int v from public.conversation_messages where contact_id = $1", [other.contactId])).toBe(0);
    });
  });

  describe("test leads out of the reports", () => {
    const addTask = (contactId: number) =>
      scalar<number>("insert into public.tasks (contact_id, text) values ($1, 'llamar') returning id::int as v", [contactId]);
    const addContactNote = (contactId: number) =>
      scalar<number>("insert into public.contact_notes (contact_id, text) values ($1, 'nota') returning id::int as v", [contactId]);
    const addDealNote = (dealId: number) =>
      scalar<number>("insert into public.deal_notes (deal_id, text) values ($1, 'nota') returning id::int as v", [dealId]);
    const isTest = (table: string, id: number) => scalar<boolean>(`select is_test v from public.${table} where id = $1`, [id]);

    it("marks what is created for a test lead, and leaves a real lead's alone", async () => {
      const test = await createLead(db, { isTest: true });
      const real = await createLead(db);
      expect(await isTest("tasks", await addTask(test.contactId))).toBe(true);
      expect(await isTest("contact_notes", await addContactNote(test.contactId))).toBe(true);
      expect(await isTest("deal_notes", await addDealNote(test.dealId))).toBe(true);
      expect(await isTest("tasks", await addTask(real.contactId))).toBe(false);
      expect(await isTest("contact_notes", await addContactNote(real.contactId))).toBe(false);
      expect(await isTest("deal_notes", await addDealNote(real.dealId))).toBe(false);
    });

    it("marks what already hangs from a lead that becomes a test", async () => {
      const lead = await createLead(db);
      const task = await addTask(lead.contactId);
      const note = await addContactNote(lead.contactId);
      const dealNote = await addDealNote(lead.dealId);

      await db.query("update public.contacts set first_name = 'Prueba Marta' where id = $1", [lead.contactId]);

      expect(await isTest("tasks", task)).toBe(true);
      expect(await isTest("contact_notes", note)).toBe(true);
      expect(await isTest("deal_notes", dealNote)).toBe(true);
    });

    it("shows the mark in the contact list and in the activity log", async () => {
      const test = await createLead(db, { isTest: true });
      const real = await createLead(db);
      await addContactNote(test.contactId);
      await addContactNote(real.contactId);

      const summary = await db.query("select id::int, is_test from public.contacts_summary where id = any($1)", [[test.contactId, real.contactId]]);
      expect(Object.fromEntries(summary.rows.map((row) => [row.id, row.is_test]))).toEqual({ [test.contactId]: true, [real.contactId]: false });

      const log = await db.query(
        "select id, is_test from public.activity_log where id = any($1)",
        [[`contact.${test.contactId}.created`, `contact.${real.contactId}.created`, `deal.${test.dealId}.created`, `deal.${real.dealId}.created`]],
      );
      expect(Object.fromEntries(log.rows.map((row) => [row.id, row.is_test]))).toEqual({
        [`contact.${test.contactId}.created`]: true,
        [`contact.${real.contactId}.created`]: false,
        [`deal.${test.dealId}.created`]: true,
        [`deal.${real.dealId}.created`]: false,
      });
      const notes = await db.query("select is_test from public.activity_log where id like 'contactNote.%' and (contact_note->>'contact_id')::int = $1", [test.contactId]);
      expect(notes.rows).toEqual([{ is_test: true }]);
    });
  });
});
