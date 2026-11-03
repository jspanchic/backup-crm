import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./app-helpers.ts";
import { createLead, createQuote, createTechnician, insertHold, ownerClient, setStatus, waitForPostgrest, type Lead } from "./helpers.ts";
import { PdfEngineError } from "../src/documents/gotenberg.ts";
import { runOutboxOnce } from "../src/outbox.ts";

const ORIGIN = "http://127.0.0.1:5173";
const TEMPLATES = join(import.meta.dirname, "../templates");
const at = (time: string) => `2031-05-06T${time}:00Z`;

describe("documents as PDFs", () => {
  let test: TestApp;
  let owner: pg.Client;
  let documentsDir: string;
  let templatesDir: string;

  beforeAll(async () => {
    await waitForPostgrest();
    owner = await ownerClient();
    documentsDir = mkdtempSync(join(tmpdir(), "salvionix-docs-"));
    templatesDir = mkdtempSync(join(tmpdir(), "salvionix-templates-"));
    cpSync(TEMPLATES, templatesDir, { recursive: true });
    test = createTestApp({ DOCUMENTS_DIR: documentsDir, TEMPLATES_DIR: templatesDir });
  });
  afterAll(async () => {
    await test.close();
    await owner.end();
  });

  const quotedLead = async (options: { isTest?: boolean } = {}): Promise<Lead & { quoteId: number }> => {
    const lead = await createLead(owner, options);
    await owner.query("update public.deals set service_address = '1 Main St, Orlando', service_space_type = 'home' where id = $1", [lead.dealId]);
    return { ...lead, quoteId: await createQuote(owner, lead.dealId) };
  };

  /** A held (or confirmed) appointment for the lead, at a time no other test uses. */
  const appointmentFor = async (lead: Lead, status: "hold" | "confirmed", hour: string): Promise<number> => {
    const hold = await insertHold(owner, lead, await createTechnician(owner), at(hour), at(`${String(Number(hour.slice(0, 2)) + 1).padStart(2, "0")}:00`), {
      holdExpiresAt: "2099-01-01T00:00:00Z",
    });
    if (status === "confirmed") {
      await owner.query("update core.appointments set status = 'confirmed', hold_expires_at = null, confirmed_at = now() where id = $1", [hold.id]);
    } else {
      await setStatus(owner, hold.id, "hold");
    }
    return hold.id;
  };

  const issue = (payload: object) =>
    test.app.inject({
      method: "POST",
      url: "/admin/documents",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const download = (id: number) => test.app.inject({ method: "GET", url: `/admin/documents/${id}/pdf`, headers: { origin: ORIGIN } });
  const send = (id: number) => test.app.inject({ method: "POST", url: `/admin/documents/${id}/send`, headers: { origin: ORIGIN } });
  const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

  const openConversation = async (lead: Lead, isTest: boolean): Promise<number> => {
    const identifier = `docs-${randomUUID().slice(0, 8)}`;
    const channel = await owner.query<{ id: number }>(
      `insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
       values (1, 'waha', $1, 'javier', 'WAHA_HMAC_BYTOGAM_PRUEBAS', $2) returning id::int`,
      [identifier, isTest],
    );
    const phone = `+1305555${String(Math.floor(1000 + Math.random() * 8999))}`;
    const identity = await owner.query<{ id: number }>(
      "insert into core.contact_identities (brand_id, type, value) values (1, 'phone_e164', $1) returning id::int",
      [phone],
    );
    const conversation = await owner.query<{ id: number }>(
      "insert into core.conversations (brand_id, channel_id, identity_id, contact_id) values (1, $1, $2, $3) returning id::int",
      [channel.rows[0].id, identity.rows[0].id, lead.contactId],
    );
    return conversation.rows[0].id;
  };

  describe("issuing", () => {
    it("numbers a quote, renders its template and keeps the file under its hash", async () => {
      const lead = await quotedLead();
      const quote = (await owner.query("select total::float as total from core.quotes where id = $1", [lead.quoteId])).rows[0];

      const response = await issue({ deal_id: lead.dealId, document_type: "quote" });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.display_number).toMatch(/^COT-\d{6}$/);
      const pdf = await download(body.id);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect(pdf.headers["cache-control"]).toBe("private, no-store");
      expect(pdf.headers["content-disposition"]).toBe(`inline; filename="${body.display_number}.pdf"`);
      expect(sha256(pdf.rawPayload)).toBe(body.file.sha256);
      expect(body.file.size_bytes).toBe(pdf.rawPayload.length);
      const html = pdf.rawPayload.toString("utf8");
      expect(html).toContain(body.display_number);
      expect(html).toContain(new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" }).format(quote.total));
      expect(html).toContain("1 Main St, Orlando");
      expect(html).toContain("Hogar");
      expect(html).not.toContain("DOCUMENTO DE PRUEBA");
    });

    it("marks the document of a test lead and numbers it in the test series", async () => {
      const lead = await quotedLead({ isTest: true });

      const response = await issue({ deal_id: lead.dealId, document_type: "quote" });

      expect(response.json().display_number).toMatch(/^PRUEBA-COT-\d{6}$/);
      expect((await download(response.json().id)).rawPayload.toString("utf8")).toContain("DOCUMENTO DE PRUEBA");
    });

    it("answers with the same document when asked twice, and renders only once", async () => {
      const lead = await quotedLead();
      const rendersBefore = test.pdfEngine.html.length;

      const first = await issue({ deal_id: lead.dealId, document_type: "quote" });
      const second = await issue({ deal_id: lead.dealId, document_type: "quote" });

      expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
      expect(second.json()).toMatchObject({ id: first.json().id, display_number: first.json().display_number, created: false });
      expect(second.json().file.sha256).toBe(first.json().file.sha256);
      expect(test.pdfEngine.html.length - rendersBefore).toBe(1);
    });

    it("answers 502 when the PDF engine fails, then finishes the job with the same number and no gap", async () => {
      const lead = await quotedLead();
      const next = test.pdfEngine.next;
      test.pdfEngine.next = async () => {
        throw new PdfEngineError("the PDF engine did not answer");
      };
      let failed;
      try {
        failed = await issue({ deal_id: lead.dealId, document_type: "quote" });
      } finally {
        test.pdfEngine.next = next;
      }
      expect(failed.statusCode).toBe(502);
      expect(failed.json()).toEqual({ error: "pdf_engine_unavailable" });
      const issued = (await owner.query("select id::int, display_number, number::int from core.documents where deal_id = $1", [lead.dealId])).rows;
      expect(issued).toHaveLength(1);

      const retry = await issue({ deal_id: lead.dealId, document_type: "quote" });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ id: issued[0].id, display_number: issued[0].display_number });
      const other = await quotedLead();
      const following = await issue({ deal_id: other.dealId, document_type: "quote" });
      expect(Number(following.json().display_number.slice(-6))).toBe(issued[0].number + 1);
    });

    it("refuses an order without an appointment, a quote with one, and a deal that has no quote", async () => {
      const lead = await quotedLead();
      const appointmentId = await appointmentFor(lead, "hold", "09:00");
      const noQuote = await createLead(owner);

      const noAppointment = await issue({ deal_id: lead.dealId, document_type: "purchase_order" });
      const quoteWithAppointment = await issue({ deal_id: lead.dealId, document_type: "quote", appointment_id: appointmentId });
      const withoutQuote = await issue({ deal_id: noQuote.dealId, document_type: "quote" });

      expect(noAppointment.statusCode).toBe(400);
      expect(noAppointment.json()).toEqual({ error: "invalid_input", reason: "appointment_mismatch" });
      expect(quoteWithAppointment.statusCode).toBe(400);
      expect(withoutQuote.statusCode).toBe(409);
      expect(withoutQuote.json()).toEqual({ error: "invalid_state", reason: "no_quote" });
    });

    it("issues the purchase order for a held appointment and the work order only once it is confirmed", async () => {
      const lead = await quotedLead();
      const appointmentId = await appointmentFor(lead, "hold", "10:00");

      const purchaseOrder = await issue({ deal_id: lead.dealId, document_type: "purchase_order", appointment_id: appointmentId });
      const tooEarly = await issue({ deal_id: lead.dealId, document_type: "work_order", appointment_id: appointmentId });
      await owner.query("update core.appointments set status = 'confirmed', hold_expires_at = null, confirmed_at = now() where id = $1", [appointmentId]);
      const workOrder = await issue({ deal_id: lead.dealId, document_type: "work_order", appointment_id: appointmentId });

      expect(purchaseOrder.statusCode).toBe(201);
      expect(purchaseOrder.json().display_number).toMatch(/^OC-\d{6}$/);
      expect(tooEarly.statusCode).toBe(409);
      expect(tooEarly.json()).toMatchObject({ error: "invalid_state" });
      expect(workOrder.json().display_number).toMatch(/^OT-\d{6}$/);
      const html = (await download(workOrder.json().id)).rawPayload.toString("utf8");
      expect(html).toContain("Test Technician");
      expect(html).toContain("1 Main St, Orlando");
    });

    it("rejects a request with a field it does not know", async () => {
      const lead = await quotedLead();
      const response = await issue({ deal_id: lead.dealId, document_type: "quote", total: 1 });
      expect(response.statusCode).toBe(400);
    });

    it("stops with a clear error when a template uses a field that does not exist", async () => {
      const lead = await quotedLead();
      const original = readFileSync(join(templatesDir, "quote.html"), "utf8");
      writeFileSync(join(templatesDir, "quote.html"), original.replace("{{customer.name}}", "{{customer.nmae}}"));
      try {
        const response = await issue({ deal_id: lead.dealId, document_type: "quote" });
        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: "template_invalid" });
      } finally {
        writeFileSync(join(templatesDir, "quote.html"), original);
      }
    });
  });

  describe("reading the file back", () => {
    it("refuses a file that was changed on disk", async () => {
      const lead = await quotedLead();
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();
      writeFileSync(join(documentsDir, `${body.file.sha256}.pdf`), "%PDF-1.4 changed");

      const response = await download(body.id);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "stored_file_invalid" });
    });

    it("answers 404 for a document that has no file", async () => {
      expect((await download(2_000_000_000)).statusCode).toBe(404);
    });
  });

  describe("sending", () => {
    it("queues the PDF for the customer's conversation and sends it as a WhatsApp file", async () => {
      const lead = await quotedLead({ isTest: true });
      const conversationId = await openConversation(lead, true);
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();
      test.wahaCalls.length = 0;

      const queued = await send(body.id);
      await runOutboxOnce(test.outboxDeps);

      expect(queued.statusCode).toBe(202);
      expect(test.wahaCalls).toHaveLength(1);
      expect(test.wahaCalls[0].url).toBe("http://waha.test/api/sendFile");
      const sent = JSON.parse(test.wahaCalls[0].body);
      expect(sent.caption).toBe(`Le enviamos su cotización ${body.display_number}.`);
      expect(sent.file).toMatchObject({ mimetype: "application/pdf", filename: `${body.display_number}.pdf` });
      expect(sha256(Buffer.from(sent.file.data, "base64"))).toBe(body.file.sha256);
      const history = await owner.query("select direction, body from core.messages where conversation_id = $1", [conversationId]);
      expect(history.rows).toEqual([{ direction: "out", body: `Le enviamos su cotización ${body.display_number}.` }]);
    });

    it("sends nothing to a real customer while the legal texts are not confirmed", async () => {
      const lead = await quotedLead();
      const conversationId = await openConversation(lead, false);
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();

      const response = await send(body.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "legal_unconfirmed" });
      expect((await owner.query("select count(*)::int as n from core.outbox where conversation_id = $1", [conversationId])).rows[0].n).toBe(0);
    });

    it("sends to a real customer once settings.json says the legal texts are confirmed", async () => {
      const lead = await quotedLead();
      await openConversation(lead, false);
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();
      const settingsFile = join(templatesDir, "settings.json");
      const original = readFileSync(settingsFile, "utf8");
      writeFileSync(settingsFile, original.replace('"confirmed": false', '"confirmed": true'));
      test.wahaCalls.length = 0;
      try {
        expect((await send(body.id)).statusCode).toBe(202);
      } finally {
        writeFileSync(settingsFile, original);
      }
      await runOutboxOnce(test.outboxDeps);
      expect(test.wahaCalls.map((call) => call.url)).toEqual(["http://waha.test/api/sendFile"]);
    });

    it("says there is no conversation to send to", async () => {
      const lead = await quotedLead({ isTest: true });
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();

      const response = await send(body.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "invalid_state", reason: "no_conversation" });
    });

    it("does not send a file that no longer matches its hash, and leaves the message to retry", async () => {
      const lead = await quotedLead({ isTest: true });
      const conversationId = await openConversation(lead, true);
      const body = (await issue({ deal_id: lead.dealId, document_type: "quote" })).json();
      await send(body.id);
      writeFileSync(join(documentsDir, `${body.file.sha256}.pdf`), "%PDF-1.4 changed");
      test.wahaCalls.length = 0;

      await runOutboxOnce(test.outboxDeps);

      expect(test.wahaCalls).toHaveLength(0);
      const row = (await owner.query("select status, attempts::int, last_error from core.outbox where conversation_id = $1", [conversationId])).rows[0];
      expect(row).toEqual({ status: "pending", attempts: 1, last_error: "StoredFileError" });
    });
  });
});
