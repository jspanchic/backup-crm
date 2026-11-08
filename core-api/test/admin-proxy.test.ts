import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSetup, day, startLead } from "./agenda-helpers.ts";
import { ADMIN_RESOURCES } from "../src/routes/admin-proxy.ts";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import { createQuote, ownerClient, waitForPostgrest } from "./helpers.ts";
import type pg from "pg";

const ORIGIN = "http://127.0.0.1:5173";

describe("panel proxy", () => {
  let test: TestApp;
  let owner: pg.Client;

  beforeAll(async () => {
    await waitForPostgrest();
    owner = await ownerClient();
    test = createTestApp();
    // PostgREST checks the token against the real clock.
    test.clock.now = new Date();
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const call = (method: string, path: string, options: { payload?: unknown; headers?: Record<string, string> } = {}) =>
    test.app.inject({
      method: method as "GET",
      url: `/admin/rest/${path}`,
      headers: { origin: ORIGIN, ...(options.payload ? { "content-type": "application/json" } : {}), ...options.headers },
      payload: options.payload === undefined ? undefined : JSON.stringify(options.payload),
    });

  describe("what passes", () => {
    it("lists with the PostgREST filters the panel already uses, and returns the total", async () => {
      const response = await call("GET", "contacts_summary?select=id,first_name&order=id.desc&limit=2&offset=0", {
        headers: { prefer: "count=exact" },
      });
      expect(response.statusCode).toBeLessThan(300);
      expect(response.headers["content-range"]).toMatch(/^\d+-\d+\/\d+$|^\*\/\d+$/);
      expect(Array.isArray(response.json())).toBe(true);
    });

    it("creates, edits and deletes a contact, as the panel does", async () => {
      const created = await call("POST", "contacts", {
        payload: { first_name: "Proxy", last_name: "Test" },
        headers: { prefer: "return=representation" },
      });
      expect(created.statusCode).toBe(201);
      const [contact] = created.json();
      expect(contact).toMatchObject({ first_name: "Proxy", brand_id: 1 });

      const edited = await call("PATCH", `contacts?id=eq.${contact.id}`, {
        payload: { last_name: "Edited" },
        headers: { prefer: "return=representation" },
      });
      expect(edited.json()[0].last_name).toBe("Edited");

      expect((await call("DELETE", `contacts?id=eq.${contact.id}`)).statusCode).toBe(204);
    });

    it("answers a getOne with one object, not a list of one", async () => {
      const response = await call("GET", "sales?id=eq.1&select=id", { headers: { accept: "application/vnd.pgrst.object+json" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: 1 });
    });

    it("passes on no other media type than JSON", async () => {
      const response = await call("GET", "sales?id=eq.1&select=id", { headers: { accept: "text/csv" } });
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toEqual([{ id: 1 }]);
    });

    it("lets the panel read the appointments list", async () => {
      expect((await call("GET", "appointments_summary?limit=1")).statusCode).toBeLessThan(300);
    });

    it("lets the panel use the global search", async () => {
      const response = await call("POST", "rpc/global_search", {
        payload: { query: "a", resources: ["contacts"], max_results: 3 },
      });
      expect(response.statusCode).toBe(200);
    });

    it("ignores an Authorization header from the browser: the proxy signs its own", async () => {
      const forged = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoicG9zdGdyZXMifQ.x";
      expect((await call("GET", "contacts_summary?limit=1", { headers: { authorization: forged } })).statusCode).toBeLessThan(300);
    });
  });

  describe("what does not exist", () => {
    it.each([
      "deal_followup_events",
      "appointments",
      "quotes",
      "documents",
      "price_lists",
      "users",
      "user_invitations",
      "rpc/merge_contacts",
      "rpc/get_avatar_for_email",
      "rpc/is_admin",
      "rpc/health",
      "contacts/../deal_followup_events",
      "contacts%2F..%2Fdeal_followup_events",
      "CONTACTS",
      "",
    ])("answers 404 for %j", async (resource) => {
      const response = await call("GET", resource);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
    });

    it("never lets the panel read the PostgREST root, which describes the whole API", async () => {
      expect((await call("GET", "")).statusCode).toBe(404);
      expect((await test.app.inject({ method: "GET", url: "/admin/rest" })).statusCode).toBe(404);
    });
  });

  describe("methods", () => {
    it.each([
      ["DELETE", "contacts_summary"],
      ["POST", "contacts_summary"],
      ["PATCH", "appointments_summary"],
      ["POST", "conversation_messages"],
      ["DELETE", "conversation_messages"],
      ["POST", "activity_log"],
      ["DELETE", "sales"],
      ["POST", "sales"],
      ["DELETE", "configuration"],
      ["GET", "rpc/global_search"],
    ])("rejects %s on %s", async (method, resource) => {
      expect((await call(method, resource)).statusCode).toBe(405);
    });

    it("lists exactly the resources of the permission list", () => {
      expect(Object.keys(ADMIN_RESOURCES).sort()).toEqual([
        "activity_log",
        "appointments_summary",
        "companies",
        "companies_summary",
        "configuration",
        "contact_notes",
        "contacts",
        "contacts_summary",
        "conversation_messages",
        "deal_notes",
        "deals",
        "rpc/global_search",
        "sales",
        "tags",
        "tasks",
        "technicians_summary",
      ]);
    });
  });

  describe("headers", () => {
    it.each(["return=representation; evil", "params=single-object", "tx=rollback", "return=headers-only, resolution=merge-duplicates"])(
      "rejects the Prefer value %j",
      async (prefer) => {
        expect((await call("GET", "contacts_summary?limit=1", { headers: { prefer } })).statusCode).toBe(400);
      },
    );

    it("answers the browser preflight for the panel origin only", async () => {
      const allowed = await test.app.inject({ method: "OPTIONS", url: "/admin/rest/contacts", headers: { origin: ORIGIN } });
      expect(allowed.statusCode).toBe(204);
      expect(allowed.headers["access-control-allow-origin"]).toBe(ORIGIN);
      expect(allowed.headers["access-control-allow-methods"]).toBe("GET, POST, PATCH, DELETE");
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

      const foreign = await test.app.inject({ method: "OPTIONS", url: "/admin/rest/contacts", headers: { origin: "https://evil.example" } });
      expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
      expect(foreign.headers["access-control-allow-credentials"]).toBeUndefined();
      const response = await call("GET", "contacts_summary?limit=1", { headers: { origin: "https://evil.example" } });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("exposes Content-Range to the panel", async () => {
      const response = await call("GET", "contacts_summary?limit=1");
      expect(response.headers["access-control-expose-headers"]).toBe("Content-Range");
    });
  });

  describe("who the panel is", () => {
    const person = async (name: string, administrator: boolean) => {
      const userId = (await owner.query("select gen_random_uuid() as id")).rows[0].id as string;
      await owner.query("alter table auth.users disable trigger on_auth_user_created");
      try {
        await owner.query("insert into auth.users (id, email) values ($1, $2)", [userId, `${name}-${userId}@example.test`]);
        await owner.query(
          "insert into public.sales (first_name, last_name, email, administrator, user_id) values ($1, 'Test', $2, $3, $4)",
          [name, `${name}-${userId}@example.test`, administrator, userId],
        );
      } finally {
        await owner.query("alter table auth.users enable trigger on_auth_user_created");
      }
      return userId;
    };

    it("tells the panel the name, id and role of the development user, and nothing else", async () => {
      const sub = await person("Marta", true);
      const own = createTestApp({ ADMIN_DEV_SUB: sub });
      own.clock.now = new Date();
      try {
        const response = await own.app.inject({ method: "GET", url: "/admin/session", headers: { origin: ORIGIN } });
        expect(response.statusCode).toBe(200);
        expect(Object.keys(response.json()).sort()).toEqual(["administrator", "avatar", "first_name", "id", "last_name"]);
        expect(response.json()).toMatchObject({ first_name: "Marta", administrator: true });
        expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
        expect(response.body).not.toContain("@");
      } finally {
        await own.close();
      }
    });

    it("says an ordinary user is not an administrator", async () => {
      const own = createTestApp({ ADMIN_DEV_SUB: await person("Luis", false) });
      own.clock.now = new Date();
      try {
        expect((await own.app.inject({ method: "GET", url: "/admin/session" })).json().administrator).toBe(false);
      } finally {
        await own.close();
      }
    });

    it("lets the loopback operator read and search without allowing unrelated mutations", async () => {
      const production = createTestApp({
        NODE_ENV: "production",
        PANEL_LOOPBACK_ADMIN: "true",
        ADMIN_DEV_SUB: await person("Operator", false),
      });
      production.clock.now = new Date();
      try {
        const session = await production.app.inject({ method: "GET", url: "/admin/session", headers: { origin: ORIGIN } });
        expect(session.statusCode).toBe(200);
        expect(session.headers["access-control-allow-origin"]).toBeUndefined();
        expect(session.json()).toMatchObject({ first_name: "Operator", administrator: false });
        expect((await production.app.inject({ method: "GET", url: "/admin/rest/contacts_summary?limit=1" })).statusCode).toBe(200);
        expect((await production.app.inject({
          method: "POST",
          url: "/admin/rest/rpc/global_search",
          payload: { query: "a", resources: ["contacts"], max_results: 3 },
        })).statusCode).toBe(200);
        for (const [method, url] of [
          ["POST", "/admin/rest/contacts"],
          ["PATCH", "/admin/rest/contacts?id=eq.1"],
          ["DELETE", "/admin/rest/contacts?id=eq.1"],
          ["POST", "/admin/documents"],
          ["POST", "/admin/documents/1/send"],
          ["POST", "/admin/agenda/appointments"],
          ["POST", "/admin/agenda/appointments/1/confirm"],
          ["POST", "/admin/agenda/appointments/1/reschedule"],
        ] as const) {
          const response = await production.app.inject({ method, url });
          expect(response.statusCode, `${method} ${url}`).toBe(405);
          expect(response.json()).toEqual({ error: "method_not_allowed" });
        }
      } finally {
        await production.close();
      }
    });

    it("limits the production operator to availability, blocks and releasing live holds", async () => {
      const sub = await person("Agenda operator", false);
      const production = createTestApp({
        NODE_ENV: "production",
        PANEL_LOOPBACK_ADMIN: "true",
        ADMIN_DEV_SUB: sub,
      });
      production.clock.now = new Date();
      const bot = createTestApp();
      const agenda = (method: "POST" | "DELETE", path: string, payload?: object) =>
        production.app.inject({ method, url: `/admin/agenda/${path}`, payload });
      try {
        const setup = await createSetup(owner, { timezone: "America/New_York", minNoticeMinutes: 0 });
        const [technician] = setup.technicianIds;
        await owner.query("update core.technicians set timezone = 'America/New_York', zip_prefixes = '{328}' where id = $1", [technician]);
        const date = day(3);
        const windows = [{ start: "10:00", end: "17:00" }];
        const path = `technicians/${technician}/availability`;
        const saved = await agenda("POST", path, { date, windows });
        expect(saved.statusCode, saved.body).toBe(200);
        expect(saved.json()).toMatchObject({ ventanas: 1 });
        const overlapping = await agenda("POST", path, {
          date,
          windows: [...windows, { start: "12:00", end: "15:00" }],
        });
        expect(overlapping.statusCode).toBe(400);
        expect(overlapping.json()).toEqual({ error: "invalid_input", reason: "overlapping_windows" });

        const listed = await production.app.inject({ method: "GET", url: `/admin/rest/technicians_summary?id=eq.${technician}` });
        expect(listed.statusCode).toBe(200);
        expect(listed.json()).toMatchObject([{
          timezone: "America/New_York",
          uses_dated_availability: true,
          dated_availability: [{ date, ...windows[0] }],
        }]);

        const block = await agenda("POST", `technicians/${technician}/time-off`, {
          from: `${date}T15:00:00Z`, to: `${date}T16:00:00Z`, reason: "Unavailable",
        });
        expect(block.statusCode, block.body).toBe(200);
        expect((await agenda("DELETE", `time-off/${block.json().id}`)).statusCode).toBe(200);

        const lead = await startLead(bot, owner, setup);
        const book = async (confirm: boolean): Promise<number> => Number((await owner.query(
          "select api.staff_book($1, $2, $3, '9 Pine Ave', $4) as appointment",
          [lead.dealId, technician, `${date}T15:00:00Z`, confirm],
        )).rows[0].appointment.id);
        const hold = await book(false);
        const simplePost = await production.app.inject({
          method: "POST", url: `/admin/agenda/appointments/${hold}/cancel`, headers: { origin: "https://example.test" },
        });
        expect(simplePost.statusCode).toBe(415);
        const released = await agenda("POST", `appointments/${hold}/cancel`, {});
        expect(released.statusCode, released.body).toBe(200);
        expect(released.json()).toMatchObject({ estado: "cancelled" });

        await createQuote(owner, lead.dealId);
        const confirmed = await book(true);
        const protectedAppointment = await agenda("POST", `appointments/${confirmed}/cancel`, {});
        expect(protectedAppointment.statusCode).toBe(409);
        expect(protectedAppointment.json()).toEqual({ error: "invalid_state", reason: "not_cancellable" });

        await owner.query("update public.sales set disabled = true where user_id = $1", [sub]);
        expect((await agenda("POST", path, { date, windows })).statusCode).toBe(401);
      } finally {
        await Promise.all([production.close(), bot.close()]);
      }
    });

    it("answers 401 when the identity is not a user of the system, or is disabled", async () => {
      expect((await test.app.inject({ method: "GET", url: "/admin/session" })).statusCode).toBe(401);
      const sub = await person("Ana", false);
      await owner.query("update public.sales set disabled = true where user_id = $1", [sub]);
      const own = createTestApp({ ADMIN_DEV_SUB: sub });
      own.clock.now = new Date();
      try {
        expect((await own.app.inject({ method: "GET", url: "/admin/session" })).statusCode).toBe(401);
      } finally {
        await own.close();
      }
    });

    it("does not exist without an identity or without the production opt-in", async () => {
      for (const overrides of [
        { ADMIN_DEV_SUB: undefined },
        { NODE_ENV: "production", PANEL_LOOPBACK_ADMIN: undefined },
        { NODE_ENV: "production", PANEL_LOOPBACK_ADMIN: "false" },
        { NODE_ENV: "production", PANEL_LOOPBACK_ADMIN: "true", ADMIN_DEV_SUB: "" },
      ]) {
        const bare = createTestApp(overrides);
        try {
          expect((await bare.app.inject({ method: "GET", url: "/admin/session" })).statusCode).toBe(404);
        } finally {
          await bare.close();
        }
      }
    });
  });

  describe("without a development identity", () => {
    it("is not registered at all, so nothing can reach the database through it", async () => {
      const bare = createTestApp({ ADMIN_DEV_SUB: undefined });
      try {
        const response = await bare.app.inject({ method: "GET", url: "/admin/rest/contacts_summary?limit=1" });
        expect(response.statusCode).toBe(404);
      } finally {
        await bare.close();
      }
    });

    it("is not registered in production, even with an identity configured", async () => {
      const production = createTestApp({ NODE_ENV: "production" });
      try {
        expect((await production.app.inject({ method: "GET", url: "/admin/rest/contacts_summary?limit=1" })).statusCode).toBe(404);
      } finally {
        await production.close();
      }
    });
  });

  it("lists the same routes as ROUTES.md: a route that is not documented does not exist", () => {
    const documented = readFileSync(join(import.meta.dirname, "../ROUTES.md"), "utf8")
      .split("\n")
      .filter((line) => /^\| (GET|POST|PATCH|DELETE)/.test(line))
      .map((line) => {
        const [, methods, route] = line.split("|").map((cell) => cell.trim());
        return { methods: methods.split(",").map((method) => method.trim()).sort(), route: route.replaceAll("`", "") };
      });

    const registered = new Map<string, string[]>();
    for (const entry of test.app.routesRegistered) {
      const [method, route] = entry.split(" ");
      registered.set(route, [...(registered.get(route) ?? []), method].sort());
    }

    expect(Object.fromEntries(registered)).toEqual(Object.fromEntries(documented.map((row) => [row.route, row.methods])));
  });
});
