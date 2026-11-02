import { randomInt } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLead, ownerClient } from "../helpers.ts";

const fakePhone = () => `+1555${randomInt(1_000_000, 9_999_999)}`;

describe("identities, holders and messages", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = await ownerClient();
  });
  afterAll(() => db.end());

  const createIdentity = async (value = fakePhone()) => {
    const { rows } = await db.query<{ id: number }>(
      "insert into core.contact_identities (brand_id, type, value) values (1, 'phone_e164', $1) returning id::int",
      [value],
    );
    return rows[0].id;
  };

  const addHolder = (identityId: number, contactId: number, validFrom = "now()", validTo: string | null = null) =>
    db.query(
      `insert into core.identity_holders (identity_id, contact_id, valid_from, valid_to, closed_reason)
       values ($1, $2, ${validFrom}, ${validTo ?? "null"}, ${validTo ? "'manual'" : "null"})`,
      [identityId, contactId],
    );

  const createChannel = async () => {
    const { rows } = await db.query<{ id: number }>(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref)
       values (1, 'waha', $1, 'javier', 'WAHA_HMAC_KEY') returning id::int`,
      [`session-${randomInt(1_000_000_000)}`],
    );
    return rows[0].id;
  };

  const createConversation = async (channelId: number, identityId: number, contactId: number) => {
    const { rows } = await db.query<{ id: number }>(
      `insert into core.conversations (brand_id, channel_id, identity_id, contact_id)
       values (1, $1, $2, $3) returning id::int`,
      [channelId, identityId, contactId],
    );
    return rows[0].id;
  };

  describe("the holder of a number is a period", () => {
    it("rejects two open holders for one identity", async () => {
      const identity = await createIdentity();
      await addHolder(identity, (await createLead(db)).contactId);
      await expect(addHolder(identity, (await createLead(db)).contactId)).rejects.toMatchObject({ code: "23P01" });
    });

    it("rejects overlapping periods", async () => {
      const identity = await createIdentity();
      const a = await createLead(db);
      const b = await createLead(db);
      await addHolder(identity, a.contactId, "'2026-01-01'", "'2026-03-01'");
      await expect(addHolder(identity, b.contactId, "'2026-02-01'", "'2026-04-01'")).rejects.toMatchObject({
        code: "23P01",
      });
    });

    it("keeps the previous holder when the number changes owner", async () => {
      const identity = await createIdentity();
      const previous = await createLead(db);
      const current = await createLead(db);
      await addHolder(identity, previous.contactId, "'2026-01-01'");

      await db.query(
        `update core.identity_holders set valid_to = '2026-06-01', closed_reason = 'reassigned_confirmed'
         where identity_id = $1 and valid_to is null`,
        [identity],
      );
      await addHolder(identity, current.contactId, "'2026-06-01'");

      const { rows } = await db.query(
        "select contact_id::int, valid_to from core.identity_holders where identity_id = $1 order by valid_from",
        [identity],
      );
      expect(rows.map((row) => row.contact_id)).toEqual([previous.contactId, current.contactId]);
      expect(rows[0].valid_to).not.toBeNull();
      expect(rows[1].valid_to).toBeNull();
    });

    it("requires a reason to close a period", async () => {
      const identity = await createIdentity();
      await addHolder(identity, (await createLead(db)).contactId, "'2026-01-01'");
      await expect(
        db.query("update core.identity_holders set valid_to = '2026-06-01' where identity_id = $1", [identity]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("does not let a contact with history be deleted", async () => {
      const identity = await createIdentity();
      const { contactId } = await createLead(db);
      await addHolder(identity, contactId);
      await expect(db.query("delete from public.contacts where id = $1", [contactId])).rejects.toMatchObject({
        code: "23503",
      });
    });
  });

  describe("identities", () => {
    it.each(["15550100123", "+0123456789", "+1555", "+1 555 010 0123", "abc"])("rejects %s as E.164", async (value) => {
      await expect(createIdentity(value)).rejects.toMatchObject({ code: "23514" });
    });

    it("is unique per brand", async () => {
      const value = fakePhone();
      await createIdentity(value);
      await expect(createIdentity(value)).rejects.toMatchObject({ code: "23505" });
    });

    it("stores a WhatsApp lid with no phone format", async () => {
      await expect(
        db.query("insert into core.contact_identities (brand_id, type, value) values (1, 'wa_lid', $1)", [
          `${randomInt(1_000_000_000)}@lid`,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  describe("conversations and messages", () => {
    const addMessage = (conversationId: number, channelId: number, providerId: string | null) =>
      db.query(
        `insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, provider_message_id, sent_at)
         values (1, $1, $2, 'in', 'client', 'hello', $3, now())`,
        [conversationId, channelId, providerId],
      );

    it("drops a duplicate message of the same channel", async () => {
      const channel = await createChannel();
      const conversation = await createConversation(channel, await createIdentity(), (await createLead(db)).contactId);
      await addMessage(conversation, channel, "false_1@c.us_ABC");
      await expect(addMessage(conversation, channel, "false_1@c.us_ABC")).rejects.toMatchObject({ code: "23505" });
    });

    it("allows the same id on another channel, and outbound messages with no id", async () => {
      const lead = await createLead(db);
      const channelA = await createChannel();
      const channelB = await createChannel();
      const identity = await createIdentity();
      const conversationA = await createConversation(channelA, identity, lead.contactId);
      const conversationB = await createConversation(channelB, identity, lead.contactId);

      await addMessage(conversationA, channelA, "false_1@c.us_ABC");
      await expect(addMessage(conversationB, channelB, "false_1@c.us_ABC")).resolves.toMatchObject({ rowCount: 1 });
      await addMessage(conversationA, channelA, null);
      await expect(addMessage(conversationA, channelA, null)).resolves.toMatchObject({ rowCount: 1 });
    });

    it("allows one open conversation per channel and identity", async () => {
      const channel = await createChannel();
      const identity = await createIdentity();
      const { contactId } = await createLead(db);
      const first = await createConversation(channel, identity, contactId);
      await expect(createConversation(channel, identity, contactId)).rejects.toMatchObject({ code: "23505" });

      await db.query("update core.conversations set closed_at = now(), closed_reason = 'holder_changed' where id = $1", [
        first,
      ]);
      await expect(createConversation(channel, identity, contactId)).resolves.toBeGreaterThan(first);
    });

    it("registers a provider and identifier only once", async () => {
      const identifier = `session-${randomInt(1_000_000_000)}`;
      const insert = () =>
        db.query(
          `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref)
           values (1, 'waha', $1, 'javier', 'WAHA_HMAC_KEY')`,
          [identifier],
        );
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("adds columns to Atomic without breaking its summary view", async () => {
    const { contactId } = await createLead(db);
    const { rows } = await db.query("select id::int from public.contacts_summary where id = $1", [contactId]);
    expect(rows).toEqual([{ id: contactId }]);
  });
});
