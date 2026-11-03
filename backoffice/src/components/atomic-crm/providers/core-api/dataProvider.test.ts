import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthProvider } from "./authProvider";
import { getDataProvider } from "./dataProvider";
import { setShowTestLeads } from "./testLeads";

type Call = { url: string; init: RequestInit };

// PostgREST always answers a list with the total in Content-Range, and the provider requires it.
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Range": Array.isArray(body)
        ? `0-${Math.max(body.length - 1, 0)}/${body.length}`
        : "*/*",
      ...(init.headers ?? {}),
    },
    ...init,
  });

describe("core-api data provider", () => {
  let calls: Call[];
  let answer: (url: string) => Response;

  beforeEach(() => {
    calls = [];
    answer = () => json([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        calls.push({ url, init });
        return answer(url);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setShowTestLeads(false);
  });

  const headersOf = (call: Call) =>
    new Headers(call.init.headers as HeadersInit);

  it("sends every list request to /admin/rest, never to Supabase, and carries no token of its own", async () => {
    await getDataProvider().getList("deals", {
      pagination: { page: 1, perPage: 25 },
      sort: { field: "index", order: "DESC" },
      filter: { stage: "proposal-sent" },
    });

    const [call] = calls;
    expect(call.url.startsWith("http://127.0.0.1:3000/admin/rest/deals?")).toBe(
      true,
    );
    expect(call.url).toContain("stage=eq.proposal-sent");
    expect(call.url).toContain("order=index.desc");
    expect(call.url).toContain("limit=25");
    expect(headersOf(call).has("authorization")).toBe(false);
    expect(call.init.credentials).toBe("include");
  });

  it.each([
    ["contacts", "contacts_summary"],
    ["companies", "companies_summary"],
    ["appointments", "appointments_summary"],
  ])("reads %s from the view %s", async (resource, view) => {
    await getDataProvider().getList(resource, {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    expect(calls[0].url).toContain(`/admin/rest/${view}?`);
  });

  it("filters appointments by status and sorts them by date", async () => {
    await getDataProvider().getList("appointments", {
      pagination: { page: 2, perPage: 25 },
      sort: { field: "start_at", order: "DESC" },
      filter: { status: "confirmed" },
    });
    const url = calls[0].url;
    expect(url).toContain("status=eq.confirmed");
    expect(url).toContain("order=start_at.desc");
    expect(url).toContain("offset=25");
  });

  it("turns the search box of contacts into a case-insensitive search over their columns", async () => {
    await getDataProvider().getList("contacts", {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "last_seen", order: "DESC" },
      filter: { q: "Ana" },
    });
    const url = decodeURIComponent(calls[0].url);
    expect(url).toContain("first_name.ilike.*Ana*");
    expect(url).toContain("last_name.ilike.*Ana*");
  });

  it("reads the configuration row and the global search through the same door", async () => {
    answer = (url) =>
      url.includes("rpc/global_search")
        ? json([{ resource: "contacts", record_id: 1 }])
        : json({ id: 1, config: { title: "x" } });
    const provider = getDataProvider();
    expect(await provider.getConfiguration()).toEqual({ title: "x" });
    expect(await provider.globalSearch("ana", ["contacts"], 5)).toEqual([
      { resource: "contacts", record_id: 1 },
    ]);
    expect(
      calls.map((call) => call.url.replace("http://127.0.0.1:3000", "")),
    ).toEqual([
      "/admin/rest/configuration?id=eq.1",
      "/admin/rest/rpc/global_search",
    ]);
    expect(calls[1].init.method).toBe("POST");
  });

  it("never writes appointments from the panel", async () => {
    const provider = getDataProvider();
    await expect(
      provider.create("appointments", { data: { status: "confirmed" } }),
    ).rejects.toThrow(/not available/);
    await expect(
      provider.update("appointments", {
        id: 1,
        data: {},
        previousData: { id: 1 },
      }),
    ).rejects.toThrow(/not available/);
    await expect(provider.delete("appointments", { id: 1 })).rejects.toThrow(
      /not available/,
    );
    expect(calls).toHaveLength(0);
  });

  it.each([
    "signUp",
    "salesCreate",
    "salesUpdate",
    "updatePassword",
    "mergeContacts",
  ] as const)(
    "says clearly that %s needs a core-api route instead of calling Supabase",
    async (method) => {
      const provider = getDataProvider() as unknown as Record<
        string,
        () => Promise<unknown>
      >;
      await expect(provider[method]()).rejects.toThrow(/core-api route/);
      expect(calls).toHaveLength(0);
    },
  );

  it("is always initialized: there is no first-user sign-up screen", async () => {
    expect(await getDataProvider().isInitialized()).toBe(true);
  });
});

describe("core-api auth provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const session = {
    id: 7,
    first_name: "Sebastián",
    last_name: "(demo)",
    avatar: null,
    administrator: true,
  };

  it("asks core-api who the user is, once, and reads identity and rights from the answer", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(session),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = getAuthProvider();

    await expect(provider.checkAuth({})).resolves.toBeUndefined();
    expect(await provider.getIdentity!()).toEqual({
      id: 7,
      fullName: "Sebastián (demo)",
      avatar: undefined,
    });
    expect(
      await provider.canAccess!({ resource: "sales", action: "list" }),
    ).toBe(true);
    // The second and third calls reuse the first answer; the module remembers it.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/admin/session");
  });
});

