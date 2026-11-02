import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLead, ownerClient } from "../helpers.ts";

const PRICE_LIST_VERSION_1 = "(select id from core.price_lists where brand_id = 1 and version = 1)";

describe("pricing", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = await ownerClient();
  });
  afterAll(() => db.end());

  const area = async (inputs: object) => {
    const { rows } = await db.query(
      `select covered_sqft::float as covered, uncovered_sqft::float as uncovered
       from core.quote_area(${PRICE_LIST_VERSION_1}, $1::jsonb)`,
      [JSON.stringify(inputs)],
    );
    return rows[0];
  };

  const totals = async (covered: number, uncovered: number) => {
    const { rows } = await db.query(
      `select subtotal::float, discount::float, total::float, min_applied
       from core.quote_totals(${PRICE_LIST_VERSION_1}, $1, $2)`,
      [covered, uncovered],
    );
    return rows[0];
  };

  // Vectors from the sales prompt ([SM]:213-231), with the example prices.
  it.each([
    { name: "prompt home example", covered: 2100, uncovered: 2000, subtotal: 372, total: 346, minApplied: false },
    { name: "prompt business example", covered: 8000, uncovered: 3000, subtotal: 1140, total: 1060, minApplied: false },
    { name: "3 bedrooms, 2 covered cars", covered: 1860, uncovered: 0, subtotal: 223.2, total: 208, minApplied: false },
    { name: "same plus 1000 uncovered", covered: 1860, uncovered: 1000, subtotal: 283.2, total: 263, minApplied: false },
    { name: "small business: the minimum applies", covered: 1000, uncovered: 0, subtotal: 120, total: 150, minApplied: true },
    { name: "the discount never breaks the minimum", covered: 1000, uncovered: 640, subtotal: 158.4, total: 150, minApplied: true },
  ])("calculates $name", async ({ covered, uncovered, subtotal, total, minApplied }) => {
    expect(await totals(covered, uncovered)).toMatchObject({ subtotal, total, min_applied: minApplied });
  });

  describe("area from what the customer said", () => {
    it("estimates a home from the prompt example, with a covered extra and an uncovered garden", async () => {
      await expect(
        area({
          client_type: "home",
          bedrooms: 3,
          covered_parking_cars: 2,
          extra_areas: [
            { covered: true, sqft: 240 },
            { covered: false, sqft: 2000 },
          ],
        }),
      ).resolves.toEqual({ covered: 2100, uncovered: 2000 });
    });

    it.each([
      [0, 0],
      [1, 240],
      [2, 440],
      [3, 640],
    ])("counts %i uncovered cars as %i square feet", async (cars, uncovered) => {
      await expect(area({ client_type: "business", covered_sqft: 0, uncovered_parking_cars: cars })).resolves.toEqual({
        covered: 0,
        uncovered,
      });
    });

    it("converts square meters and paces with the price list parameters", async () => {
      await expect(
        area({
          client_type: "business",
          covered_sqft: 0,
          extra_areas: [
            { covered: true, sqm: 100 },
            { covered: false, paces_long: 10, paces_wide: 4 },
          ],
        }),
      ).resolves.toEqual({ covered: 1076, uncovered: 250 });
    });

    it.each([
      ["an unknown client type", { client_type: "other" }],
      ["a home without bedrooms", { client_type: "home" }],
      ["a business without area", { client_type: "business" }],
      ["negative cars", { client_type: "business", covered_sqft: 1, covered_parking_cars: -1 }],
      ["an extra area with no size", { client_type: "business", covered_sqft: 1, extra_areas: [{ covered: true }] }],
      ["an extra area that does not say if it has a roof", { client_type: "business", covered_sqft: 1, extra_areas: [{ sqft: 5 }] }],
      ["a negative extra area", { client_type: "business", covered_sqft: 1, extra_areas: [{ covered: true, sqft: -5 }] }],
    ])("rejects %s", async (_name, inputs) => {
      await expect(area(inputs)).rejects.toMatchObject({ code: "CX004" });
    });
  });

  describe("quotes", () => {
    const insertQuote = async (dealId: number, covered = 1860) => {
      const { rows } = await db.query(
        `insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs)
         values ($1, $2, 0, '{}') returning id::int, version, total::float, price_confirmed, currency`,
        [dealId, covered],
      );
      return rows[0];
    };

    it("recalculates every amount, ignoring what the caller sends", async () => {
      const { dealId } = await createLead(db);
      const { rows } = await db.query(
        `insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs, subtotal, discount, total, min_applied, currency, price_confirmed)
         values ($1, 1860, 0, '{}', 1, 1, 1, false, 'EUR', true)
         returning subtotal::float, total::float, currency, price_confirmed`,
        [dealId],
      );
      expect(rows[0]).toEqual({ subtotal: 223.2, total: 208, currency: "USD", price_confirmed: false });
    });

    it("numbers versions per deal", async () => {
      const { dealId } = await createLead(db);
      expect((await insertQuote(dealId)).version).toBe(1);
      expect((await insertQuote(dealId)).version).toBe(2);
    });

    it("cannot change an amount or be deleted, only its status", async () => {
      const { dealId } = await createLead(db);
      const quote = await insertQuote(dealId);

      await expect(db.query("update core.quotes set total = 1 where id = $1", [quote.id])).rejects.toMatchObject({
        code: "CX001",
      });
      await expect(db.query("delete from core.quotes where id = $1", [quote.id])).rejects.toMatchObject({
        code: "CX001",
      });
      await expect(
        db.query("update core.quotes set status = 'superseded' where id = $1", [quote.id]),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  describe("price lists are versioned", () => {
    it("marks the example prices as not confirmed", async () => {
      const { rows } = await db.query(`select is_confirmed from core.price_lists where id = ${PRICE_LIST_VERSION_1}`);
      expect(rows[0].is_confirmed).toBe(false);
    });

    it("cannot change a price, only close it or confirm it", async () => {
      await expect(
        db.query(`update core.price_lists set covered_rate = 1 where id = ${PRICE_LIST_VERSION_1}`),
      ).rejects.toMatchObject({ code: "CX001" });
      await expect(
        db.query(`delete from core.price_lists where id = ${PRICE_LIST_VERSION_1}`),
      ).rejects.toMatchObject({ code: "CX001" });
    });

    it("cannot have two lists in force at once, and a new one leaves old quotes intact", async () => {
      await db.query("begin");
      try {
        const { dealId } = await createLead(db);
        const { rows: before } = await db.query(
          `insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs)
           values ($1, 1860, 0, '{}') returning id, total::float`,
          [dealId],
        );

        const newList = `insert into core.price_lists (
            brand_id, version, valid_from, is_confirmed, currency, covered_rate, uncovered_rate, discount_pct,
            min_total, home_base_sqft, home_bedroom_sqft, parking_first_car_sqft, parking_extra_car_sqft,
            sqm_to_sqft, pace_to_ft)
          values (1, 2, now(), true, 'USD', 0.24, 0.12, 0, 150, 1000, 140, 240, 200, 10.76, 2.5)`;

        await db.query("savepoint overlap");
        await expect(db.query(newList)).rejects.toMatchObject({ code: "23P01" });
        await db.query("rollback to savepoint overlap");

        await db.query(`update core.price_lists set valid_to = now() where id = ${PRICE_LIST_VERSION_1}`);
        await db.query(newList);

        const { rows: after } = await db.query(
          `insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs)
           values ($1, 1860, 0, '{}') returning total::float, price_confirmed`,
          [dealId],
        );
        expect(after[0]).toEqual({ total: 446, price_confirmed: true });

        const { rows: old } = await db.query("select total::float from core.quotes where id = $1", [before[0].id]);
        expect(old[0].total).toBe(before[0].total);
      } finally {
        await db.query("rollback");
      }
    });
  });
});
