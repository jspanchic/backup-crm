import { CoreAdminContext, type DataProvider } from "ra-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { DealDocuments } from "./DealDocuments";
import type { DealDocument, DealDocuments as Listing } from "./documentsApi";

const i18n = {
  translate: (key: string) => key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

const document_ = (overrides: Partial<DealDocument>): DealDocument => ({
  id: 1,
  display_number: "COT-000001",
  document_type: "quote",
  is_test: false,
  status: "issued",
  issued_at: "2030-06-01T16:30:00Z",
  appointment_id: null,
  file: { id: 10, size_bytes: 1000 },
  sent_at: null,
  send_status: null,
  ...overrides,
});

const listing = (overrides: Partial<Listing> = {}): Listing => ({
  documents: [],
  can_issue: { quote: false, purchase_order: false, work_order: false },
  legal_confirmed: false,
  ...overrides,
});

type Call = { method: string; path: string; body?: unknown };

/** core-api, as far as this section can see it. The panel talks to it through fetch, so that is what is replaced. */
const open = async (data: Listing) => {
  const calls: Call[] = [];
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    calls.push({
      method,
      path,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (method === "GET" && url.pathname === "/admin/documents")
      return answer(data);
    if (method === "POST" && url.pathname === "/admin/documents")
      return answer({ id: 5, display_number: "COT-000005" }, 201);
    if (method === "POST" && url.pathname.endsWith("/send"))
      return answer({ outbox_id: 1 }, 202);
    if (method === "GET" && url.pathname.endsWith("/pdf"))
      return new Response("%PDF-1.4", {
        headers: { "Content-Type": "application/pdf" },
      });
    return answer({ error: "not_found" }, 404);
  });
  const screen = await render(
    <CoreAdminContext dataProvider={{} as DataProvider} i18nProvider={i18n}>
      <DealDocuments dealId={7} />
    </CoreAdminContext>,
  );
  return { screen, calls };
};

describe("DealDocuments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks core-api for the documents of that deal", async () => {
    const { screen, calls } = await open(listing());

    await expect
      .element(screen.getByText("resources.deals.documents.empty"))
      .toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/admin/documents?deal_id=7",
    });
  });

  it("lists each document with its number, kind and test mark", async () => {
    const { screen } = await open(
      listing({
        documents: [
          document_({
            id: 2,
            display_number: "PRUEBA-OC-000003",
            document_type: "purchase_order",
            is_test: true,
          }),
          document_({ id: 1, display_number: "COT-000001" }),
        ],
      }),
    );

    await expect
      .element(screen.getByText("PRUEBA-OC-000003"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("COT-000001")).toBeInTheDocument();
    await expect
      .element(screen.getByText("resources.deals.documents.test"))
      .toBeInTheDocument();
  });

  it("keeps Send locked for a real customer while the legal texts are unconfirmed, and says why", async () => {
    const { screen } = await open(
      listing({ documents: [document_({})], legal_confirmed: false }),
    );

    await expect
      .element(
        screen.getByRole("button", { name: "resources.deals.documents.send" }),
      )
      .toBeDisabled();
    await expect
      .element(screen.getByText("resources.deals.documents.locked"))
      .toBeInTheDocument();
  });

  it("lets a test document be sent even while the legal texts are unconfirmed", async () => {
    const { screen, calls } = await open(
      listing({
        documents: [document_({ is_test: true })],
        legal_confirmed: false,
      }),
    );

    await screen
      .getByRole("button", { name: "resources.deals.documents.send" })
      .click();

    await vi.waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "POST",
          path: "/admin/documents/1/send",
        }),
      ),
    );
  });

  it("lets a real document be sent once the legal texts are confirmed", async () => {
    const { screen } = await open(
      listing({ documents: [document_({})], legal_confirmed: true }),
    );

    await expect
      .element(
        screen.getByRole("button", { name: "resources.deals.documents.send" }),
      )
      .toBeEnabled();
    await expect
      .element(screen.getByText("resources.deals.documents.locked"))
      .not.toBeInTheDocument();
  });

  it("downloads the PDF of the document", async () => {
    const { screen, calls } = await open(
      listing({ documents: [document_({})] }),
    );

    await screen
      .getByRole("button", { name: "resources.deals.documents.download" })
      .click();

    await vi.waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: "GET",
          path: "/admin/documents/1/pdf",
        }),
      ),
    );
  });

  it("offers only the documents that can be issued now, and issues the one that is chosen", async () => {
    const { screen, calls } = await open(
      listing({
        can_issue: { quote: true, purchase_order: false, work_order: false },
      }),
    );

    await screen
      .getByRole("button", { name: "resources.deals.documents.generate" })
      .click();

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/admin/documents",
        body: { deal_id: 7, document_type: "quote" },
      }),
    );
    expect(
      screen
        .getByRole("button", { name: "resources.deals.documents.generate" })
        .elements(),
    ).toHaveLength(1);
  });

  it("offers to generate the PDF of a document whose file failed, instead of a download", async () => {
    const { screen, calls } = await open(
      listing({ documents: [document_({ file: null })] }),
    );

    await expect
      .element(screen.getByText("resources.deals.documents.no_file"))
      .toBeInTheDocument();
    await screen
      .getByRole("button", { name: "resources.deals.documents.generate_pdf" })
      .click();

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "POST",
        path: "/admin/documents",
        body: { deal_id: 7, document_type: "quote" },
      }),
    );
  });

  it("does not offer to send a work order to the customer: it is for the technician", async () => {
    const { screen } = await open(
      listing({
        documents: [
          document_({
            document_type: "work_order",
            display_number: "OT-000001",
            is_test: true,
          }),
        ],
      }),
    );

    await expect
      .element(screen.getByText("resources.deals.documents.for_technician"))
      .toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "resources.deals.documents.send" })
        .elements(),
    ).toHaveLength(0);
  });

  it("shows when a document was sent and lets it be sent again", async () => {
    const { screen } = await open(
      listing({
        documents: [
          document_({
            is_test: true,
            sent_at: "2030-06-02T10:00:00Z",
            send_status: "sent",
          }),
        ],
      }),
    );

    await expect
      .element(
        screen.getByRole("button", {
          name: "resources.deals.documents.send_again",
        }),
      )
      .toBeEnabled();
  });
});