describe("core-api data provider: test leads and conversations", () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), init });
        return json([]);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setShowTestLeads(false);
  });

  const list = (resource: string, filter: Record<string, unknown> = {}) =>
    getDataProvider().getList(resource, {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
      filter,
    });

  it.each([
    "deals",
    "contacts",
    "tasks",
    "contact_notes",
    "deal_notes",
    "activity_log",
    "appointments",
  ])("keeps test leads out of the %s list by default", async (resource) => {
    await list(resource);
    expect(calls[0].url).toContain("is_test=eq.false");
  });

  it("keeps them out of the dashboard and the board without disturbing their own filters", async () => {
    await list("deals", { stage: "won", "archived_at@is": null });
    expect(calls[0].url).toContain("stage=eq.won");
    expect(calls[0].url).toContain("is_test=eq.false");
  });

  it("lets a caller that needs every row ask for them, as the position in a column does", async () => {
    await getDataProvider().getList("deals", {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "index", order: "DESC" },
      filter: { stage: "won" },
      meta: { includeTestLeads: true },
    });
    expect(calls[0].url).not.toContain("is_test");
  });

  it("shows them when the user asks to see them", async () => {
    setShowTestLeads(true);
    await list("deals");
    expect(calls[0].url).not.toContain("is_test");
  });

  it("goes back to hiding them when the user hides them again", async () => {
    setShowTestLeads(true);
    setShowTestLeads(false);
    await list("deals");
    expect(calls[0].url).toContain("is_test=eq.false");
  });

  it.each([
    ["tasks", { contact_id: 7 }],
    ["contact_notes", { contact_id: 7 }],
    ["deal_notes", { deal_id: 9 }],
    ["deals", { "contact_ids@cs": "{7}" }],
  ])(
    "does not hide what hangs from one record: the %s of a test lead are on its own page",
    async (resource, filter) => {
      await list(resource, filter);
      expect(calls[0].url).not.toContain("is_test");
    },
  );

  it("does not add the mark where there is none", async () => {
    await list("companies");
    await list("conversation_messages", { contact_id: 7 });
    expect(calls.every((call) => !call.url.includes("is_test"))).toBe(true);
  });

  it("asks the conversation of a contact from its own resource", async () => {
    await list("conversation_messages", { contact_id: 7 });
    expect(calls[0].url).toContain("/admin/rest/conversation_messages?");
    expect(calls[0].url).toContain("contact_id=eq.7");
  });
});
