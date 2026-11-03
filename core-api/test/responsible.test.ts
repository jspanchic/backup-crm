import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, delivery, fakePhone, post, type TestApp } from "./app-helpers.ts";
import { createSetup, startLead, toolCall } from "./agenda-helpers.ts";
import { ownerClient } from "./helpers.ts";

describe("the person responsible for what the bot creates", () => {
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

  const makeSales = async (name: string): Promise<number> => {
    const userId = (await owner.query("select gen_random_uuid() as id")).rows[0].id;
    // A first user becomes the administrator; later ones are created by an administrator in the panel.
    await owner.query("alter table auth.users disable trigger on_auth_user_created");
    try {
      await owner.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${name}-${userId}@example.test`]);
      return (await owner.query("insert into public.sales (first_name, last_name, email, administrator, user_id) values ($1, 'Test', $2, false, $3) returning id::int", [name, `${name}-${userId}@example.test`, userId])).rows[0].id;
    } finally {
      await owner.query("alter table auth.users enable trigger on_auth_user_created");
    }
  };

  const created = async (s: Awaited<ReturnType<typeof createSetup>>) => {
    const lead = await startLead(test, owner, s);
    const { rows } = await owner.query(
      "select c.sales_id::int as contact, d.sales_id::int as deal from public.contacts c join public.deals d on d.primary_contact_id = c.id where c.id = $1",
      [lead.contactId],
    );
    return { lead, ...rows[0] };
  };

  it("is configured in the database for each brand, and the demo data points to Sebastián", async () => {
    const { rows } = await owner.query(
      "select s.first_name, s.administrator from core.brands b join public.sales s on s.id = b.default_sales_id where b.id = 1",
    );
    expect(rows).toEqual([{ first_name: "Sebastián", administrator: true }]);
  });

  it("assigns the contact and the opportunity the bot creates to that person", async () => {
    const phone = fakePhone();
    await post(test, delivery({ from: `${phone.digits}@c.us` }));
    await test.app.idle();
    const { rows } = await owner.query(
      `select c.sales_id::int as contact, d.sales_id::int as deal, b.default_sales_id::int as expected
       from public.contacts c join core.identity_holders h on h.contact_id = c.id join core.contact_identities i on i.id = h.identity_id
       join public.deals d on d.primary_contact_id = c.id join core.brands b on b.id = c.brand_id
       where i.value = $1`,
      [phone.e164],
    );
    expect(rows[0].expected).not.toBeNull();
    expect(rows[0]).toMatchObject({ contact: rows[0].expected, deal: rows[0].expected });
  });

  it("follows a change of the setting without touching what already exists", async () => {
    const s = await createSetup(owner);
    const first = await makeSales("Ana");
    const second = await makeSales("Luis");
    await owner.query("update core.brands set default_sales_id = $2 where id = $1", [s.brandId, first]);
    const before = await created(s);
    await owner.query("update core.brands set default_sales_id = $2 where id = $1", [s.brandId, second]);
    const after = await created(s);

    expect(before).toMatchObject({ contact: first, deal: first });
    expect(after).toMatchObject({ contact: second, deal: second });
    expect((await owner.query("select sales_id::int as id from public.contacts where id = $1", [before.lead.contactId])).rows[0].id).toBe(first);
  });

  it("gives the task of escalar to that person", async () => {
    const s = await createSetup(owner);
    const person = await makeSales("Rosa");
    await owner.query("update core.brands set default_sales_id = $2 where id = $1", [s.brandId, person]);
    const lead = await startLead(test, owner, s);

    await toolCall(test, lead.token, "POST", "escalar", { motivo: "ayuda" });
    expect((await owner.query("select sales_id::int as id from public.tasks where contact_id = $1", [lead.contactId])).rows).toEqual([{ id: person }]);
  });

  it("gives the follow up task of a closed sale to that person too", async () => {
    const s = await createSetup(owner);
    const person = await makeSales("Mario");
    await owner.query("update core.brands set default_sales_id = $2 where id = $1", [s.brandId, person]);
    const lead = await startLead(test, owner, s);
    await owner.query("update public.deals set stage = 'won' where id = $1", [lead.dealId]);
    expect((await owner.query("select sales_id::int as id from public.tasks where contact_id = $1", [lead.contactId])).rows).toEqual([{ id: person }]);
  });

  it("still works when a brand has nobody set: the rows are created without an owner", async () => {
    const s = await createSetup(owner);
    const result = await created(s);
    expect(result).toMatchObject({ contact: null, deal: null });
    await toolCall(test, result.lead.token, "POST", "escalar", { motivo: "ayuda" });
    expect((await owner.query("select count(*)::int as n from public.tasks where contact_id = $1", [result.lead.contactId])).rows[0].n).toBe(1);
  });

  it("can only point to somebody who exists", async () => {
    const s = await createSetup(owner);
    await expect(owner.query("update core.brands set default_sales_id = 999999999 where id = $1", [s.brandId])).rejects.toMatchObject({ code: "23503" });
  });
});
