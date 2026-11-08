import { readFileSync } from "node:fs";
import type pg from "pg";
import { z } from "zod";
import { owner } from "./db-lib.ts";

const decimal = (scale: number, max: number) =>
  z.number().min(0).max(max).refine((value) => value === Number(value.toFixed(scale)), {
    message: `Use at most ${scale} decimal places`,
  });

const amount = decimal(2, 99_999_999.99);
const rate = decimal(4, 999_999.9999);
const controlResult = {
  subtotal: amount,
  discount: amount,
  total: amount,
  min_applied: z.boolean(),
};
const quoteControl = z.union([
  z.strictObject({ covered_sqft: amount, uncovered_sqft: amount, ...controlResult }),
  z.strictObject({
    inputs: z.strictObject({
      client_type: z.literal("home"),
      bedrooms: z.int().min(0).max(30),
      covered_parking_cars: z.int().min(0).max(20).optional(),
      uncovered_parking_cars: z.int().min(0).max(20).optional(),
      extra_areas: z.array(z.strictObject({ covered: z.boolean(), sqft: amount })).max(20).optional(),
    }),
    ...controlResult,
  }),
]);
const rulesSchema = z.strictObject({
  version: z.number().int().min(1).max(2_147_483_647),
  currency: z.literal("USD"),
  covered_rate: rate,
  uncovered_rate: rate,
  discount_pct: decimal(2, 100),
  min_total: amount,
  tax_pct: z.literal(0),
  rounding: z.literal("salvionix_v4"),
  area_factors_provisional: z.boolean(),
  home_base_sqft: amount,
  home_bedroom_sqft: amount,
  parking_first_car_sqft: amount,
  parking_extra_car_sqft: amount,
  sqm_to_sqft: rate.refine((value) => value > 0, { message: "Must be positive" }),
  pace_to_ft: rate.refine((value) => value > 0, { message: "Must be positive" }),
  controls: z.array(quoteControl).min(3),
});

type PricingRules = z.infer<typeof rulesSchema>;

export const parsePricingRules = (source: string): PricingRules => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Price rules must be valid JSON");
  }
  const result = rulesSchema.safeParse(parsed);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "file").join(", ");
    throw new Error(`Invalid price rules: ${fields}`);
  }
  return result.data;
};

export const importPricingRules = async (
  db: pg.Client,
  brandSlug: string,
  rules: PricingRules,
): Promise<"activated" | "already active"> => {
  const { tax_pct, controls, ...price } = rules;
  const payload = JSON.stringify(price);
  const controlCases = controls.map((control) => "inputs" in control ? control : {
    ...control,
    inputs: {
      client_type: "business",
      covered_sqft: control.covered_sqft,
      extra_areas: [{ covered: false, sqft: control.uncovered_sqft }],
    },
  });

  await db.query("begin");
  try {
    // Serialize imports and read the same brand settings that quotes use.
    const { rows: [brand] } = await db.query<{ id: string; ready: boolean }>(
      `select id, tax_pct = $2 and discount_enabled as ready from core.brands where slug = $1 for update`,
      [brandSlug, tax_pct],
    );
    if (!brand?.ready) throw new Error("The brand must exist with zero tax and its discount switch on");

    const { rows: [{ at }] } = await db.query<{ at: string }>("select clock_timestamp()::text as at");
    const { rows: [latest] } = await db.query<{ id: string; version: number; active: boolean; matches: boolean }>(
      `select p.id, p.version, p.id = core.active_price_list($1, $3) as active,
              p.is_confirmed and to_jsonb(p) @> $2::jsonb as matches
       from core.price_lists p where p.brand_id = $1 order by p.version desc limit 1`,
      [brand.id, payload, at],
    );
    if (latest && rules.version < latest.version) throw new Error("Use a new price list version");
    if (latest?.version === rules.version && (!latest.active || !latest.matches)) {
      throw new Error("That price list version already exists with different rules or is no longer active; use a new version");
    }

    let listId = latest?.id;
    const sameVersion = latest?.version === rules.version;
    if (!sameVersion) {
      await db.query(
        `update core.price_lists set valid_to = $2 where id = core.active_price_list($1, $2)`,
        [brand.id, at],
      );
      const { rows: [inserted] } = await db.query<{ id: string }>(
        `insert into core.price_lists (
           brand_id, version, valid_from, is_confirmed, currency, covered_rate, uncovered_rate, discount_pct,
           min_total, home_base_sqft, home_bedroom_sqft, parking_first_car_sqft, parking_extra_car_sqft,
           sqm_to_sqft, pace_to_ft, rounding, area_factors_provisional
         )
         select $1, r.version, $2, true, r.currency, r.covered_rate, r.uncovered_rate, r.discount_pct,
                r.min_total, r.home_base_sqft, r.home_bedroom_sqft, r.parking_first_car_sqft, r.parking_extra_car_sqft,
                r.sqm_to_sqft, r.pace_to_ft, r.rounding, r.area_factors_provisional
         from jsonb_populate_record(null::core.price_lists, $3::jsonb) r returning id`,
        [brand.id, at, payload],
      );
      listId = inserted.id;
    }

    const { rows: [failure] } = await db.query<{ covered_sqft: string; uncovered_sqft: string }>(
      `select area.covered_sqft, area.uncovered_sqft
       from jsonb_to_recordset($2::jsonb)
         as expected(inputs jsonb, subtotal numeric, discount numeric, total numeric, min_applied boolean)
       cross join lateral core.quote_area($1, expected.inputs) area
       cross join lateral core.quote_totals($1, area.covered_sqft, area.uncovered_sqft) actual
       where row(actual.subtotal, actual.discount, actual.total, actual.min_applied)
         is distinct from row(expected.subtotal, expected.discount, expected.total, expected.min_applied)
       limit 1`,
      [listId, JSON.stringify(controlCases)],
    );
    if (failure) throw new Error(`Price control failed for ${failure.covered_sqft} covered + ${failure.uncovered_sqft} uncovered sqft`);

    await db.query("commit");
    return sameVersion ? "already active" : "activated";
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
};

if (import.meta.main) {
  const [path, extra] = process.argv.slice(2);
  if (!path || extra !== undefined) throw new Error("Usage: node scripts/db-import-pricing.ts <approved-prices.json | ->");

  const rules = parsePricingRules(readFileSync(path === "-" ? 0 : path, "utf8"));
  const db = await owner(process.env.PGDATABASE ?? "salvionix");
  try {
    const result = await importPricingRules(db, "salvionix", rules);
    console.log(`Pricing version ${rules.version} ${result} (${rules.controls.length} controls passed)`);
  } finally {
    await db.end();
  }
}
