import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importAvailability, parseAvailability } from "../../scripts/db-import-availability.ts";
import { ownerClient } from "../helpers.ts";

const orlando = {
  name: "Aplicador Orlando",
  timezone: "America/New_York",
  zip_prefixes: ["327", "328", "347"],
};
const parse = (technicians: object[], settings = {}) =>
  parseAvailability(JSON.stringify({ slot_minutes: 60, buffer_minutes: 30, technicians, ...settings }));

describe("production availability import", () => {
  let db: pg.Client;
  const brand = "availability-import-test";
  let brandId: string;
  let dates: { first: string; second: string; past: string };

  beforeAll(async () => {
    db = await ownerClient();
    const { rows: [created] } = await db.query<{ id: string }>(
      "insert into core.brands (slug, name, timezone, bot_agenda_enabled) values ($1, 'Availability Import Test', 'UTC', false) returning id",
      [brand],
    );
    brandId = created.id;
    const { rows: [days] } = await db.query<typeof dates>(
      "select (current_date + 7)::text as first, (current_date + 8)::text as second, (current_date - 1)::text as past",
    );
    dates = days;
  });
  afterAll(() => db.end());

  it("requires valid technician coverage, IANA zones, local dates and nonoverlapping windows", () => {
    const window = { date: dates.first, start: "09:00", end: "12:00" };
    const entry = { ...orlando, windows: [window] };
    expect(() => parse([{ ...entry, timezone: "+01:00" }])).toThrow(/timezone/);
    expect(() => parse([{ ...entry, timezone: "Mars/Orlando" }])).toThrow(/timezone/);
    expect(() => parse([{ ...entry, zip_prefixes: ["32A"] }])).toThrow(/zip_prefixes/);
    expect(() => parse([{ ...entry, zip_prefixes: ["327", "327"] }])).toThrow(/Duplicate ZIP prefix/);
    expect(() => parse([{ ...entry, windows: [] }])).toThrow(/windows/);
    expect(() => parse([{ ...entry, windows: [{ ...window, date: "2027-02-29" }] }])).toThrow(/date/);
    expect(() => parse([{ ...entry, windows: [{ ...window, end: "24:00" }] }])).toThrow(/end/);
    expect(() => parse([{ ...entry, windows: [{ ...window, end: "08:00" }] }])).toThrow(/window order/);
    expect(() => parse([{ ...entry, windows: [{ ...window, start: "10:00" }, window] }])).toThrow(/Overlapping windows/);
    expect(() => parse([entry, { ...entry, name: ` ${entry.name} ` }])).toThrow(/Duplicate name/);
    expect(() => parse([entry], { buffer_minutes: 0 })).toThrow(/buffer_minutes/);
    expect(() => parse([{ ...entry, windows: [window, { ...window, start: "12:00", end: "14:00" }] }])).not.toThrow();
  });

  it("replaces windows in one transaction, preserves IDs, and does not enable agenda", async () => {
    const firstWindow = { date: dates.first, start: "09:00", end: "12:00" };
    const replacement = { date: dates.second, start: "10:00", end: "15:00" };
    const second = { ...orlando, name: "Second Technician", windows: [firstWindow] };
    const first = { ...orlando, windows: [firstWindow] };
    await db.query("insert into core.technicians (brand_id, name) values ($1, 'Legacy Technician')", [brandId]);
    await expect(importAvailability(db, brand, parse([first, second]))).resolves.toBe(2);

    const technicianRows = async () => (await db.query(
      `select t.id, t.name, t.active, t.timezone, t.zip_prefixes,
              a.service_date::text, a.start_time::text, a.end_time::text
       from core.technicians t left join core.technician_dated_availability a on a.technician_id = t.id
       where t.brand_id = $1 order by t.name, a.service_date, a.start_time`,
      [brandId],
    )).rows;
    const original = await technicianRows();
    const updated = { ...first, windows: [replacement] };
    const invalid = { ...second, windows: [{ ...replacement, date: dates.past }] };
    await expect(importAvailability(db, brand, parse([updated, invalid]))).rejects.toThrow(/future windows/);
    expect(await technicianRows()).toEqual(original);
    await expect(importAvailability(db, brand, parse([{ ...first, windows: [{ ...firstWindow, end: "10:00" }] }])))
      .rejects.toThrow(/90 minutes/);

    await db.query(
      "update core.scheduling_settings set min_notice_minutes = 30, horizon_days = 7, reverify_after_days = 45 where brand_id = $1",
      [brandId],
    );
    await expect(importAvailability(db, brand, parse([updated]))).resolves.toBe(1);
    const rows = await technicianRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: original[0].id,
      name: orlando.name,
      active: true,
      timezone: orlando.timezone,
      zip_prefixes: orlando.zip_prefixes,
      service_date: replacement.date,
      start_time: "10:00:00",
      end_time: "15:00:00",
    });
    expect(rows[1]).toMatchObject({ id: original[1].id, name: "Legacy Technician", active: true, service_date: null });
    expect(rows[2]).toMatchObject({ id: original[2].id, name: second.name, active: false, service_date: null });
    await expect(importAvailability(db, brand, parse([updated]))).resolves.toBe(1);
    expect(await technicianRows()).toEqual(rows);

    const { rows: [settings] } = await db.query(
      `select s.slot_minutes, s.buffer_minutes, s.hold_minutes, s.min_notice_minutes, s.horizon_days,
              s.reverify_after_days, s.is_confirmed, b.bot_agenda_enabled
       from core.scheduling_settings s join core.brands b on b.id = s.brand_id where s.brand_id = $1`,
      [brandId],
    );
    expect(settings).toEqual({
      slot_minutes: 60,
      buffer_minutes: 30,
      hold_minutes: 15,
      min_notice_minutes: 30,
      horizon_days: 7,
      reverify_after_days: 45,
      is_confirmed: true,
      bot_agenda_enabled: false,
    });
  });
});
