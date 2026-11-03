import { CoreAdminContext, type DataProvider } from "ra-core";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AppointmentCalendar } from "./AppointmentCalendar";
import type { Appointment } from "./AppointmentList";
import type { Technician } from "./useTechnicians";

// Wednesday 4 November 2026, 10:00 in New York: the week is 2 to 8 November.
const NOW = new Date("2026-11-04T15:00:00Z");

const technician: Technician = {
  id: 7,
  brand_id: 1,
  name: "Marcos",
  active: true,
  timezone: "America/New_York",
  availability: [1, 2, 3, 4, 5].map((weekday) => ({ id: weekday, weekday, start: "09:00", end: "17:00" })),
  // Wednesday 12:00 to 14:00 on the wall of New York.
  time_off: [{ id: 3, from: "2026-11-04T17:00:00Z", to: "2026-11-04T19:00:00Z", reason: "Médico" }],
};

const appointment = (overrides: Partial<Appointment>): Appointment => ({
  id: 1,
  deal_id: 11,
  deal_name: "Nueva consulta",
  contact_id: 21,
  first_name: "Rosa",
  last_name: "Salazar",
  technician_id: 7,
  technician_name: "Marcos",
  start_at: "2026-11-05T15:00:00Z", // Thursday 10:00 in New York
  end_at: "2026-11-05T16:00:00Z",
  status: "hold",
  hold_expires_at: "2026-11-05T14:15:00Z",
  address: "123 Main St",
  is_test: false,
  ...overrides,
});

