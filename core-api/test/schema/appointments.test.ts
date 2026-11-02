import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLead, createTechnician, insertHold, ownerClient, setStatus } from "../helpers.ts";

const at = (time: string) => `2030-03-12T${time}:00Z`;
const OVERLAP = { code: "23P01" };

describe("appointments", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = await ownerClient();
  });
  afterAll(() => db.end());

  describe("no overlaps, enforced by the database", () => {
    it("rejects a second appointment that overlaps, even with a raw insert", async () => {
      const technician = await createTechnician(db);
      await insertHold(db, await createLead(db), technician, at("10:00"), at("11:00"));

      await expect(
        insertHold(db, await createLead(db), technician, at("10:30"), at("11:30")),
      ).rejects.toMatchObject(OVERLAP);
    });

    it("applies the configured margin on both sides of an appointment", async () => {
      // The sample settings use a 30 minute margin.
      const technician = await createTechnician(db);
      await insertHold(db, await createLead(db), technician, at("10:00"), at("11:00"));

      await expect(
        insertHold(db, await createLead(db), technician, at("11:15"), at("12:15")),
      ).rejects.toMatchObject(OVERLAP);
      await expect(
        insertHold(db, await createLead(db), technician, at("09:00"), at("10:00")),
      ).rejects.toMatchObject(OVERLAP);

      await expect(
        insertHold(db, await createLead(db), technician, at("11:30"), at("12:30")),
      ).resolves.toMatchObject({ status: "hold" });
      await expect(
        insertHold(db, await createLead(db), technician, at("08:30"), at("09:30")),
      ).resolves.toMatchObject({ status: "hold" });
    });

    it("lets another technician take the same time", async () => {
      await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));
      await expect(
        insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00")),
      ).resolves.toMatchObject({ status: "hold" });
    });

    it("does not count cancelled appointments", async () => {
      const technician = await createTechnician(db);
      const first = await insertHold(db, await createLead(db), technician, at("10:00"), at("11:00"));
      await setStatus(db, first.id, "cancelled");

      await expect(
        insertHold(db, await createLead(db), technician, at("10:00"), at("11:00")),
      ).resolves.toMatchObject({ status: "hold" });
    });

    it("does not count test appointments, which do not block real ones", async () => {
      const technician = await createTechnician(db);
      const test = await insertHold(db, await createLead(db, { isTest: true }), technician, at("10:00"), at("11:00"));
      expect(test.is_test).toBe(true);

      await expect(
        insertHold(db, await createLead(db), technician, at("10:00"), at("11:00")),
      ).resolves.toMatchObject({ is_test: false });
    });

    it("lets exactly one of two simultaneous bookings win", async () => {
      const technician = await createTechnician(db);
      const [a, b] = await Promise.all([createLead(db), createLead(db)]);
      const other = await ownerClient();
      try {
        const results = await Promise.allSettled([
          insertHold(db, a, technician, at("15:00"), at("16:00")),
          insertHold(other, b, technician, at("15:00"), at("16:00")),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: OVERLAP });
      } finally {
        await other.end();
      }
    });
  });

  describe("expired holds", () => {
    it("keeps the exclusion independent of the clock", async () => {
      const { rows } = await db.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'appointments_no_overlap'`,
      );
      expect(rows[0].def).toContain("EXCLUDE USING gist");
      expect(rows[0].def).not.toMatch(/now\(\)|current_|clock_|statement_timestamp/i);
    });

    it("blocks until marked expired, then frees the time for someone else", async () => {
      const technician = await createTechnician(db);
      const stale = await insertHold(db, await createLead(db), technician, at("10:00"), at("11:00"), {
        holdExpiresAt: "2020-01-01T00:00:00Z",
      });

      // An expired hold still in 'hold' blocks: this is why the booking function must mark it first.
      await expect(
        insertHold(db, await createLead(db), technician, at("10:00"), at("11:00")),
      ).rejects.toMatchObject(OVERLAP);

      await setStatus(db, stale.id, "expired");

      await expect(
        insertHold(db, await createLead(db), technician, at("10:00"), at("11:00")),
      ).resolves.toMatchObject({ status: "hold" });
    });

    it("refuses to confirm an expired hold", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"), {
        holdExpiresAt: "2020-01-01T00:00:00Z",
      });

      await expect(setStatus(db, hold.id, "confirmed")).rejects.toMatchObject({ code: "CX003" });
    });

    it("refuses to expire a hold that is still live", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));
      await expect(setStatus(db, hold.id, "expired")).rejects.toMatchObject({ code: "CX002" });
    });

    it("refuses to extend a hold", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));
      await expect(
        db.query("update core.appointments set hold_expires_at = now() + interval '1 day' where id = $1", [hold.id]),
      ).rejects.toMatchObject({ code: "CX002" });
    });
  });

  describe("a confirmation can only come from a live hold", () => {
    it("confirms a live hold and stamps it", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));
      expect(hold.hold_expires_at).not.toBeNull();

      await setStatus(db, hold.id, "confirmed");

      const { rows } = await db.query(
        "select status, confirmed_at, hold_expires_at from core.appointments where id = $1",
        [hold.id],
      );
      expect(rows[0].status).toBe("confirmed");
      expect(rows[0].confirmed_at).not.toBeNull();
      expect(rows[0].hold_expires_at).toBeNull();
    });

    it("rejects inserting an appointment as already confirmed", async () => {
      const lead = await createLead(db);
      await expect(
        db.query(
          `insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, status)
           values ($1, $2, $3, $4, $5, 'confirmed')`,
          [lead.dealId, lead.contactId, await createTechnician(db), at("10:00"), at("11:00")],
        ),
      ).rejects.toMatchObject({ code: "CX002" });
    });

    it.each(["cancelled", "expired"])("cannot revive a %s appointment", async (dead) => {
      const lead = await createLead(db);
      const hold = await insertHold(db, lead, await createTechnician(db), at("10:00"), at("11:00"), {
        holdExpiresAt: dead === "expired" ? "2020-01-01T00:00:00Z" : undefined,
      });
      await setStatus(db, hold.id, dead);

      await expect(setStatus(db, hold.id, "confirmed")).rejects.toMatchObject({ code: "CX002" });
      await expect(setStatus(db, hold.id, "hold")).rejects.toMatchObject({ code: "CX002" });
    });
  });

  describe("rules the caller cannot get around", () => {
    it("requires a deal", async () => {
      const lead = await createLead(db);
      await expect(
        db.query(
          `insert into core.appointments (contact_id, technician_id, start_at, end_at)
           values ($1, $2, $3, $4)`,
          [lead.contactId, await createTechnician(db), at("10:00"), at("11:00")],
        ),
      ).rejects.toMatchObject({ code: "CX004" });
    });

    it("requires the contact to be the primary contact of the deal", async () => {
      const lead = await createLead(db);
      const stranger = await createLead(db);
      await expect(
        insertHold(db, { dealId: lead.dealId, contactId: stranger.contactId }, await createTechnician(db), at("10:00"), at("11:00")),
      ).rejects.toMatchObject({ code: "CX004" });
    });

    it("takes is_test from the deal, so a real booking cannot pose as a test to skip the check", async () => {
      const technician = await createTechnician(db);
      await insertHold(db, await createLead(db), technician, at("10:00"), at("11:00"));
      const lead = await createLead(db);

      await expect(
        db.query(
          `insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, is_test)
           values ($1, $2, $3, $4, $5, true)`,
          [lead.dealId, lead.contactId, technician, at("10:00"), at("11:00")],
        ),
      ).rejects.toMatchObject(OVERLAP);
    });

    it("computes the blocked time itself, ignoring what the caller sends", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));
      expect(hold.blocked_until.toISOString()).toBe("2030-03-12T11:30:00.000Z");
    });

    it("allows one active hold per contact", async () => {
      const lead = await createLead(db);
      const technician = await createTechnician(db);
      await insertHold(db, lead, technician, at("10:00"), at("11:00"));

      await expect(insertHold(db, lead, technician, at("13:00"), at("14:00"))).rejects.toMatchObject({ code: "23505" });
    });

    it("does not let an appointment be moved or deleted", async () => {
      const hold = await insertHold(db, await createLead(db), await createTechnician(db), at("10:00"), at("11:00"));

      await expect(
        db.query("update core.appointments set start_at = start_at + interval '1 hour' where id = $1", [hold.id]),
      ).rejects.toMatchObject({ code: "CX001" });
      await expect(db.query("delete from core.appointments where id = $1", [hold.id])).rejects.toMatchObject({
        code: "CX001",
      });
    });

    it("does not let a deal with appointments be deleted", async () => {
      const lead = await createLead(db);
      await insertHold(db, lead, await createTechnician(db), at("10:00"), at("11:00"));
      await expect(db.query("delete from public.deals where id = $1", [lead.dealId])).rejects.toMatchObject({
        code: "23503",
      });
    });
  });
});
