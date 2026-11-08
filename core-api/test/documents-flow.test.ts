import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PdfEngineError } from "../src/documents/gotenberg.ts";
import { runOutboxOnce } from "../src/outbox.ts";
import { at, createSetup, day, freeTimes, startLead, toolCall, type Lead, type Setup } from "./agenda-helpers.ts";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import { clearOutboxForTest, ownerClient } from "./helpers.ts";

/** The documents the bot flow produces by itself: the quote at `cotizar`, the orders at `confirmar`. */
describe("documents in the bot flow", () => {
  let test: TestApp;
  let owner: pg.Client;
  let templatesDir: string;

  beforeAll(async () => {
    owner = await ownerClient();
    templatesDir = mkdtempSync(join(tmpdir(), "salvionix-flow-templates-"));
    cpSync(join(import.meta.dirname, "../templates"), templatesDir, { recursive: true });
    test = createTestApp({ TEMPLATES_DIR: templatesDir, DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), "salvionix-flow-docs-")) });
  });
  // The outbox is shared by every test file: rows left by others would be claimed here, so start from an empty queue.
  beforeEach(() => clearOutboxForTest(owner));
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  /** A brand of its own (a new brand gets its own document counters), so numbers never mix with other tests. */
  const brand = (isTest: boolean): Promise<Setup> => createSetup(owner, { isTest, minNoticeMinutes: 0 });

  const call = (l: Lead, path: string, payload?: unknown) => toolCall(test, l.token, "POST", path, payload ?? {});
  const documentsOf = async (l: Lead) =>
    (await owner.query("select id::int, document_type, display_number, is_test from core.documents where deal_id = $1 order by id", [l.dealId])).rows;
  const queuedFiles = async (l: Lead) =>
    (await owner.query("select o.id::int, o.status, d.document_type, d.display_number from core.outbox o join core.document_files f on f.id = o.document_file_id join core.documents d on d.id = f.document_id where o.conversation_id = $1 order by o.id", [l.conversationId])).rows;

  const quoted = async (setup: Setup) => {
    const l = await startLead(test, owner, setup);
    await call(l, "guardar_datos", { nombre: "Carlos", tipo_cliente: "hogar", direccion: "123 Main St, Orlando" });
    return l;
  };
  const QUOTE = { tipo_cliente: "hogar", dormitorios: 3, autos_techados: 2 };

  /** Quote, hold and confirm. Returns the answer of confirmar. */
  const toConfirmation = async (l: Lead) => {
    await call(l, "cotizar", QUOTE);
    await freeTimes(test, l, day(3));
    await call(l, "reservar", { inicio: at(day(3), "09:00") });
    return call(l, "confirmar");
  };

  describe("test leads", () => {
    it("issues the quote at cotizar and sends it as a PDF, and tells the bot what is true", async () => {
      const l = await quoted(await brand(true));

      const response = await call(l, "cotizar", QUOTE);
      await runOutboxOnce(test.outboxDeps);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ pdf: "en_cola", aviso_pdf: expect.stringContaining("ya se puso en cola") });
      const [document] = await documentsOf(l);
      expect(document).toMatchObject({ document_type: "quote", is_test: true });
      expect(document.display_number).toMatch(/^PRUEBA-COT-\d{6}$/);
      const files = test.wahaCalls.filter((entry) => entry.url.endsWith("/api/sendFile"));
      expect(files).toHaveLength(1);
      expect(JSON.parse(files[0].body).file.filename).toBe(`${document.display_number}.pdf`);
      const message = (await owner.query("select sender, body from core.messages where conversation_id = $1 and body like 'Le enviamos%'", [l.conversationId])).rows;
      expect(message).toEqual([{ sender: "bot", body: `Le enviamos su cotización ${document.display_number}.` }]);
    });

    it("issues a new quote document when the bot quotes again", async () => {
      const l = await quoted(await brand(true));

      await call(l, "cotizar", QUOTE);
      await call(l, "cotizar", { ...QUOTE, dormitorios: 4 });

      expect((await documentsOf(l)).map((entry) => entry.document_type)).toEqual(["quote", "quote"]);
      expect(await queuedFiles(l)).toHaveLength(2);
    });

    it("sends the purchase order at confirmar and keeps the work order for the technician, unsent", async () => {
      const l = await quoted(await brand(true));

      const response = await toConfirmation(l);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ confirmado: true, pdf: "en_cola", aviso_pdf: expect.stringContaining("orden de compra") });
      const documents = await documentsOf(l);
      expect(documents.map((entry) => entry.document_type)).toEqual(["quote", "purchase_order", "work_order"]);
      expect(documents[1].display_number).toMatch(/^PRUEBA-OC-/);
      expect(documents[2].display_number).toMatch(/^PRUEBA-OT-/);
      // The quote and the purchase order are queued for the customer; the work order is not.
      expect((await queuedFiles(l)).map((entry) => entry.document_type)).toEqual(["quote", "purchase_order"]);
    });

    it("does not break the quote when the PDF engine is down, and says no PDF was sent", async () => {
      const l = await quoted(await brand(true));
      const next = test.pdfEngine.next;
      test.pdfEngine.next = async () => {
        throw new PdfEngineError("the PDF engine did not answer");
      };
      let response;
      try {
        response = await call(l, "cotizar", QUOTE);
      } finally {
        test.pdfEngine.next = next;
      }

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ total: expect.any(Number), pdf: "no_disponible", aviso_pdf: expect.stringContaining("No lo menciones") });
      expect(await queuedFiles(l)).toEqual([]);
      expect((await owner.query("select count(*)::int as n from core.quotes where deal_id = $1", [l.dealId])).rows[0].n).toBe(1);
    });

    it("confirms the appointment even when the PDF engine is down", async () => {
      const l = await quoted(await brand(true));
      await call(l, "cotizar", QUOTE);
      await freeTimes(test, l, day(3));
      await call(l, "reservar", { inicio: at(day(3), "09:00") });
      const next = test.pdfEngine.next;
      test.pdfEngine.next = async () => {
        throw new PdfEngineError("the PDF engine did not answer");
      };
      let response;
      try {
        response = await call(l, "confirmar");
      } finally {
        test.pdfEngine.next = next;
      }

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ confirmado: true, mensaje_enviado: true, pdf: "no_disponible" });
      expect((await owner.query("select status from core.appointments where deal_id = $1", [l.dealId])).rows[0].status).toBe("confirmed");
    });
  });

  describe("real customers: legal approval and the brand switch", () => {
    const enableRealPdf = (setup: Setup) =>
      owner.query("update core.brands set pdf_clientes_reales = true where id = $1", [setup.brandId]);

    const withLegalApproval = async (confirmed: boolean, check: () => Promise<void>) => {
      const settingsFile = join(templatesDir, "settings.json");
      const original = readFileSync(settingsFile, "utf8");
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(original), confirmed }));
      try {
        await check();
      } finally {
        writeFileSync(settingsFile, original);
      }
    };

    it("issues and sends nothing while the legal texts are not confirmed", async () => {
      const setup = await brand(false);
      await enableRealPdf(setup);
      const l = await quoted(setup);

      await withLegalApproval(false, async () => {
        const quote = await call(l, "cotizar", QUOTE);
        const confirmation = await toConfirmation(l);

        expect(quote.json()).toMatchObject({ pdf: "no_disponible" });
        expect(confirmation.json()).toMatchObject({ confirmado: true, pdf: "no_disponible" });
        expect(await documentsOf(l)).toEqual([]);
        expect(await queuedFiles(l)).toEqual([]);
      });
    });

    it("keeps internal work orders when real-customer deliveries are disabled", async () => {
      await withLegalApproval(true, async () => {
        const l = await quoted(await brand(false));
        const quote = await call(l, "cotizar", QUOTE);
        const confirmation = await toConfirmation(l);
        expect(quote.json()).toMatchObject({ pdf: "no_disponible" });
        expect(confirmation.json()).toMatchObject({ confirmado: true, pdf: "no_disponible" });
        expect((await documentsOf(l)).map((entry) => entry.document_type)).toEqual(["work_order"]);
        expect(await queuedFiles(l)).toEqual([]);
      });
    });

    it("works for real customers once the brand and legal settings allow it", async () => {
      await withLegalApproval(true, async () => {
        const setup = await brand(false);
        await enableRealPdf(setup);
        const l = await quoted(setup);
        await toConfirmation(l);

        const documents = await documentsOf(l);
        expect(documents.map((entry) => entry.display_number)).toEqual([expect.stringMatching(/^COT-\d{6}$/), expect.stringMatching(/^OC-\d{6}$/), expect.stringMatching(/^OT-\d{6}$/)]);
        expect((await queuedFiles(l)).map((entry) => entry.document_type)).toEqual(["quote", "purchase_order"]);
      });
    });
  });
});
