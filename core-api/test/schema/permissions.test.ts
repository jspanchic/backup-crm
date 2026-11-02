import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coreApiClient, ownerClient, POSTGREST_TEST_URL, signPanelToken, waitForPostgrest } from "../helpers.ts";

const PERMISSION_DENIED = { code: "42501" };

describe("permissions", () => {
  let db: pg.Client;
  beforeAll(async () => {
    db = await ownerClient();
  });
  afterAll(() => db.end());

  describe("core_api", () => {
    let api: pg.Client;
    beforeAll(async () => {
      api = await coreApiClient();
    });
    afterAll(() => api.end());

    it("can run functions in schema api", async () => {
      const { rows } = await api.query("select api.health() as ok");
      expect(rows[0].ok).toBe(true);
    });

    it.each([
      "select * from core.appointments",
      "select * from core.quotes",
      "select * from core.price_lists",
      "select * from core.documents",
      "select * from public.contacts",
      "select * from public.deals",
      "select * from auth.users",
      "insert into core.brands (slug, name, timezone) values ('x', 'x', 'UTC')",
      "update public.deals set amount = 1",
      "select core.active_price_list(1)",
      "select public.global_search('a', array['contacts'], 1)",
    ])("cannot run: %s", async (sql) => {
      await expect(api.query(sql)).rejects.toMatchObject(PERMISSION_DENIED);
    });
  });

  describe("the exact list held by each role", () => {
    it("gives crm_api exactly these tables and views", async () => {
      const { rows } = await db.query(
        `select table_name as name, string_agg(privilege_type, ',' order by privilege_type) as privileges
         from information_schema.role_table_grants
         where grantee = 'crm_api'
         group by table_name order by table_name`,
      );
      const crud = "DELETE,INSERT,SELECT,UPDATE";
      expect(Object.fromEntries(rows.map((row) => [row.name, row.privileges]))).toEqual({
        activity_log: "SELECT",
        appointments_summary: "SELECT",
        companies: crud,
        companies_summary: "SELECT",
        configuration: "SELECT,UPDATE",
        contact_notes: crud,
        contacts: crud,
        contacts_summary: "SELECT",
        deal_followup_events: "INSERT,SELECT",
        deal_notes: crud,
        deals: crud,
        sales: "SELECT",
        tags: crud,
        tasks: crud,
      });
    });

    it("lets crm_api update only three columns of sales", async () => {
      const { rows } = await db.query(
        `select column_name from information_schema.role_column_grants
         where grantee = 'crm_api' and table_name = 'sales' and privilege_type = 'UPDATE'
         order by column_name`,
      );
      expect(rows.map((row) => row.column_name)).toEqual(["avatar", "first_name", "last_name"]);
    });

    it("gives crm_api exactly these functions", async () => {
      const { rows } = await db.query(
        `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'api', 'core', 'auth', 'net')
           and has_function_privilege('crm_api', p.oid, 'EXECUTE')
         order by 1`,
      );
      expect(rows.map((row) => row.name)).toEqual([
        "auth.uid",
        "public.get_avatar_for_email",
        "public.global_search",
        "public.is_admin",
        "public.search_attachment_titles",
        "public.search_document",
        "public.search_query",
        "public.search_unaccent",
      ]);
    });

    it("gives core_api functions in schema api and nothing else in our schemas", async () => {
      const { rows } = await db.query(
        `select n.nspname as schema, count(*)::int as total
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'core', 'auth', 'net', 'api')
           and has_function_privilege('core_api', p.oid, 'EXECUTE')
         group by 1`,
      );
      expect(rows.map((row) => row.schema)).toEqual(["api"]);

      const { rows: tables } = await db.query(
        `select count(*)::int as total from information_schema.role_table_grants where grantee = 'core_api'`,
      );
      expect(tables[0].total).toBe(0);
    });

    it.each(["anon", "authenticated", "service_role", "crm_anon"])("gives %s no table at all", async (role) => {
      const { rows } = await db.query(
        `select table_name from information_schema.role_table_grants where grantee = $1`,
        [role],
      );
      expect(rows).toEqual([]);
    });

    it.each(["core", "api", "auth", "storage", "net"])("gives crm_anon no access to schema %s", async (schema) => {
      const { rows } = await db.query(`select has_schema_privilege('crm_anon', $1, 'USAGE') as can_use`, [schema]);
      expect(rows[0].can_use).toBe(false);
    });

    it("gives crm_api no access to schemas core, api, storage or net", async () => {
      const { rows } = await db.query(
        `select nspname from pg_namespace
         where nspname in ('core', 'api', 'storage', 'net') and has_schema_privilege('crm_api', nspname, 'USAGE')`,
      );
      expect(rows).toEqual([]);
    });
  });

  describe("through PostgREST", () => {
    const panelToken = () => signPanelToken({ role: "crm_api", sub: randomUUID() });

    const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
      const { token = panelToken(), ...rest } = init;
      return fetch(`${POSTGREST_TEST_URL}/${path}`, {
        ...rest,
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    };

    beforeAll(waitForPostgrest, 110_000);

    it("rejects a request with no token", async () => {
      expect((await call("contacts?limit=1", { token: null })).status).toBe(401);
    });

    it("rejects a token asking for the postgres role", async () => {
      const token = signPanelToken({ role: "postgres", sub: randomUUID() });
      expect((await call("contacts?limit=1", { token })).status).toBe(403);
    });

    it("rejects a token signed with another secret", async () => {
      const token = signPanelToken({ role: "crm_api", sub: randomUUID() }, "x".repeat(64));
      expect((await call("contacts?limit=1", { token })).status).toBe(401);
    });

    it("rejects an expired token", async () => {
      const token = signPanelToken({ role: "crm_api", sub: randomUUID(), exp: 1_000_000 });
      expect((await call("contacts?limit=1", { token })).status).toBe(401);
    });

    it.each(["contacts_summary", "companies_summary", "deals", "tasks", "activity_log", "appointments_summary"])(
      "lets the panel read %s",
      async (resource) => {
        expect((await call(`${resource}?limit=1`)).status).toBeLessThan(300);
      },
    );

    it.each(["appointments", "quotes", "documents", "price_lists", "users", "buckets", "user_invitations"])(
      "does not expose %s",
      async (resource) => {
        expect([403, 404]).toContain((await call(`${resource}?limit=1`)).status);
      },
    );

    it.each(["merge_contacts", "get_user_id_by_email", "health"])("does not expose the function %s", async (name) => {
      expect([403, 404]).toContain((await call(`rpc/${name}`, { method: "POST", body: "{}" })).status);
    });

    it("does not let the panel write to appointments through the view", async () => {
      const response = await call("appointments_summary", { method: "POST", body: JSON.stringify({ status: "confirmed" }) });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("does not let the panel change who is an administrator", async () => {
      const response = await call("sales?id=eq.1", { method: "PATCH", body: JSON.stringify({ administrator: true }) });
      expect(response.status).toBe(403);
    });

    it("creates a contact from the panel, with no avatar call to the outside", async () => {
      const response = await call("contacts", {
        method: "POST",
        body: JSON.stringify({
          first_name: "Panel",
          last_name: "Contact",
          email_jsonb: [{ email: "panel@example.test", type: "Work" }],
        }),
      });
      expect(response.status).toBe(201);
      const [contact] = await response.json();
      expect(contact.avatar).toBeNull();
      expect(contact.brand_id).toBe(1);
    });

    it("creates the follow-up task when the panel wins a deal", async () => {
      const contactResponse = await call("contacts", {
        method: "POST",
        body: JSON.stringify({ first_name: "Won", last_name: "Deal" }),
      });
      const [contact] = await contactResponse.json();
      const dealResponse = await call("deals", {
        method: "POST",
        body: JSON.stringify({ name: "Won deal", stage: "opportunity", contact_ids: [contact.id], index: 0 }),
      });
      const [deal] = await dealResponse.json();

      const won = await call(`deals?id=eq.${deal.id}`, { method: "PATCH", body: JSON.stringify({ stage: "won" }) });
      expect(won.status).toBe(200);

      const { rows } = await db.query("select text from public.tasks where contact_id = $1", [contact.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].text).toContain("Won deal");
    });
  });
});
