import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_RESOURCES } from "../src/routes/admin-proxy.ts";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import { waitForPostgrest } from "./helpers.ts";

const ORIGIN = "http://127.0.0.1:5173";

describe("panel proxy", () => {
  let test: TestApp;

  beforeAll(async () => {
    await waitForPostgrest();
    test = createTestApp();
    // PostgREST checks the token against the real clock.
    test.clock.now = new Date();
  });
  afterAll(() => test.close());

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
        "deal_notes",
        "deals",
        "rpc/global_search",
        "sales",
        "tags",
        "tasks",
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

      const foreign = await test.app.inject({ method: "OPTIONS", url: "/admin/rest/contacts", headers: { origin: "https://evil.example" } });
      expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
      const response = await call("GET", "contacts_summary?limit=1", { headers: { origin: "https://evil.example" } });
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("exposes Content-Range to the panel", async () => {
      const response = await call("GET", "contacts_summary?limit=1");
      expect(response.headers["access-control-expose-headers"]).toBe("Content-Range");
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