const i18n = {
  translate: (key: string) => key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

type Written = { path: string; method: string; body: unknown };

const setup = async (rows: Appointment[], answer: (path: string) => Response = () => json({ id: 99, estado: "hold" })) => {
  const asked: { resource: string; filter: Record<string, unknown> }[] = [];
  const written: Written[] = [];
  const dataProvider = {
    getList: async (resource: string, params: { filter: Record<string, unknown> }) => {
      asked.push({ resource, filter: params.filter });
      if (resource === "technicians_summary") return { data: [technician], total: 1 };
      if (resource === "appointments") return { data: rows, total: rows.length };
      if (resource === "deals") {
        return { data: [{ id: 11, name: "Nueva consulta", stage: "opportunity", contact_ids: [21], service_address: "9 Pine Ave" }], total: 1 };
      }
      return { data: [], total: 0 };
    },
    getMany: async () => ({ data: [{ id: 21, first_name: "Rosa", last_name: "Salazar" }] }),
  } as unknown as DataProvider;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input).replace(/^.*\/admin\/agenda\//, "");
      written.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return answer(path);
    }),
  );

  const screen = await render(
    <MemoryRouter>
      <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18n}>
        <AppointmentCalendar />
      </CoreAdminContext>
    </MemoryRouter>,
  );
  return { screen, asked, written };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("AppointmentCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("the week", () => {
    it("draws each appointment on its day at the time of the brand's clock", async () => {
      const { screen } = await setup([appointment({})]);

      // 15:00 UTC is 10:00 in New York, on Thursday.
      const thursday = screen.getByRole("gridcell", { name: "2026-11-05" });
      await expect.element(thursday.getByRole("button", { name: /10:00 Rosa Salazar/ })).toBeVisible();
      await expect.element(screen.getByRole("gridcell", { name: "2026-11-04" }).getByRole("button")).not.toBeInTheDocument();
    });

    it("asks the server for this technician and this week, from Monday to Monday on the brand's clock", async () => {
      const { screen, asked } = await setup([]);
      await expect.element(screen.getByRole("grid")).toBeVisible();

      await expect.poll(() => asked.find((call) => call.resource === "appointments")).toBeDefined();
      const call = asked.find((entry) => entry.resource === "appointments")!;
      expect(call.filter).toEqual({
        technician_id: 7,
        "start_at@gte": "2026-11-02T05:00:00.000Z", // Monday 00:00 in New York (UTC-5)
        "start_at@lt": "2026-11-09T05:00:00.000Z",
      });
    });

    it("moves to the next week and back", async () => {
      const { screen, asked } = await setup([]);
      await screen.getByRole("button", { name: "resources.appointments.calendar.next_week" }).click();

      await expect.element(screen.getByRole("gridcell", { name: "2026-11-09" })).toBeVisible();
      await expect.poll(() => asked.some((call) => call.filter["start_at@gte"] === "2026-11-09T05:00:00.000Z")).toBe(true);

      await screen.getByRole("button", { name: "resources.appointments.calendar.today" }).click();
      await expect.element(screen.getByRole("gridcell", { name: "2026-11-04" })).toBeVisible();
    });

    it("does not draw appointments that were cancelled or expired", async () => {
      const { screen } = await setup([
        appointment({ id: 1, status: "cancelled" }),
        appointment({ id: 2, status: "expired", start_at: "2026-11-06T15:00:00Z", end_at: "2026-11-06T16:00:00Z" }),
        appointment({ id: 3, status: "confirmed", first_name: "Ana", start_at: "2026-11-03T15:00:00Z", end_at: "2026-11-03T16:00:00Z" }),
      ]);

      await expect.element(screen.getByRole("button", { name: /Ana/ })).toBeVisible();
      await expect.element(screen.getByRole("button", { name: /Rosa/ })).not.toBeInTheDocument();
    });

    it("shades the hours the technician works and marks the time off", async () => {
      const { screen } = await setup([]);

      await expect.element(screen.getByRole("gridcell", { name: "2026-11-04" }).getByTestId("availability")).toBeVisible();
      await expect.element(screen.getByRole("gridcell", { name: "2026-11-04" }).getByTestId("time-off")).toHaveTextContent("Médico");
      // Saturday has no hours and no time off.
      await expect.element(screen.getByRole("gridcell", { name: "2026-11-07" }).getByTestId("availability")).not.toBeInTheDocument();
    });

    it("tells the status of each appointment apart, a test one included", async () => {
      const { screen } = await setup([
        appointment({ id: 1, status: "hold" }),
        appointment({ id: 2, status: "confirmed", first_name: "Ana", start_at: "2026-11-03T15:00:00Z", end_at: "2026-11-03T16:00:00Z" }),
      ]);
      await expect.element(screen.getByRole("button", { name: /Rosa/ })).toHaveAttribute("data-status", "hold");
      await expect.element(screen.getByRole("button", { name: /Ana/ })).toHaveAttribute("data-status", "confirmed");
    });
  });

  describe("booking from an empty cell", () => {
    it("opens the form on the day and the half hour that was clicked", async () => {
      const { screen } = await setup([]);
      // The grid starts at 09:00 and an hour is 48 pixels: 98 pixels down is 11:00.
      await screen.getByRole("gridcell", { name: "2026-11-06" }).click({ position: { x: 20, y: 98 } });

      await expect.element(screen.getByLabelText("resources.appointments.calendar.day")).toHaveValue("2026-11-06");
      await expect.element(screen.getByLabelText("resources.appointments.calendar.time")).toHaveValue("11:00");
    });

    it("books for the opportunity that was picked, sending the instant of the brand's clock", async () => {
      const { screen, written } = await setup([]);
      await screen.getByRole("gridcell", { name: "2026-11-06" }).click({ position: { x: 20, y: 98 } });

      await screen.getByPlaceholder("resources.appointments.calendar.search_deal").fill("Nueva");
      await screen.getByRole("button", { name: /Nueva consulta · Rosa Salazar/ }).click();
      await screen.getByLabelText("resources.appointments.fields.address").fill("9 Pine Ave");
      await screen.getByRole("button", { name: "resources.appointments.calendar.book" }).click();

      await expect.poll(() => written.length).toBe(1);
      expect(written[0]).toEqual({
        path: "appointments",
        method: "POST",
        body: { deal_id: 11, technician_id: 7, start_at: "2026-11-06T16:00:00.000Z", address: "9 Pine Ave", confirm: false },
      });
    });

    it("says why the database refused, and keeps the form open", async () => {
      const { screen } = await setup([], () => json({ error: "slot_taken" }, 409));
      await screen.getByRole("gridcell", { name: "2026-11-06" }).click({ position: { x: 20, y: 98 } });
      await screen.getByPlaceholder("resources.appointments.calendar.search_deal").fill("Nueva");
      await screen.getByRole("button", { name: /Nueva consulta · Rosa Salazar/ }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.book" }).click();

      await expect.element(screen.getByRole("alert")).toHaveTextContent("resources.appointments.calendar.errors.slot_taken");
      await expect.element(screen.getByRole("button", { name: "resources.appointments.calendar.book" })).toBeVisible();
    });

    it("does not book without an opportunity", async () => {
      const { screen, written } = await setup([]);
      await screen.getByRole("gridcell", { name: "2026-11-06" }).click({ position: { x: 20, y: 98 } });

      await expect.element(screen.getByRole("button", { name: "resources.appointments.calendar.book" })).toBeDisabled();
      expect(written).toEqual([]);
    });
  });

  describe("an appointment", () => {
    it("confirms a reserved time", async () => {
      const { screen, written } = await setup([appointment({})]);
      await screen.getByRole("button", { name: /Rosa/ }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.confirm" }).click();

      await expect.poll(() => written.length).toBe(1);
      expect(written[0]).toMatchObject({ path: "appointments/1/confirm", method: "POST" });
    });

    it("offers no confirmation for what is already confirmed", async () => {
      const { screen } = await setup([appointment({ status: "confirmed" })]);
      await screen.getByRole("button", { name: /Rosa/ }).click();

      await expect.element(screen.getByRole("button", { name: "resources.appointments.calendar.reschedule" })).toBeVisible();
      await expect.element(screen.getByRole("button", { name: "resources.appointments.calendar.confirm", exact: true })).not.toBeInTheDocument();
    });

    it("asks before cancelling, and only then cancels", async () => {
      const { screen, written } = await setup([appointment({})]);
      await screen.getByRole("button", { name: /Rosa/ }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.cancel", exact: true }).click();

      await expect.element(screen.getByText("resources.appointments.calendar.cancel_question")).toBeVisible();
      expect(written).toEqual([]);

      await screen.getByRole("button", { name: "resources.appointments.calendar.cancel_confirm" }).click();
      await expect.poll(() => written.length).toBe(1);
      expect(written[0]).toMatchObject({ path: "appointments/1/cancel", method: "POST" });
    });

    it("reschedules to the day and time chosen, on the brand's clock", async () => {
      const { screen, written } = await setup([appointment({})]);
      await screen.getByRole("button", { name: /Rosa/ }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.reschedule" }).click();

      await expect.element(screen.getByLabelText("resources.appointments.calendar.day")).toHaveValue("2026-11-05");
      await expect.element(screen.getByLabelText("resources.appointments.calendar.time")).toHaveValue("10:00");
      await screen.getByLabelText("resources.appointments.calendar.day").fill("2026-11-06");
      await screen.getByLabelText("resources.appointments.calendar.time").fill("14:30");
      await screen.getByRole("button", { name: "resources.appointments.calendar.move" }).click();

      await expect.poll(() => written.length).toBe(1);
      expect(written[0]).toEqual({
        path: "appointments/1/reschedule",
        method: "POST",
        body: { technician_id: 7, start_at: "2026-11-06T19:30:00.000Z" },
      });
    });

    it("explains a refused move with the reason the database gave", async () => {
      const { screen } = await setup([appointment({})], () => json({ error: "invalid_input", reason: "outside_availability" }, 400));
      await screen.getByRole("button", { name: /Rosa/ }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.reschedule" }).click();
      await screen.getByRole("button", { name: "resources.appointments.calendar.move" }).click();

      await expect.element(screen.getByRole("alert")).toHaveTextContent("resources.appointments.calendar.errors.outside_availability");
    });
  });

  describe("availability", () => {
    it("saves the weekly windows that were edited", async () => {
      const { screen, written } = await setup([]);
      await screen.getByRole("button", { name: "resources.appointments.calendar.availability" }).click();

      // Remove Friday and give Saturday morning hours.
      const dialog = screen.getByRole("dialog");
      await dialog.getByRole("group").nth(4).getByRole("button", { name: "ra.action.delete" }).click();
      await dialog.getByRole("group").nth(5).getByRole("button").click();
      await dialog.getByRole("button", { name: "resources.appointments.calendar.save_availability" }).click();

      await expect.poll(() => written.length).toBe(1);
      const body = written[0].body as { windows: { weekday: number; start: string; end: string }[] };
      expect(written[0].path).toBe("technicians/7/availability");
      expect(body.windows.map((window) => window.weekday).sort()).toEqual([1, 2, 3, 4, 6]);
    });

    it("adds time off on the brand's clock and removes one", async () => {
      const { screen, written } = await setup([]);
      await screen.getByRole("button", { name: "resources.appointments.calendar.availability" }).click();
      const dialog = screen.getByRole("dialog");

      await dialog.getByRole("button", { name: "ra.action.delete" }).last().click();
      await expect.poll(() => written.length).toBe(1);
      expect(written[0]).toMatchObject({ path: "time-off/3", method: "DELETE" });
    });
  });
});
