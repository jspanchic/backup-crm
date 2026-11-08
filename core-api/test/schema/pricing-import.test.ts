import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPricingRules, parsePricingRules } from "../../scripts/db-import-pricing.ts";
import { REPO_ROOT } from "../../scripts/db-lib.ts";
import { ownerClient } from "../helpers.ts";

const approved = parsePricingRules(readFileSync(join(REPO_ROOT, "infra/vps/precios-salvionix.json"), "utf8"));
const parse = (values = {}) => parsePricingRules(JSON.stringify({ ...approved, ...values }));

describe("production price list import", () => {
  let db: pg.Client;
  const brand = "pricing-import-test";

  beforeAll(async () => {
    db = await ownerClient();
    await db.query("insert into core.brands (slug, name, timezone) values ($1, 'Pricing Import Test', 'UTC')", [brand]);
  });
  afterAll(() => db.end());

  it("requires the production rule, zero tax and explicit area factors", () => {
    expect(() => parse({ rounding: "ceil" })).toThrow(/rounding/);
    expect(() => parse({ tax_pct: 1 })).toThrow(/tax_pct/);
    expect(() => parse({ home_base_sqft: undefined })).toThrow(/home_base_sqft/);
    expect(() => parse({ covered_rate: 0.12501 })).toThrow(/covered_rate/);
    expect(() => parse({ controls: [] })).toThrow(/controls/);
  });

  it("upgrades the original list, quotes all six controls, and leaves the active list intact on failure", async () => {
    const legacy = parse({ version: 1, area_factors_provisional: true, controls: approved.controls.slice(0, 3) });
    await expect(importPricingRules(db, brand, legacy)).resolves.toBe("activated");
    await expect(importPricingRules(db, brand, approved)).resolves.toBe("activated");
    await expect(importPricingRules(db, brand, approved)).resolves.toBe("already active");
    await expect(importPricingRules(db, brand, parse({ min_total: 190 }))).rejects.toThrow(/already exists/);
    await expect(importPricingRules(db, brand, parse({ version: 3, covered_rate: 0.15 }))).rejects.toThrow(/Price control failed/);
    await expect(importPricingRules(db, brand, parse({ version: 3, home_bedroom_sqft: 160 })))
      .rejects.toThrow(/Price control failed for 2160 covered \+ 2000 uncovered sqft/);

    const { rows: lists } = await db.query(
      `select p.version, p.is_confirmed, p.area_factors_provisional, p.valid_to is null as active
       from core.price_lists p join core.brands b on p.brand_id = b.id where b.slug = $1 order by p.version`,
      [brand],
    );
    expect(lists).toEqual([
      { version: 1, is_confirmed: true, area_factors_provisional: true, active: false },
      { version: 2, is_confirmed: true, area_factors_provisional: false, active: true },
    ]);

    const { rows: [contact] } = await db.query<{ id: string; brand_id: string }>(
      `insert into public.contacts (first_name, brand_id, is_test)
       select 'Prueba pricing import', id, true from core.brands where slug = $1 returning id, brand_id`,
      [brand],
    );
    await db.query(
      `insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, is_test)
       values ('Pricing control', 'opportunity', array[$1::bigint], $1, $2, true)`,
      [contact.id, contact.brand_id],
    );
    const { rows: [conversation] } = await db.query<{ id: string }>(
      `with channel as (
         insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
         values ($1, 'waha', 'pricing-import-test', 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', true) returning id
       ), identity as (
         insert into core.contact_identities (brand_id, type, value)
         values ($1, 'phone_e164', '+14075550123') returning id
       )
       insert into core.conversations (brand_id, channel_id, identity_id, contact_id)
       select $1, channel.id, identity.id, $2 from channel cross join identity returning id`,
      [contact.brand_id, contact.id],
    );

    const quoteInputs = async (inputs: object) => {
      const { rows } = await db.query("select api.create_quote($1, $2::jsonb) as quote", [conversation.id, JSON.stringify(inputs)]);
      return rows[0].quote;
    };
    const quote = (covered: number, uncovered: number) =>
      quoteInputs({ client_type: "business", covered_sqft: covered, extra_areas: [{ covered: false, sqft: uncovered }] });
    expect(await quote(1731, 0)).toMatchObject({ subtotal: 208, discount: 15, total: 193, tax: 0, price_confirmed: true });
    expect(await quote(8000, 3000)).toMatchObject({ subtotal: 1140, discount: 80, total: 1060, tax: 0, price_confirmed: true });
    expect(await quote(1000, 0)).toMatchObject({ total: 150, min_applied: true });
    expect(await quoteInputs({
      client_type: "home",
      bedrooms: 3,
      covered_parking_cars: 2,
      extra_areas: [{ covered: true, sqft: 240 }, { covered: false, sqft: 2000 }],
    })).toMatchObject({ covered_sqft: 2100, uncovered_sqft: 2000, subtotal: 372, discount: 26, total: 346 });
    expect(await quote(1501, 0)).toMatchObject({ subtotal: 180, discount: 13, total: 167 });
    expect(await quote(1546, 0)).toMatchObject({ subtotal: 186, discount: 13, total: 173 });
    expect(await quote(1737.999, 0.999)).toMatchObject({ covered_sqft: 1737, uncovered_sqft: 0, subtotal: 208, total: 193 });

    const controls = approved.controls.map((control) => (control.min_applied ? { ...control, total: 160 } : control));
    await expect(importPricingRules(db, brand, parse({ version: 3, min_total: 160, controls }))).resolves.toBe("activated");
    expect(await quote(1000, 0)).toMatchObject({ total: 160, min_applied: true });
    await expect(importPricingRules(db, brand, parse())).rejects.toThrow(/new price list version/);
    const { rows: versions } = await db.query(
      `select version, valid_to is null as active from core.price_lists where brand_id = $1 order by version`,
      [contact.brand_id],
    );
    expect(versions).toEqual([{ version: 1, active: false }, { version: 2, active: false }, { version: 3, active: true }]);
  });
});
