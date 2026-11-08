import { readFileSync } from "node:fs";
import type pg from "pg";
import { z } from "zod";
import { owner } from "./db-lib.ts";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timezone = z.string().regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

const availabilitySchema = z.strictObject({
  slot_minutes: z.literal(60),
  buffer_minutes: z.literal(30),
  technicians: z.array(z.strictObject({
    name: z.string().trim().min(1),
    timezone,
    zip_prefixes: z.array(z.string().regex(/^\d{1,5}$/)).min(1),
    windows: z.array(z.strictObject({
      date: z.iso.date(),
      start: time,
      end: time,
    })).min(1),
  })).min(1),
});

type Availability = z.infer<typeof availabilitySchema>;

export const parseAvailability = (source: string): Availability => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Availability must be valid JSON");
  }

  const result = availabilitySchema.safeParse(parsed);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "file").join(", ");
    throw new Error(`Invalid availability: ${fields}`);
  }

  const names = new Set<string>();
  for (const [index, technician] of result.data.technicians.entries()) {
    if (names.has(technician.name)) throw new Error(`Duplicate name at technicians.${index}`);
    names.add(technician.name);
    if (new Set(technician.zip_prefixes).size !== technician.zip_prefixes.length) {
      throw new Error(`Duplicate ZIP prefix at technicians.${index}`);
    }
    const windows = [...technician.windows].sort((a, b) => (
      a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
    ));
    for (const [position, window] of windows.entries()) {
      const previous = windows[position - 1];
      if (window.end <= window.start) throw new Error(`Invalid window order at technicians.${index}`);
      if (previous?.date === window.date && previous.end > window.start) {
        throw new Error(`Overlapping windows at technicians.${index}`);
      }
    }
  }
  return result.data;
};

export const importAvailability = async (
  db: pg.Client,
  brandSlug: string,
  availability: Availability,
): Promise<number> => {
  await db.query("begin");
  try {
    const { rows: [brand] } = await db.query<{ id: string }>("select id from core.brands where slug = $1", [brandSlug]);
    if (!brand) throw new Error("The availability brand does not exist");
    await db.query("select pg_advisory_xact_lock(hashtext('book:' || $1::bigint))", [brand.id]);

    const { slot_minutes, buffer_minutes, technicians } = availability;
    const importedIds: string[] = [];
    let windowCount = 0;

    for (const [index, technician] of technicians.entries()) {
      const { timezone, zip_prefixes, name, windows } = technician;
      const dates = windows.map(({ date }) => date);
      const starts = windows.map(({ start }) => start);
      const ends = windows.map(({ end }) => end);
      const { rowCount: timezoneExists } = await db.query("select 1 from pg_catalog.pg_timezone_names where name = $1", [timezone]);
      if (!timezoneExists) throw new Error(`Invalid timezone at technicians.${index}`);

      // Use PostgreSQL's clock and time zone rules, as the scheduler does.
      const { rows: [invalid] } = await db.query(
        `select 1
         from unnest($1::date[], $2::time[], $3::time[]) as w(service_date, start_time, end_time)
         cross join lateral (
           select (w.service_date + w.start_time) at time zone $4 as starts_at,
                  (w.service_date + w.end_time) at time zone $4 as ends_at
         ) as actual
         where actual.starts_at <= clock_timestamp()
            or (actual.starts_at at time zone $4) <> w.service_date + w.start_time
            or (actual.ends_at at time zone $4) <> w.service_date + w.end_time
            or actual.ends_at - actual.starts_at < make_interval(mins => $5)
         limit 1`,
        [dates, starts, ends, timezone, slot_minutes + buffer_minutes],
      );
      if (invalid) {
        throw new Error(`Use future windows of at least ${slot_minutes + buffer_minutes} minutes at valid local times in technicians.${index}`);
      }

      const { rows: matches } = await db.query<{ id: string }>(
        "select id from core.technicians where brand_id = $1 and name = $2",
        [brand.id, name],
      );
      if (matches.length > 1) throw new Error(`Ambiguous existing technician at technicians.${index}`);
      let id = matches[0]?.id;
      if (id) {
        await db.query(
          "update core.technicians set timezone = $2, zip_prefixes = $3, active = true where id = $1",
          [id, timezone, zip_prefixes],
        );
      } else {
        const { rows: [inserted] } = await db.query<{ id: string }>(
          "insert into core.technicians (brand_id, name, timezone, zip_prefixes) values ($1, $2, $3, $4) returning id",
          [brand.id, name, timezone, zip_prefixes],
        );
        id = inserted.id;
      }
      importedIds.push(id);

      await db.query("delete from core.technician_dated_availability where technician_id = $1", [id]);
      await db.query(
        `insert into core.technician_dated_availability (technician_id, service_date, start_time, end_time)
         select $1, * from unnest($2::date[], $3::time[], $4::time[])`,
        [id, dates, starts, ends],
      );
      windowCount += windows.length;
    }

    // Keep technician IDs and appointments for history, and leave legacy weekly schedules alone.
    await db.query(
      `delete from core.technician_dated_availability a using core.technicians t
       where a.technician_id = t.id and t.brand_id = $1 and t.zip_prefixes is not null and t.id <> all($2::bigint[])`,
      [brand.id, importedIds],
    );
    await db.query(
      "update core.technicians set active = false where brand_id = $1 and zip_prefixes is not null and id <> all($2::bigint[])",
      [brand.id, importedIds],
    );
    await db.query(
      `insert into core.scheduling_settings
         (brand_id, slot_minutes, buffer_minutes, hold_minutes, min_notice_minutes, horizon_days, reverify_after_days, is_confirmed)
       values ($1, $2, $3, 15, 120, 14, 90, true)
       on conflict (brand_id) do update set slot_minutes = excluded.slot_minutes, buffer_minutes = excluded.buffer_minutes,
         hold_minutes = excluded.hold_minutes, is_confirmed = true, updated_at = now()`,
      [brand.id, slot_minutes, buffer_minutes],
    );

    await db.query("commit");
    return windowCount;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
};

if (import.meta.main) {
  try {
    const [path, extra] = process.argv.slice(2);
    if (!path || extra !== undefined) {
      throw new Error("Usage: node scripts/db-import-availability.ts <approved-availability.json | ->");
    }
    const availability = parseAvailability(readFileSync(path === "-" ? 0 : path, "utf8"));
    const db = await owner(process.env.PGDATABASE ?? "salvionix");
    try {
      const count = await importAvailability(db, "salvionix", availability);
      console.log(`Imported ${count} availability windows for ${availability.technicians.length} technicians`);
    } finally {
      await db.end();
    }
  } catch (error) {
    // Keep private input rows out of PostgreSQL error output.
    console.error(error instanceof Error && "code" in error
      ? `Availability import failed (${error.code})`
      : error instanceof Error ? error.message : "Availability import failed");
    process.exitCode = 1;
  }
}
