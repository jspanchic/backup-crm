import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLead, createQuote, createTechnician, insertHold, ownerClient, setStatus, type Lead } from "../helpers.ts";

const at = (time: string) => `2031-05-06T${time}:00Z`;

describe("documents", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = await ownerClient();
  });
  afterAll(() => db.end());

  const issue = async (
    client: pg.Client,
    type: string,
    dealId: number,
    quoteId: number,
    appointmentId: number | null = null,
  ) => {
    const { rows } = await client.query(
      `insert into core.documents (document_type, deal_id, quote_id, appointment_id, payload)
       values ($1, $2, $3, $4, $5) returning id::int, number::int, display_number, is_test, status`,
      [type, dealId, quoteId, appointmentId, JSON.stringify({ total: 208 })],
    );
    return rows[0];
  };

  const quotedLead = async (options?: { isTest?: boolean }): Promise<Lead & { quoteId: number }> => {
    const lead = await createLead(db, options);
    return { ...lead, quoteId: await createQuote(db, lead.dealId) };
  };

  const heldLead = async (options?: { isTest?: boolean }) => {
    const lead = await quotedLead(options);
    const hold = await insertHold(db, lead, await createTechnician(db), at("10:00"), at("11:00"));
    return { ...lead, appointmentId: hold.id };
  };

  describe("numbering", () => {
    it("is consecutive and separate for each document type", async () => {
      const first = await quotedLead();
      const second = await quotedLead();
      const a = await issue(db, "quote", first.dealId, first.quoteId);
      const b = await issue(db, "quote", second.dealId, second.quoteId);
      expect(b.number).toBe(a.number + 1);
      expect(a.display_number).toBe(`COT-${String(a.number).padStart(6, "0")}`);

      const held = await heldLead();
      const order = await issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId);
      expect(order.display_number).toMatch(/^OC-\d{6}$/);
    });

    it("leaves no gap when an issue is rolled back", async () => {
      const lead = await quotedLead();
      const other = await quotedLead();
      const before = await issue(db, "quote", other.dealId, other.quoteId);

      await db.query("begin");
      await issue(db, "quote", lead.dealId, lead.quoteId);
      await db.query("rollback");

      const after = await issue(db, "quote", lead.dealId, lead.quoteId);
      expect(after.number).toBe(before.number + 1);
    });

    it("gives unique, consecutive numbers under concurrency", async () => {
      const leads = await Promise.all(Array.from({ length: 6 }, () => quotedLead()));
      const clients = await Promise.all(leads.map(() => ownerClient()));
      try {
        const issued = await Promise.all(
          leads.map((lead, index) => issue(clients[index], "quote", lead.dealId, lead.quoteId)),
        );
        const numbers = issued.map((document) => document.number).sort((a, b) => a - b);
        expect(numbers).toEqual(numbers.map((_, index) => numbers[0] + index));
      } finally {
        await Promise.all(clients.map((client) => client.end()));
      }
    });

    it("keeps test leads in their own series, so the real one has no gaps", async () => {
      const real = await quotedLead();
      const before = await issue(db, "quote", real.dealId, real.quoteId);

      const test = await quotedLead({ isTest: true });
      const testDocument = await issue(db, "quote", test.dealId, test.quoteId);
      expect(testDocument.is_test).toBe(true);
      expect(testDocument.display_number).toMatch(/^PRUEBA-COT-\d{6}$/);

      const realAgain = await quotedLead();
      const after = await issue(db, "quote", realAgain.dealId, realAgain.quoteId);
      expect(after.number).toBe(before.number + 1);
    });

    it("ignores a number sent by the caller", async () => {
      const lead = await quotedLead();
      const { rows } = await db.query(
        `insert into core.documents (document_type, deal_id, quote_id, payload, number, display_number, is_test)
         values ('quote', $1, $2, '{}', 999999, 'FAKE', true) returning number::int, display_number, is_test`,
        [lead.dealId, lead.quoteId],
      );
      expect(rows[0].number).not.toBe(999999);
      expect(rows[0].display_number).toMatch(/^COT-/);
      expect(rows[0].is_test).toBe(false);
    });
  });

  describe("amounts", () => {
    it("takes every amount from the quote, replacing what the caller wrote", async () => {
      const lead = await quotedLead();
      const { rows } = await db.query(
        `insert into core.documents (document_type, deal_id, quote_id, payload)
         values ('quote', $1, $2, $3) returning payload`,
        [lead.dealId, lead.quoteId, JSON.stringify({ total: 1, subtotal: 1, discount: 999, currency: "EUR", customer: "Ana" })],
      );
      expect(rows[0].payload).toMatchObject({
        total: 208,
        subtotal: 223.2,
        discount: 15.62,
        currency: "USD",
        price_confirmed: false,
        customer: "Ana",
      });
    });
  });

  describe("immutability", () => {
    it("cannot be edited or deleted", async () => {
      const lead = await quotedLead();
      const document = await issue(db, "quote", lead.dealId, lead.quoteId);

      for (const change of ["payload = '{\"total\": 1}'", "number = 1", "deal_id = deal_id + 1", "issued_at = now() - interval '1 day'"]) {
        await expect(db.query(`update core.documents set ${change} where id = $1`, [document.id])).rejects.toMatchObject({
          code: "CX001",
        });
      }
      await expect(db.query("delete from core.documents where id = $1", [document.id])).rejects.toMatchObject({
        code: "CX001",
      });
    });

    it("can only be voided, once, with a reason", async () => {
      const lead = await quotedLead();
      const document = await issue(db, "quote", lead.dealId, lead.quoteId);

      await expect(
        db.query("update core.documents set status = 'voided', voided_at = now() where id = $1", [document.id]),
      ).rejects.toMatchObject({ code: "23514" });

      await db.query(
        "update core.documents set status = 'voided', voided_at = now(), void_reason = 'wrong data' where id = $1",
        [document.id],
      );
      await expect(
        db.query("update core.documents set status = 'issued', voided_at = null, void_reason = null where id = $1", [
          document.id,
        ]),
      ).rejects.toMatchObject({ code: "CX001" });
    });
  });

  describe("links to the deal", () => {
    it("requires a deal and a quote of that deal", async () => {
      const lead = await quotedLead();
      const other = await quotedLead();

      await expect(
        db.query(`insert into core.documents (document_type, quote_id, payload) values ('quote', $1, '{}')`, [lead.quoteId]),
      ).rejects.toMatchObject({ code: "CX004" });
      await expect(issue(db, "quote", lead.dealId, other.quoteId)).rejects.toMatchObject({ code: "CX004" });
    });

    it("does not let a deal with documents be deleted", async () => {
      const lead = await quotedLead();
      await issue(db, "quote", lead.dealId, lead.quoteId);
      await expect(db.query("delete from public.deals where id = $1", [lead.dealId])).rejects.toMatchObject({
        code: "23503",
      });
    });

    it("allows one document per quote", async () => {
      const lead = await quotedLead();
      await issue(db, "quote", lead.dealId, lead.quoteId);
      await expect(issue(db, "quote", lead.dealId, lead.quoteId)).rejects.toMatchObject({ code: "23505" });
    });

    it("rejects a quote document tied to an appointment, and an order without one", async () => {
      const held = await heldLead();
      await expect(issue(db, "quote", held.dealId, held.quoteId, held.appointmentId)).rejects.toMatchObject({
        code: "23514",
      });
      await expect(issue(db, "purchase_order", held.dealId, held.quoteId)).rejects.toMatchObject({ code: "CX004" });
    });

    it("rejects an appointment from another deal", async () => {
      const held = await heldLead();
      const other = await quotedLead();
      await expect(issue(db, "purchase_order", other.dealId, other.quoteId, held.appointmentId)).rejects.toMatchObject({
        code: "CX004",
      });
    });
  });

  describe("orders follow the state of the appointment", () => {
    it("issues a purchase order on a live hold, but not a work order", async () => {
      const held = await heldLead();
      await expect(issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId)).resolves.toMatchObject({
        status: "issued",
      });
      await expect(issue(db, "work_order", held.dealId, held.quoteId, held.appointmentId)).rejects.toMatchObject({
        code: "CX002",
      });
    });

    it("issues a work order once the appointment is confirmed", async () => {
      const held = await heldLead();
      await setStatus(db, held.appointmentId, "confirmed");
      await expect(issue(db, "work_order", held.dealId, held.quoteId, held.appointmentId)).resolves.toMatchObject({
        status: "issued",
      });
    });

    it("rejects orders for a cancelled appointment", async () => {
      const held = await heldLead();
      await setStatus(db, held.appointmentId, "cancelled");
      await expect(issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId)).rejects.toMatchObject({
        code: "CX002",
      });
    });

    it("allows one live order per appointment; voiding frees it with a new number", async () => {
      const held = await heldLead();
      const first = await issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId);
      await expect(issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId)).rejects.toMatchObject({
        code: "23505",
      });

      await db.query(
        "update core.documents set status = 'voided', voided_at = now(), void_reason = 'wrong date' where id = $1",
        [first.id],
      );
      const second = await issue(db, "purchase_order", held.dealId, held.quoteId, held.appointmentId);
      expect(second.number).toBeGreaterThan(first.number);
    });
  });
});
