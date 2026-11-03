import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSetup, type Setup } from "../agenda-helpers.ts";
import { coreApiClient, ownerClient } from "../helpers.ts";

const CODE = { invalidInput: "CX004", invalidState: "CX002", holdExpired: "CX003", taken: "CX005" };

/** A day in the near future, at the given UTC hour. Brands of these tests use UTC. */
const at = (hour: number, daysAhead = 3): string => {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

describe("the editable calendar: what staff can do with appointments", () => {
  let owner: pg.Client;
  let api: pg.Client;

  beforeAll(async () => {
    owner = await ownerClient();
    api = await coreApiClient();
  });
  afterAll(async () => {
    await api.end();
    await owner.end();
  });

  const brand = (options: Parameters<typeof createSetup>[1] = {}) => createSetup(owner, { technicians: 2, minNoticeMinutes: 0, ...options });

  const lead = async (setup: Setup, options: { address?: string; quote?: boolean } = {}) => {
    const contact = await owner.query<{ id: number }>(
      "insert into public.contacts (first_name, last_name, brand_id) values ('Cliente', 'Prueba-no', $1) returning id::int",
      [setup.brandId],
    );
    // "Prueba-no" does not start with "Prueba": the contact is a real one.
    const contactId = contact.rows[0].id;
    const deal = await owner.query<{ id: number }>(
      `insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, service_address)
       values ('Servicio', 'opportunity', array[$1::bigint], $1, $2, $3) returning id::int`,
      [contactId, setup.brandId, options.address ?? null],
    );
    const dealId = deal.rows[0].id;
    if (options.quote) {
      await owner.query("insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs) values ($1, 1860, 0, '{}')", [dealId]);
    }
    return { contactId, dealId };
  };

  const book = (dealId: number, technicianId: number, start: string, address: string | null = null, confirm = false) =>
    api.query("select api.staff_book($1, $2, $3, $4, $5) as r", [dealId, technicianId, start, address, confirm]).then((result) => result.rows[0].r);

  const statusOf = async (id: number) => (await owner.query("select status from core.appointments where id = $1", [id])).rows[0].status as string;

  describe("booking", () => {
    it("books a hold for the technician, with the expiry of the brand and the contact of the opportunity", async () => {
      const setup = await brand();
      const { dealId, contactId } = await lead(setup);

      const result = await book(dealId, setup.technicianIds[0], at(10), "123 Main St, Orlando");

      expect(result).toMatchObject({ estado: "hold", tecnico_id: setup.technicianIds[0] });
      const { rows } = await owner.query("select contact_id::int, address, end_at - start_at as length, hold_expires_at > now() as live from core.appointments where id = $1", [result.id]);
      expect(rows[0]).toMatchObject({ contact_id: contactId, address: "123 Main St, Orlando", live: true });
      expect(rows[0].length).toEqual({ hours: 1 });
    });

    it("never lets two bookings share a technician's time, margin included", async () => {
      const setup = await brand({ technicians: 1 });
      const first = await lead(setup);
      const second = await lead(setup);
      await book(first.dealId, setup.technicianIds[0], at(10));

      // Same time, and 15 minutes after the end (the margin is 30).
      await expect(book(second.dealId, setup.technicianIds[0], at(10))).rejects.toMatchObject({ message: expect.stringContaining("taken"), code: CODE.taken });
      const overlapping = new Date(new Date(at(11)).getTime() + 15 * 60_000).toISOString();
      await expect(book(second.dealId, setup.technicianIds[0], overlapping)).rejects.toMatchObject({ code: CODE.taken });
      // After the margin it is free.
      await expect(book(second.dealId, setup.technicianIds[0], at(12))).resolves.toMatchObject({ estado: "hold" });
    });

    it("lets another technician take the same time", async () => {
      const setup = await brand();
      const first = await lead(setup);
      const second = await lead(setup);
      await book(first.dealId, setup.technicianIds[0], at(10));
      await expect(book(second.dealId, setup.technicianIds[1], at(10))).resolves.toMatchObject({ estado: "hold" });
    });

    it("only one of many simultaneous bookings of the same time wins, every round", async () => {
      const setup = await brand({ technicians: 2, from: "08:00", to: "22:00" });
      const leads = await Promise.all(Array.from({ length: 8 }, () => lead(setup)));
      const clients = await Promise.all(leads.map(() => coreApiClient()));
      try {
        // The clash can end in a deadlock instead of a clean rejection when sessions are not queued: repeat it.
        for (let round = 0; round < 5; round++) {
          const start = at(8 + round * 2);
          const results = await Promise.allSettled(
            clients.map((client, index) => client.query("select api.staff_book($1, $2, $3, null, false)", [leads[index].dealId, setup.technicianIds[index % 2], start])),
          );
          // Two technicians: two bookings fit at the same time, every other one is refused cleanly.
          expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
          for (const result of results.filter((entry) => entry.status === "rejected")) {
            expect((result as PromiseRejectedResult).reason).toMatchObject({ code: CODE.taken });
          }
        }
      } finally {
        await Promise.all(clients.map((client) => client.end()));
      }
    });

    it.each([
      ["outside the availability of the technician", () => at(20)],
      ["in the past", () => at(10, -1)],
    ])("refuses a time %s", async (_label, when) => {
      const setup = await brand();
      const { dealId } = await lead(setup);
      await expect(book(dealId, setup.technicianIds[0], when())).rejects.toMatchObject({ code: CODE.invalidInput });
    });

    it("refuses a technician of another brand, and an unknown opportunity", async () => {
      const mine = await brand();
      const other = await brand();
      const { dealId } = await lead(mine);
      await expect(book(dealId, other.technicianIds[0], at(10))).rejects.toMatchObject({ code: CODE.invalidInput });
      await expect(book(999_999_999, mine.technicianIds[0], at(10))).rejects.toMatchObject({ code: CODE.invalidInput });
    });

    it("replaces the previous hold of the same customer instead of piling them up", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup);
      const first = await book(dealId, setup.technicianIds[0], at(10));
      const second = await book(dealId, setup.technicianIds[0], at(14));
      expect(await statusOf(first.id)).toBe("cancelled");
      expect(await statusOf(second.id)).toBe("hold");
    });

    it("does not let the time-off of a technician be booked", async () => {
      const setup = await brand({ technicians: 1 });
      const { dealId } = await lead(setup);
      await api.query("select api.add_time_off($1, $2, $3, 'vacaciones')", [setup.technicianIds[0], at(9), at(13)]);
      await expect(book(dealId, setup.technicianIds[0], at(10))).rejects.toMatchObject({ code: CODE.invalidInput });
      await expect(book(dealId, setup.technicianIds[0], at(14))).resolves.toMatchObject({ estado: "hold" });
    });
  });

  describe("confirming", () => {
    it("needs an address and a sent quote, like the bot", async () => {
      const setup = await brand();
      const noAddress = await lead(setup, { quote: true });
      const noQuote = await lead(setup, { address: "1 Main St" });
      const held = await book(noAddress.dealId, setup.technicianIds[0], at(10));
      const heldToo = await book(noQuote.dealId, setup.technicianIds[1], at(10));

      await expect(api.query("select api.staff_confirm($1)", [held.id])).rejects.toMatchObject({ code: CODE.invalidState, message: expect.stringContaining("address") });
      await expect(api.query("select api.staff_confirm($1)", [heldToo.id])).rejects.toMatchObject({ code: CODE.invalidState, message: expect.stringContaining("quote") });
      expect(await statusOf(held.id)).toBe("hold");
    });

    it("confirms, wins the sale and keeps the address", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup, { quote: true });

      const result = await book(dealId, setup.technicianIds[0], at(10), "9 Pine Ave, Orlando", true);

      expect(result.estado).toBe("confirmed");
      const { rows } = await owner.query("select (select stage from public.deals where id = $1) as stage, (select address from core.appointments where id = $2) as address, (select hold_expires_at from core.appointments where id = $2) as expiry", [dealId, result.id]);
      expect(rows[0]).toEqual({ stage: "won", address: "9 Pine Ave, Orlando", expiry: null });
    });

    it("refuses a hold that ran out", async () => {
      const setup = await brand();
      const { dealId, contactId } = await lead(setup, { quote: true, address: "1 Main St" });
      // A hold whose time has already passed, which only a raw insert can create.
      const { rows } = await owner.query(
        `insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, hold_expires_at)
         values ($1, $2, $3, $4, $4::timestamptz + interval '1 hour', now() - interval '1 minute') returning id::int`,
        [dealId, contactId, setup.technicianIds[0], at(10)],
      );
      const held = rows[0];

      await expect(api.query("select api.staff_confirm($1)", [held.id])).rejects.toMatchObject({ code: CODE.holdExpired });
      expect(await statusOf(held.id)).toBe("hold");
    });

    it("cannot confirm what is not a hold", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup, { quote: true, address: "1 Main St" });
      const confirmed = await book(dealId, setup.technicianIds[0], at(10), null, true);
      await expect(api.query("select api.staff_confirm($1)", [confirmed.id])).rejects.toMatchObject({ code: CODE.invalidState });
    });

    it("does not book a second appointment for a service that is already scheduled", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup, { quote: true, address: "1 Main St" });
      await book(dealId, setup.technicianIds[0], at(10), null, true);
      await expect(book(dealId, setup.technicianIds[1], at(14))).rejects.toMatchObject({ code: CODE.invalidState });
    });
  });

  describe("cancelling", () => {
    it("frees the time for another booking, and cannot be done twice", async () => {
      const setup = await brand({ technicians: 1 });
      const first = await lead(setup);
      const second = await lead(setup);
      const held = await book(first.dealId, setup.technicianIds[0], at(10));

      await api.query("select api.staff_cancel($1)", [held.id]);

      expect(await statusOf(held.id)).toBe("cancelled");
      await expect(book(second.dealId, setup.technicianIds[0], at(10))).resolves.toMatchObject({ estado: "hold" });
      await expect(api.query("select api.staff_cancel($1)", [held.id])).rejects.toMatchObject({ code: CODE.invalidState });
    });
  });

  describe("rescheduling", () => {
    it("moves a confirmed appointment and keeps it confirmed, with the old one cancelled", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup, { quote: true, address: "1 Main St" });
      const old = await book(dealId, setup.technicianIds[0], at(10), null, true);

      const moved = (await api.query("select api.staff_reschedule($1, $2, $3) as r", [old.id, setup.technicianIds[1], at(14)])).rows[0].r;

      expect(moved).toMatchObject({ estado: "confirmed", tecnico_id: setup.technicianIds[1], reemplaza: old.id });
      expect(await statusOf(old.id)).toBe("cancelled");
      expect((await owner.query("select address from core.appointments where id = $1", [moved.id])).rows[0].address).toBe("1 Main St");
    });

    it("moves it to a time that overlaps its own old one", async () => {
      const setup = await brand({ technicians: 1 });
      const { dealId } = await lead(setup);
      const old = await book(dealId, setup.technicianIds[0], at(10));
      await expect(api.query("select api.staff_reschedule($1, $2, $3)", [old.id, setup.technicianIds[0], at(11)])).resolves.toBeDefined();
    });

    it("changes nothing when the new time is taken", async () => {
      const setup = await brand({ technicians: 1 });
      const mine = await lead(setup, { quote: true, address: "1 Main St" });
      const theirs = await lead(setup);
      const old = await book(mine.dealId, setup.technicianIds[0], at(10), null, true);
      await book(theirs.dealId, setup.technicianIds[0], at(14));

      await expect(api.query("select api.staff_reschedule($1, $2, $3)", [old.id, setup.technicianIds[0], at(14)])).rejects.toMatchObject({ code: CODE.taken });

      expect(await statusOf(old.id)).toBe("confirmed");
    });

    it("gives a moved hold a new hold, and refuses a move to the same time or of a finished appointment", async () => {
      const setup = await brand();
      const { dealId } = await lead(setup);
      const old = await book(dealId, setup.technicianIds[0], at(10));

      const moved = (await api.query("select api.staff_reschedule($1, $2, $3) as r", [old.id, setup.technicianIds[0], at(14)])).rows[0].r;
      expect(moved.estado).toBe("hold");
      await expect(api.query("select api.staff_reschedule($1, $2, $3)", [moved.id, setup.technicianIds[0], at(14)])).rejects.toMatchObject({ code: CODE.invalidInput });
      await expect(api.query("select api.staff_reschedule($1, $2, $3)", [old.id, setup.technicianIds[0], at(15)])).rejects.toMatchObject({ code: CODE.invalidState });
    });
  });

  describe("availability", () => {
    const windows = (technicianId: number, list: unknown) => api.query("select api.set_availability($1, $2::jsonb) as r", [technicianId, JSON.stringify(list)]).then((result) => result.rows[0].r);

    it("replaces the weekly windows as a whole", async () => {
      const setup = await brand({ technicians: 1 });
      const result = await windows(setup.technicianIds[0], [
        { weekday: 1, start: "08:00", end: "12:00" },
        { weekday: 1, start: "13:00", end: "17:00" },
        { weekday: 3, start: "09:00", end: "10:00" },
      ]);
      expect(result).toMatchObject({ ventanas: 3 });
      const { rows } = await owner.query("select weekday, to_char(start_time, 'HH24:MI') as s, to_char(end_time, 'HH24:MI') as e from core.technician_availability where technician_id = $1 order by weekday, start_time", [setup.technicianIds[0]]);
      expect(rows).toEqual([
        { weekday: 1, s: "08:00", e: "12:00" },
        { weekday: 1, s: "13:00", e: "17:00" },
        { weekday: 3, s: "09:00", e: "10:00" },
      ]);
    });

    it.each([
      ["a weekday that does not exist", [{ weekday: 7, start: "09:00", end: "10:00" }]],
      ["an end before the start", [{ weekday: 1, start: "10:00", end: "09:00" }]],
      ["overlapping windows in one day", [{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }]],
      ["a time that is not a time", [{ weekday: 1, start: "mañana", end: "10:00" }]],
      ["something that is not a list", { weekday: 1 }],
      ["a window that is not an object", ["lunes"]],
    ])("refuses %s and keeps the old windows", async (_label, list) => {
      const setup = await brand({ technicians: 1 });
      await expect(windows(setup.technicianIds[0], list)).rejects.toMatchObject({ code: CODE.invalidInput });
      expect((await owner.query("select count(*)::int as n from core.technician_availability where technician_id = $1", [setup.technicianIds[0]])).rows[0].n).toBe(7);
    });

    it("takes away the times that are no longer offered, and says how many booked ones now fall outside", async () => {
      const setup = await brand({ technicians: 1 });
      const { dealId } = await lead(setup);
      await book(dealId, setup.technicianIds[0], at(10));

      const result = await windows(setup.technicianIds[0], []);

      expect(result).toEqual({ ventanas: 0, citas_fuera: 1 });
      const other = await lead(setup);
      await expect(book(other.dealId, setup.technicianIds[0], at(14))).rejects.toMatchObject({ code: CODE.invalidInput });
    });
  });

  describe("time off", () => {
    it("says how many booked appointments it covers, and can be removed", async () => {
      const setup = await brand({ technicians: 1 });
      const { dealId } = await lead(setup);
      await book(dealId, setup.technicianIds[0], at(10));

      const added = (await api.query("select api.add_time_off($1, $2, $3, 'médico') as r", [setup.technicianIds[0], at(9), at(12)])).rows[0].r;
      expect(added.citas_en_conflicto).toBe(1);

      await api.query("select api.remove_time_off($1)", [added.id]);
      await expect(api.query("select api.remove_time_off($1)", [added.id])).rejects.toMatchObject({ code: CODE.invalidInput });
    });

    it("refuses an end before the start", async () => {
      const setup = await brand({ technicians: 1 });
      await expect(api.query("select api.add_time_off($1, $2, $3, null)", [setup.technicianIds[0], at(12), at(9)])).rejects.toMatchObject({ code: CODE.invalidInput });
    });
  });

  describe("what the panel reads", () => {
    it("lists the technicians with their windows, their time off and the time zone of the brand", async () => {
      const setup = await brand({ technicians: 1, timezone: "America/New_York", weekdays: [1] });
      await api.query("select api.add_time_off($1, $2, $3, 'feriado')", [setup.technicianIds[0], at(9), at(17)]);

      const { rows } = await owner.query("select name, timezone, availability, time_off from public.technicians_summary where id = $1", [setup.technicianIds[0]]);

      expect(rows[0].timezone).toBe("America/New_York");
      expect(rows[0].availability).toEqual([{ id: expect.any(Number), weekday: 1, start: "09:00", end: "17:00" }]);
      expect(rows[0].time_off).toEqual([expect.objectContaining({ reason: "feriado" })]);
    });
  });
});
