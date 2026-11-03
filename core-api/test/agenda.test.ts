import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slotLabel } from "../src/schedule-time.ts";
import { reviewReply, type ReplyFacts } from "../src/reply-review.ts";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import {
  appointmentsOf,
  at,
  createSetup,
  day,
  expireHold,
  freeTimes,
  sameInstant,
  startLead,
  toolCall,
  type Lead,
  type Setup,
  type SetupOptions,
} from "./agenda-helpers.ts";
import { ownerClient } from "./helpers.ts";

describe("agenda", () => {
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

  const setup = (options?: SetupOptions) => createSetup(owner, options);
  const lead = (s: Setup, options?: Parameters<typeof startLead>[3]) => startLead(test, owner, s, options);
  const call = (l: Lead, path: string, payload?: unknown, method: "GET" | "POST" = "POST") => toolCall(test, l.token, method, path, payload);
  const hold = (l: Lead, date: string, time: string) => call(l, "reservar", { inicio: at(date, time) });
  const scalar = async (sql: string, values: unknown[] = []) => (await owner.query(sql, values)).rows[0]?.n as number;

  /** Offers a day to the lead, then reserves one of its times. */
  const offerAndHold = async (l: Lead, date: string, time: string) => {
    await freeTimes(test, l, date);
    return hold(l, date, time);
  };

  describe("free times", () => {
    it("offers a grid of slot plus margin inside the technician's window", async () => {
      const s = await setup();
      const l = await lead(s);
      // 60 minute slots with a 30 minute margin, between 09:00 and 17:00
      expect(await freeTimes(test, l, day(3))).toEqual(["09:00", "10:30", "12:00", "13:30", "15:00"]);
    });

    it("gives each time a label the bot can read, in the language of the customer", async () => {
      const s = await setup({ timezone: "America/New_York" });
      const es = await lead(s);
      const en = await lead(s);
      await call(en, "guardar_datos", { idioma: "en" });
      const first = (await call(es, "horarios_libres", { desde: day(3), dias: 1 })).json();
      const second = (await call(en, "horarios_libres", { desde: day(3), dias: 1 })).json();
      expect(first.zona_horaria).toBe("America/New_York");
      expect(first.horarios[0].texto).toBe(slotLabel(first.horarios[0].inicio, "America/New_York", "es"));
      expect(first.horarios[0].texto).toMatch(/^\p{L}+ \d+ de \p{L}+ de \d{4}, 9:00 AM$/u);
      expect(second.horarios[0].texto).toMatch(/^\p{L}+, \p{L}+ \d+, \d{4}, 9:00 AM$/u);
    });

    it("converts the technician's local hours to UTC, in the brand's time zone", async () => {
      const s = await setup({ timezone: "America/New_York", from: "09:00", to: "11:00" });
      const l = await lead(s);
      const response = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json();
      // New York is UTC-5 in winter and UTC-4 in summer: either way 09:00 local is not 09:00 UTC
      const first = new Date(response.horarios[0].inicio);
      expect([13, 14]).toContain(first.getUTCHours());
      expect(first.getUTCMinutes()).toBe(0);
    });

    it("respects the days of the week a technician works", async () => {
      const s = await setup({ weekdays: [2, 4] });
      const l = await lead(s);
      const response = (await call(l, "horarios_libres", { desde: day(2), dias: 14 })).json();
      const weekdays = new Set((response.horarios as { inicio: string }[]).map((slot) => new Date(slot.inicio).getUTCDay()));
      expect([...weekdays].every((weekday) => weekday === 2 || weekday === 4)).toBe(true);
      expect(weekdays.size).toBeGreaterThan(0);
    });

    it("does not let a slot cross midnight", async () => {
      // A slot that would end after midnight is never offered, whatever the window says.
      const late = await lead(await setup({ from: "23:00", to: "23:59" }));
      expect(await freeTimes(test, late, day(3))).toEqual([]);
      const fits = await lead(await setup({ from: "22:00", to: "23:30" }));
      expect(await freeTimes(test, fits, day(3))).toEqual(["22:00"]);
    });

    it("leaves out times inside a technician's time off, and only those", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await owner.query("insert into core.technician_time_off (technician_id, period, reason) values ($1, tstzrange($2, $3, '[)'), 'visit')", [
        s.technicianIds[0],
        at(date, "10:00"),
        at(date, "12:00"),
      ]);
      expect(await freeTimes(test, l, date)).toEqual(["09:00", "12:00", "13:30", "15:00"]);
    });

    it("applies the minimum notice and the horizon", async () => {
      const tooSoon = await setup({ minNoticeMinutes: 60 * 24 * 30 });
      expect(await freeTimes(test, await lead(tooSoon), day(3), 5)).toEqual([]);

      const short = await setup({ horizonDays: 3 });
      const l = await lead(short);
      expect(await freeTimes(test, l, day(10))).toEqual([]);
      expect((await call(l, "horarios_libres", { desde: day(0), dias: 14 })).json().horarios.length).toBeGreaterThan(0);
    });

    it("starts today when asked for a date in the past", async () => {
      const s = await setup();
      const l = await lead(s);
      const response = (await call(l, "horarios_libres", { desde: "2020-01-01", dias: 1 })).json();
      expect(response.horarios.every((slot: { inicio: string }) => new Date(slot.inicio).getTime() > Date.now())).toBe(true);
    });

    it("lists at most 12 times, earliest first", async () => {
      const s = await setup();
      const l = await lead(s);
      const response = (await call(l, "horarios_libres", { desde: day(2), dias: 10 })).json();
      expect(response.horarios).toHaveLength(12);
      const starts = response.horarios.map((slot: { inicio: string }) => new Date(slot.inicio).getTime());
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    });

    it("offers a time once even with two technicians, and keeps offering it until both are busy", async () => {
      const s = await setup({ technicians: 2 });
      const [a, b, c] = [await lead(s), await lead(s), await lead(s)];
      const date = day(3);
      expect(await freeTimes(test, a, date)).toEqual(["09:00", "10:30", "12:00", "13:30", "15:00"]);

      await hold(a, date, "09:00");
      await freeTimes(test, b, date);
      expect((await hold(b, date, "09:00")).statusCode).toBe(200);
      expect(await freeTimes(test, c, date)).toEqual(["10:30", "12:00", "13:30", "15:00"]);
    });

    describe("what blocks a time", () => {
      const withAppointment = async (status: string, options: { isTest?: boolean; expired?: boolean } = {}) => {
        const s = await setup();
        const other = await lead(s, { pushName: "Other" });
        const l = await lead(s);
        const date = day(3);
        await freeTimes(test, other, date);
        await hold(other, date, "10:30");
        const [appointment] = await appointmentsOf(owner, other.dealId);
        if (options.expired) await expireHold(owner, appointment.id);
        else if (status === "confirmed") await owner.query("update core.appointments set status = 'confirmed' where id = $1", [appointment.id]);
        else if (status === "expired") {
          await expireHold(owner, appointment.id);
          await owner.query("update core.appointments set status = 'expired' where id = $1", [appointment.id]);
        } else if (status !== "hold") await owner.query("update core.appointments set status = $2 where id = $1", [appointment.id, status]);
        if (options.isTest) await owner.query("update core.appointments set is_test = true where id = $1", [appointment.id]);
        return { l, date, s };
      };

      it("blocks the time of a live hold and of a confirmed appointment, and only that time", async () => {
        for (const status of ["hold", "confirmed"]) {
          const { l, date } = await withAppointment(status);
          // 10:30 is taken; the margin means 09:00 and 12:00 are still free because they end before and start after
          expect(await freeTimes(test, l, date), status).toEqual(["09:00", "12:00", "13:30", "15:00"]);
        }
      });

      it.each(["cancelled", "expired"])("does not count a %s appointment", async (status) => {
        const { l, date } = await withAppointment(status);
        expect(await freeTimes(test, l, date)).toContain("10:30");
      });

      it("does not count a hold past its time, even before it was marked expired", async () => {
        const { l, date } = await withAppointment("hold", { expired: true });
        expect(await freeTimes(test, l, date)).toContain("10:30");
      });

      it("does not count an appointment of a test lead", async () => {
        const { l, date } = await withAppointment("hold", { isTest: true });
        expect(await freeTimes(test, l, date)).toContain("10:30");
      });

      it("does not block the customer's own hold: booking again replaces it", async () => {
        const s = await setup();
        const l = await lead(s);
        const date = day(3);
        await freeTimes(test, l, date);
        await hold(l, date, "10:30");
        expect(await freeTimes(test, l, date)).toContain("10:30");
      });
    });

    it.each([
      ["a day count of 0", { dias: 0 }],
      ["a day count of 15", { dias: 15 }],
      ["a fractional day count", { dias: 1.5 }],
      ["a date that is not a date", { desde: "mañana" }],
      ["a customer id", { dias: 1, contact_id: 1 }],
    ])("rejects %s", async (_name, body) => {
      const l = await lead(await setup());
      expect((await call(l, "horarios_libres", body)).statusCode).toBe(400);
    });

    it("accepts an empty body, which means the next 7 days", async () => {
      const l = await lead(await setup());
      expect((await toolCall(test, l.token, "POST", "horarios_libres")).statusCode).toBe(200);
    });
  });

  describe("reserving a time", () => {
    it("holds a time that was offered, for 15 minutes, linked to the opportunity", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await call(l, "guardar_datos", { direccion: "123 Main St" });
      await freeTimes(test, l, date);

      const response = await hold(l, date, "10:30");
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(sameInstant(body.inicio, at(date, "10:30"))).toBe(true);
      expect(sameInstant(body.fin, at(date, "11:30"))).toBe(true);
      expect(new Date(body.vence_en).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
      expect(new Date(body.vence_en).getTime() - Date.now()).toBeLessThan(16 * 60_000);

      expect(await appointmentsOf(owner, l.dealId)).toMatchObject([{ status: "hold", technician_id: s.technicianIds[0], address: "123 Main St", is_test: false }]);
    });

    it("refuses a time that was never offered in this conversation", async () => {
      const l = await lead(await setup());
      const response = await hold(l, day(3), "10:30");
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("slot_not_offered");
      expect(await scalar("select count(*)::int as n from core.appointments where contact_id = $1", [l.contactId])).toBe(0);
    });

    it("refuses a time offered to somebody else, and a time offered more than a day ago", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, a, date);
      expect((await hold(b, date, "10:30")).json().error).toBe("slot_not_offered");

      await owner.query("update core.offered_slots set offered_at = now() - interval '2 days' where conversation_id = $1", [a.conversationId]);
      expect((await hold(a, date, "10:30")).json().error).toBe("slot_not_offered");
    });

    it("refuses a time that is on the grid but was not in the list", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await freeTimes(test, l, date);
      expect((await hold(l, date, "11:00")).json().error).toBe("slot_not_offered");
    });

    it("replaces the customer's previous hold", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await freeTimes(test, l, date);
      await hold(l, date, "09:00");
      await hold(l, date, "12:00");
      expect((await appointmentsOf(owner, l.dealId)).map((row) => row.status)).toEqual(["cancelled", "hold"]);
    });

    it("keeps the previous hold if the new time cannot be taken", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, a, date);
      await freeTimes(test, b, date);
      await hold(a, date, "10:30");
      await hold(b, date, "09:00");

      const response = await hold(b, date, "10:30");
      expect(response.json().error).toBe("slot_taken");
      expect((await appointmentsOf(owner, b.dealId)).map((row) => row.status)).toEqual(["hold"]);
    });

    it("answers that a time is taken when somebody else got it first", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, a, date);
      await freeTimes(test, b, date);
      expect((await hold(a, date, "10:30")).statusCode).toBe(200);
      const second = await hold(b, date, "10:30");
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe("slot_taken");
    });

    it("needs an open opportunity, and does not book twice once the service is scheduled", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await freeTimes(test, l, date);
      await owner.query("update public.deals set stage = 'lost' where id = $1", [l.dealId]);
      expect((await hold(l, date, "10:30")).json().error).toBe("invalid_state");
    });

    it.each([
      ["a customer id", { inicio: "2030-01-01T10:00:00Z", contact_id: 1 }],
      ["a time with no offset", { inicio: "2030-01-01T10:00:00" }],
      ["text that is not a time", { inicio: "mañana a las 10" }],
      ["no time", {}],
    ])("rejects %s", async (_name, body) => {
      const l = await lead(await setup());
      expect((await call(l, "reservar", body)).statusCode).toBe(400);
    });

    it("answers 409 for everything while the conversation is paused", async () => {
      const l = await lead(await setup());
      await call(l, "escalar", { motivo: "ayuda" });
      for (const [path, body] of [["horarios_libres", {}], ["reservar", { inicio: at(day(3), "10:30") }], ["confirmar", {}]] as const) {
        expect((await call(l, path, body)).json(), path).toEqual({ error: "bot_paused" });
      }
    });

    it("does not let a test lead's hold block a real one, and a real hold is not undone by a test", async () => {
      const real = await setup();
      const testSetup = await setup({ isTest: true });
      // Same technician pool is not shared between brands, so the test lead uses a test channel of the same brand.
      await owner.query(
        "insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test) values ($1, 'waha', $2, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true)",
        [real.brandId, `${real.session}-test`],
      );
      const tester = await lead({ ...real, session: `${real.session}-test` });
      const customer = await lead(real);
      const date = day(3);
      await freeTimes(test, tester, date);
      await freeTimes(test, customer, date);

      expect((await hold(tester, date, "10:30")).statusCode).toBe(200);
      expect((await appointmentsOf(owner, tester.dealId))[0].is_test).toBe(true);
      expect(await freeTimes(test, customer, date)).toContain("10:30");
      expect((await hold(customer, date, "10:30")).statusCode).toBe(200);
      expect(testSetup.brandId).not.toBe(real.brandId);
    });
  });

  describe("simultaneous bookings: only one wins", () => {
    it("lets exactly one of two bookings of the same time through", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, a, date);
      await freeTimes(test, b, date);

      const results = await Promise.all([hold(a, date, "10:30"), hold(b, date, "10:30")]);

      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.statusCode === 409)!.json().error).toBe("slot_taken");
      expect(await scalar("select count(*)::int as n from core.appointments where technician_id = $1 and status = 'hold'", [s.technicianIds[0]])).toBe(1);
    });

    it("lets one of ten through with one technician, and two of six with two", async () => {
      const single = await setup();
      const crowd = await Promise.all(Array.from({ length: 10 }, () => lead(single)));
      const date = day(4);
      await Promise.all(crowd.map((l) => freeTimes(test, l, date)));
      const results = await Promise.all(crowd.map((l) => hold(l, date, "12:00")));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409 && r.json().error === "slot_taken")).toHaveLength(9);

      const pair = await setup({ technicians: 2 });
      const six = await Promise.all(Array.from({ length: 6 }, () => lead(pair)));
      await Promise.all(six.map((l) => freeTimes(test, l, date)));
      const outcomes = await Promise.all(six.map((l) => hold(l, date, "12:00")));
      expect(outcomes.filter((r) => r.statusCode === 200)).toHaveLength(2);
      const technicians = (await owner.query("select technician_id::int as id from core.appointments where status = 'hold' and technician_id = any($1)", [pair.technicianIds])).rows;
      expect(new Set(technicians.map((row) => row.id)).size).toBe(2);
    });

    it("lets one through when the times only touch through the margin", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(5);
      await freeTimes(test, a, date);
      await freeTimes(test, b, date);
      // 10:30 and 12:00 do not overlap with the margin; 10:30 and a direct insert at 11:00 would. The grid keeps them apart.
      const results = await Promise.all([hold(a, date, "10:30"), hold(b, date, "12:00")]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    });
  });

  describe("a hold that ran out does not block the time", () => {
    it("lets somebody else take the time, marks the old hold expired, and offered it again before that", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, a, date);
      await hold(a, date, "10:30");
      const [stale] = await appointmentsOf(owner, a.dealId);
      await expireHold(owner, stale.id);
      expect(stale.status).toBe("hold"); // still marked as a hold: the exclusion would block it

      // The list already shows the time as free, because it does not trust a hold past its time.
      expect(await freeTimes(test, b, date)).toContain("10:30");
      const response = await hold(b, date, "10:30");
      expect(response.statusCode).toBe(200);

      expect((await appointmentsOf(owner, a.dealId))[0].status).toBe("expired");
      expect((await appointmentsOf(owner, b.dealId))[0].status).toBe("hold");
    });

    it("refuses to confirm the hold that ran out, and tells nobody", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);
      await call(l, "guardar_datos", { direccion: "123 Main St", tipo_cliente: "hogar", nombre: "Ana" });
      await call(l, "cotizar", { tipo_cliente: "hogar", dormitorios: 3 });
      await freeTimes(test, l, date);
      await hold(l, date, "10:30");
      await expireHold(owner, (await appointmentsOf(owner, l.dealId))[0].id);

      const response = await call(l, "confirmar", {});
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("hold_expired");
      expect(await scalar("select count(*)::int as n from core.outbox where conversation_id = $1", [l.conversationId])).toBe(0);
      expect((await owner.query("select stage from public.deals where id = $1", [l.dealId])).rows[0].stage).not.toBe("won");
    });

    it("marks the expired holds in the same transaction as the booking: if the booking fails, nothing is marked", async () => {
      const s = await setup();
      const [stale, taker, late] = [await lead(s), await lead(s), await lead(s)];
      const date = day(3);
      for (const l of [stale, taker, late]) await freeTimes(test, l, date);

      // The taker books first, so nothing marks the stale hold before the booking that fails.
      await hold(taker, date, "10:30");
      await hold(stale, date, "09:00");
      await expireHold(owner, (await appointmentsOf(owner, stale.dealId))[0].id);

      expect((await hold(late, date, "10:30")).json().error).toBe("slot_taken");
      // The booking that failed did not leave a half done change behind.
      expect((await appointmentsOf(owner, stale.dealId))[0].status).toBe("hold");

      expect((await hold(late, date, "09:00")).statusCode).toBe(200);
      expect((await appointmentsOf(owner, stale.dealId))[0].status).toBe("expired");
    });

    it("marks every hold that ran out when the sweeper runs, and no other", async () => {
      const s = await setup();
      const [stale, live] = [await lead(s), await lead(s)];
      const date = day(3);
      await freeTimes(test, stale, date);
      await freeTimes(test, live, date);
      await hold(stale, date, "09:00");
      await hold(live, date, "12:00");
      await expireHold(owner, (await appointmentsOf(owner, stale.dealId))[0].id);

      expect(Number((await test.db.query("select api.expire_holds() as n")).rows[0].n)).toBeGreaterThanOrEqual(1);
      expect((await appointmentsOf(owner, stale.dealId))[0].status).toBe("expired");
      expect((await appointmentsOf(owner, live.dealId))[0].status).toBe("hold");
      expect(Number((await test.db.query("select api.expire_holds() as n")).rows[0].n)).toBe(0);
    });
  });

  describe("confirming: the sale closes only from a live hold", () => {
    const ready = async (s: Setup, options: { quote?: boolean; address?: boolean; language?: string } = {}) => {
      const l = await lead(s);
      await call(l, "guardar_datos", { nombre: "Carlos", tipo_cliente: "hogar", ...(options.language ? { idioma: options.language } : {}), ...(options.address === false ? {} : { direccion: "123 Main St, Orlando" }) });
      if (options.quote !== false) await call(l, "cotizar", { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 });
      return l;
    };

    it("answers 409 and changes nothing when there is no reserved time", async () => {
      const l = await ready(await setup());
      const response = await call(l, "confirmar", {});
      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("invalid_state");
      expect(await scalar("select count(*)::int as n from core.outbox where conversation_id = $1", [l.conversationId])).toBe(0);
      expect(await appointmentsOf(owner, l.dealId)).toEqual([]);
      expect((await owner.query("select stage from public.deals where id = $1", [l.dealId])).rows[0].stage).toBe("proposal-sent");
    });

    it("needs the service address and a quote", async () => {
      const s = await setup();
      const date = day(3);
      for (const [options, message] of [[{ address: false }, /address/], [{ quote: false }, /quote/]] as const) {
        const l = await ready(s, options);
        await freeTimes(test, l, date);
        await hold(l, date, options.address === false ? "09:00" : "12:00");
        const response = await call(l, "confirmar", {});
        expect(response.statusCode, JSON.stringify(options) + response.body).toBe(409);
        expect(response.json().message).toMatch(message);
        expect((await appointmentsOf(owner, l.dealId))[0].status).toBe("hold");
      }
    });

    it("sends a message with the date and time of the appointment that was confirmed, composed by core-api", async () => {
      const s = await setup({ timezone: "America/New_York" });
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string; texto: string }[];
      const chosen = slots[1];
      expect((await toolCall(test, l.token, "POST", "reservar", { inicio: chosen.inicio })).statusCode).toBe(200);

      const response = await call(l, "confirmar", {});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ confirmado: true, mensaje_enviado: true });

      const [appointment] = await appointmentsOf(owner, l.dealId);
      expect(appointment).toMatchObject({ status: "confirmed", address: "123 Main St, Orlando" });
      expect(sameInstant(appointment.start_at.toISOString(), chosen.inicio)).toBe(true);

      const outbox = (await owner.query("select body from core.outbox where conversation_id = $1", [l.conversationId])).rows;
      expect(outbox).toHaveLength(1);
      expect(outbox[0].body).toBe(
        `Gracias por elegirnos. Tu servicio ya quedó agendado para el ${chosen.texto}. Es posible que yo o alguno de nuestros colaboradores te contacte para confirmar algún detalle. Que tengas un buen día.`,
      );

      const deal = (await owner.query("select stage from public.deals where id = $1", [l.dealId])).rows[0];
      expect(deal.stage).toBe("won");
      const tasks = (await owner.query("select text, type from public.tasks where contact_id = $1", [l.contactId])).rows;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].type).toBe("follow-up");
    });

    it("writes a message that passes its own review: the text says what the database says", async () => {
      const s = await setup({ timezone: "America/New_York" });
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string; fin: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[2].inicio });
      await call(l, "confirmar", {});

      const body = (await owner.query("select body from core.outbox where conversation_id = $1", [l.conversationId])).rows[0].body as string;
      const facts = (await owner.query("select core.deal_facts($1) as facts", [l.conversationId])).rows[0].facts as ReplyFacts;
      expect(facts.appointment!.status).toBe("confirmed");
      expect(reviewReply(body, facts)).toEqual({ ok: true });
    });

    it("writes the confirmation in English for a customer who speaks English", async () => {
      const s = await setup();
      const l = await ready(s, { language: "en" });
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[0].inicio });
      await call(l, "confirmar", {});
      const body = (await owner.query("select body from core.outbox where conversation_id = $1", [l.conversationId])).rows[0].body as string;
      expect(body).toMatch(/^Thank you for choosing us\. Your service is now scheduled for \p{L}+, \p{L}+ \d+, \d{4}, 9:00 AM\./u);
    });

    it("does not confirm twice, and the second call sends nothing", async () => {
      const s = await setup();
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[0].inicio });
      expect((await call(l, "confirmar", {})).statusCode).toBe(200);
      expect((await call(l, "confirmar", {})).statusCode).toBe(409);
      expect(await scalar("select count(*)::int as n from core.outbox where conversation_id = $1", [l.conversationId])).toBe(1);
      expect(await scalar("select count(*)::int as n from public.tasks where contact_id = $1", [l.contactId])).toBe(1);
    });

    it("refuses to confirm a time that is not the one the message says", async () => {
      const s = await setup();
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[0].inicio });
      await expect(
        test.db.query("select api.confirm_hold($1, $2::timestamptz, 'x')", [l.conversationId, slots[1].inicio]),
      ).rejects.toMatchObject({ code: "CX002" });
      expect((await appointmentsOf(owner, l.dealId))[0].status).toBe("hold");
    });

    it("shows the confirmed appointment on the card, and stops booking for a sale that is closed", async () => {
      const s = await setup();
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[0].inicio });
      await call(l, "confirmar", {});

      const card = (await call(l, "ficha", undefined, "GET")).json();
      expect(card.etapa).toBe("won");
      expect(card.cita).toMatchObject({ status: "confirmed", address: "123 Main St, Orlando" });
      expect((await toolCall(test, l.token, "POST", "reservar", { inicio: slots[1].inicio })).json().error).toBe("invalid_state");
    });

    it("does not book a second time while an appointment is confirmed, even if the opportunity was reopened", async () => {
      const s = await setup();
      const l = await ready(s);
      const slots = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: slots[0].inicio });
      await call(l, "confirmar", {});
      await owner.query("update public.deals set stage = 'in-negociation' where id = $1", [l.dealId]);

      const response = await toolCall(test, l.token, "POST", "reservar", { inicio: slots[1].inicio });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/already scheduled/);
      expect((await appointmentsOf(owner, l.dealId)).map((row) => row.status)).toEqual(["confirmed"]);
    });

    it("rejects any field in confirmar", async () => {
      const l = await ready(await setup());
      expect((await call(l, "confirmar", { contact_id: 1 })).statusCode).toBe(400);
      expect((await call(l, "confirmar", { inicio: "2030-01-01T10:00:00Z" })).statusCode).toBe(400);
    });
  });

  describe("responder only repeats times that horarios_libres gave", () => {
    it("stops a time before horarios_libres was called, and lets the offered ones through", async () => {
      const s = await setup();
      const l = await lead(s);
      const date = day(3);

      const early = await call(l, "responder", { texto: "Tengo libre a las 10:30. ¿Te sirve?" });
      expect(early.statusCode).toBe(422);
      expect(early.json()).toMatchObject({ reason: "schedule_not_offered" });
      expect(early.json().message).toContain("horarios_libres");

      const offered = (await call(l, "horarios_libres", { desde: date, dias: 1 })).json().horarios as { texto: string }[];
      const ok = await call(l, "responder", { texto: `Tengo estos horarios: ${offered.slice(0, 2).map((slot) => slot.texto).join(" o ")}. ¿Cuál te sirve?` });
      expect(ok.statusCode).toBe(200);

      const invented = await call(l, "responder", { texto: `Tengo libre el ${offered[0].texto.split(",")[0]} a las 5:30 PM` });
      expect(invented.json().reason).toBe("schedule_not_offered");
    });

    it("does not accept a time the customer proposed", async () => {
      const l = await lead(await setup());
      await freeTimes(test, l, day(3));
      expect((await call(l, "responder", { texto: "Perfecto, te agendo a las 6:00 PM" })).json().reason).toBe("schedule_not_offered");
    });

    it("does not count the times offered to another conversation", async () => {
      const s = await setup();
      const [a, b] = [await lead(s), await lead(s)];
      const offered = (await call(a, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { texto: string }[];
      expect((await call(b, "responder", { texto: `Tengo ${offered[0].texto}` })).statusCode).toBe(422);
      expect((await call(a, "responder", { texto: `Tengo ${offered[0].texto}` })).statusCode).toBe(200);
    });

    it("forgets what was offered a day ago", async () => {
      const l = await lead(await setup());
      const offered = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { texto: string }[];
      await owner.query("update core.offered_slots set offered_at = now() - interval '2 days' where conversation_id = $1", [l.conversationId]);
      expect((await call(l, "responder", { texto: `Tengo ${offered[0].texto}` })).statusCode).toBe(422);
    });

    it("lets the bot talk about its own hold", async () => {
      const l = await lead(await setup());
      const offered = (await call(l, "horarios_libres", { desde: day(3), dias: 1 })).json().horarios as { inicio: string; texto: string }[];
      await toolCall(test, l.token, "POST", "reservar", { inicio: offered[0].inicio });
      expect((await call(l, "responder", { texto: `Te reservo ${offered[0].texto} por 15 minutos` })).statusCode).toBe(200);
    });
  });
});
