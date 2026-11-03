import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSetup, type Setup } from "./agenda-helpers.ts";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import { ownerClient, waitForPostgrest } from "./helpers.ts";

const ORIGIN = "http://127.0.0.1:5173";

/** A day in the near future, at the given UTC hour. */
const at = (hour: number, daysAhead = 3): string => {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

describe("calendar routes of the panel", () => {
  let test: TestApp;
  let owner: pg.Client;

  beforeAll(async () => {
    await waitForPostgrest();
    owner = await ownerClient();
    test = createTestApp();
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const brand = (options: Parameters<typeof createSetup>[1] = {}) => createSetup(owner, { technicians: 2, minNoticeMinutes: 0, ...options });

  const lead = async (setup: Setup, options: { address?: string; quote?: boolean } = {}) => {
    const contact = await owner.query<{ id: number }>("insert into public.contacts (first_name, last_name, brand_id) values ('Cliente', 'Real', $1) returning id::int", [setup.brandId]);
    const deal = await owner.query<{ id: number }>(
      `insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, service_address)
       values ('Servicio', 'opportunity', array[$1::bigint], $1, $2, $3) returning id::int`,
      [contact.rows[0].id, setup.brandId, options.address ?? null],
    );
    if (options.quote) await owner.query("insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs) values ($1, 1860, 0, '{}')", [deal.rows[0].id]);
    return deal.rows[0].id;
  };

  const call = (method: "POST" | "DELETE", path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    test.app.inject({
      method,
      url: `/admin/agenda/${path}`,
      headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });

  const book = (dealId: number, technicianId: number, start: string, extra: object = {}) =>
    call("POST", "appointments", { deal_id: dealId, technician_id: technicianId, start_at: start, ...extra });

  describe("booking, confirming, cancelling and moving", () => {
    it("books a hold and answers with the appointment", async () => {
      const setup = await brand();
      const response = await book(await lead(setup), setup.technicianIds[0], at(10), { address: "1 Main St" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ estado: "hold", tecnico_id: setup.technicianIds[0] });
      expect(new Date(response.json().inicio).toISOString()).toBe(at(10));
    });

    it("refuses a clash with 409 slot_taken and tells nothing else", async () => {
      const setup = await brand({ technicians: 1 });
      await book(await lead(setup), setup.technicianIds[0], at(10));

      const response = await book(await lead(setup), setup.technicianIds[0], at(10));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "slot_taken" });
    });

    it("says why a confirmation is refused, without any SQL in the answer", async () => {
      const setup = await brand();
      const response = await book(await lead(setup, { quote: true }), setup.technicianIds[0], at(10), { confirm: true });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "invalid_state", reason: "address_required" });
    });

    it("books and confirms in one step, then moves and cancels", async () => {
      const setup = await brand();
      const dealId = await lead(setup, { quote: true, address: "1 Main St" });

      const confirmed = (await book(dealId, setup.technicianIds[0], at(10), { confirm: true })).json();
      expect(confirmed.estado).toBe("confirmed");

      const moved = await call("POST", `appointments/${confirmed.id}/reschedule`, { technician_id: setup.technicianIds[1], start_at: at(14) });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ estado: "confirmed", reemplaza: confirmed.id });

      const cancelled = await call("POST", `appointments/${moved.json().id}/cancel`, {});
      expect(cancelled.json().estado).toBe("cancelled");
      expect((await call("POST", `appointments/${moved.json().id}/cancel`, {})).json()).toEqual({ error: "invalid_state", reason: "not_cancellable" });
    });

    it("confirms a hold once it has an address and a quote", async () => {
      const setup = await brand();
      const dealId = await lead(setup, { quote: true });
      const held = (await book(dealId, setup.technicianIds[0], at(10))).json();
      expect((await call("POST", `appointments/${held.id}/confirm`, {})).json()).toEqual({ error: "invalid_state", reason: "address_required" });

      await owner.query("update public.deals set service_address = '2 Oak St' where id = $1", [dealId]);

      expect((await call("POST", `appointments/${held.id}/confirm`, {})).json()).toMatchObject({ estado: "confirmed" });
    });

    it("leaves the appointment where it was when the new time is taken", async () => {
      const setup = await brand({ technicians: 1 });
      const mine = (await book(await lead(setup), setup.technicianIds[0], at(10))).json();
      await book(await lead(setup), setup.technicianIds[0], at(14));

      const response = await call("POST", `appointments/${mine.id}/reschedule`, { technician_id: setup.technicianIds[0], start_at: at(14) });

      expect(response.statusCode).toBe(409);
      expect((await owner.query("select status from core.appointments where id = $1", [mine.id])).rows[0].status).toBe("hold");
    });
  });

  describe("availability and time off", () => {
    it("replaces the windows and says how many booked appointments fall outside", async () => {
      const setup = await brand({ technicians: 1 });
      await book(await lead(setup), setup.technicianIds[0], at(10));

      const response = await call("POST", `technicians/${setup.technicianIds[0]}/availability`, { windows: [{ weekday: 1, start: "09:00", end: "12:00" }] });

      expect(response.statusCode).toBe(200);
      expect(response.json().ventanas).toBe(1);
      expect(response.json()).toHaveProperty("citas_fuera");
    });

    it("refuses windows that make no sense", async () => {
      const setup = await brand({ technicians: 1 });
      const response = await call("POST", `technicians/${setup.technicianIds[0]}/availability`, { windows: [{ weekday: 1, start: "12:00", end: "09:00" }] });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_input", reason: "bad_windows" });
    });

    it("adds time off, which blocks the time, and removes it", async () => {
      const setup = await brand({ technicians: 1 });
      const added = await call("POST", `technicians/${setup.technicianIds[0]}/time-off`, { from: at(9), to: at(13), reason: "médico" });
      expect(added.statusCode).toBe(200);

      expect((await book(await lead(setup), setup.technicianIds[0], at(10))).json()).toEqual({ error: "invalid_input", reason: "outside_availability" });

      expect((await call("DELETE", `time-off/${added.json().id}`)).statusCode).toBe(200);
      expect((await book(await lead(setup), setup.technicianIds[0], at(10))).statusCode).toBe(200);
      expect((await call("DELETE", `time-off/${added.json().id}`)).json()).toEqual({ error: "invalid_input", reason: "unknown_time_off" });
    });
  });

  describe("what it does not accept", () => {
    it.each([
      ["a field it does not know", { deal_id: 1, technician_id: 1, start_at: at(10), is_test: true }],
      ["a time without a zone", { deal_id: 1, technician_id: 1, start_at: "2030-01-01T10:00:00" }],
      ["an id that is not a number", { deal_id: "uno", technician_id: 1, start_at: at(10) }],
      ["a negative id", { deal_id: -1, technician_id: 1, start_at: at(10) }],
      ["no opportunity", { technician_id: 1, start_at: at(10) }],
    ])("answers 400 to %s", async (_label, payload) => {
      const response = await call("POST", "appointments", payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_input");
    });

    it("answers 400 to a body that is not JSON, and to an id in the path that is not a number", async () => {
      const raw = await test.app.inject({ method: "POST", url: "/admin/agenda/appointments", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: "{no" });
      expect(raw.statusCode).toBe(400);
      expect((await call("POST", "appointments/abc/cancel", {})).statusCode).toBe(400);
    });

    it("answers a CORS preflight only to the origin of the panel, with credentials", async () => {
      const own = await test.app.inject({ method: "OPTIONS", url: "/admin/agenda/appointments", headers: { origin: ORIGIN } });
      expect(own.statusCode).toBe(204);
      expect(own.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(own.headers["access-control-allow-credentials"]).toBe("true");
      expect(own.headers["access-control-allow-methods"]).toContain("POST");

      const foreign = await test.app.inject({ method: "OPTIONS", url: "/admin/agenda/appointments", headers: { origin: "https://evil.example" } });
      expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("does not exist without a development identity or in production", async () => {
      for (const overrides of [{ ADMIN_DEV_SUB: undefined }, { NODE_ENV: "production" }]) {
        const bare = createTestApp(overrides);
        try {
          const response = await bare.app.inject({ method: "POST", url: "/admin/agenda/appointments", headers: { "content-type": "application/json" }, payload: "{}" });
          expect(response.statusCode).toBe(404);
        } finally {
          await bare.close();
        }
      }
    });
  });
});
