import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { DocumentError, issueDocument, listDocuments, readDocumentPdf, sendDocument } from "../documents/service.ts";
import { PdfEngineError } from "../documents/gotenberg.ts";
import { StoredFileError } from "../documents/store.ts";
import { TemplateError } from "../documents/template.ts";
import { DOCUMENT_TYPES } from "../documents/view.ts";
import { refusal } from "./admin-agenda.ts";

/**
 * Quotes, purchase orders and work orders as PDFs. The database numbers and freezes each document; this
 * renders it, keeps the file and, when asked, queues it for the customer. Same wall as the rest of /admin:
 * only with a development identity, never in production, until Access arrives (CRM-T3).
 */

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ISSUE = z.strictObject({
  deal_id: id,
  document_type: z.enum(DOCUMENT_TYPES as [string, ...string[]]),
  appointment_id: id.nullish(),
});
const PARAM = z.strictObject({ id });
const LIST = z.strictObject({ deal_id: id });

export const adminDocuments = (app: FastifyInstance, deps: AppDeps, cors: (request: FastifyRequest, reply: FastifyReply) => void): void => {
  for (const url of ["/admin/documents", "/admin/documents/*"]) {
    app.options(url, async (request, reply) => {
      cors(request, reply);
      reply.header("Access-Control-Allow-Methods", "GET, POST");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      reply.header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    });
  }

  /** Refusals the caller can act on get a code; anything else is a bug and falls through to the 500 handler. */
  const explain = (error: unknown, reply: FastifyReply, request: FastifyRequest) => {
    const answer = refusal(error);
    if (answer) return reply.code(answer.status).send(answer.body);
    if (error instanceof DocumentError) return reply.code(error.code === "no_file" ? 404 : 409).send({ error: error.code });
    if (error instanceof PdfEngineError) {
      request.log.error({ err: error.name }, "pdf engine failed");
      return reply.code(502).send({ error: "pdf_engine_unavailable" });
    }
    if (error instanceof TemplateError || error instanceof StoredFileError) {
      request.log.error({ err: error.name, message: error.message }, "document template or file problem");
      return reply.code(500).send({ error: error instanceof TemplateError ? "template_invalid" : "stored_file_invalid" });
    }
    throw error;
  };

  const guard = (request: FastifyRequest, reply: FastifyReply): boolean => {
    cors(request, reply);
    if (deps.config.ADMIN_DEV_SUB) return true;
    void reply.code(401).send({ error: "unauthorized" });
    return false;
  };

  app.post("/admin/documents", { bodyLimit: 4_096 }, async (request, reply) => {
    if (!guard(request, reply)) return reply;
    let raw: unknown;
    try {
      const buffer = request.body as Buffer | undefined;
      raw = buffer && buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
    } catch {
      raw = undefined;
    }
    const parsed = ISSUE.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input", reason: "bad_request" });
    try {
      const document = await issueDocument(deps, {
        dealId: parsed.data.deal_id,
        documentType: parsed.data.document_type as (typeof DOCUMENT_TYPES)[number],
        appointmentId: parsed.data.appointment_id ?? null,
      });
      return reply.code(document.created ? 201 : 200).send({
        id: document.id,
        display_number: document.displayNumber,
        document_type: document.documentType,
        created: document.created,
        file: { id: document.file.id, sha256: document.file.sha256, size_bytes: document.file.sizeBytes },
      });
    } catch (error) {
      return explain(error, reply, request);
    }
  });

  app.get("/admin/documents", async (request, reply) => {
    if (!guard(request, reply)) return reply;
    const query = LIST.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_input", reason: "bad_request" });
    try {
      return reply.code(200).header("Cache-Control", "private, no-store").send(await listDocuments(deps, query.data.deal_id));
    } catch (error) {
      return explain(error, reply, request);
    }
  });

  app.get("/admin/documents/:id/pdf", async (request, reply) => {
    if (!guard(request, reply)) return reply;
    const params = PARAM.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_input", reason: "bad_request" });
    try {
      const { bytes, name } = await readDocumentPdf(deps, params.data.id);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `inline; filename="${name}"`)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    } catch (error) {
      return explain(error, reply, request);
    }
  });

  app.post("/admin/documents/:id/send", { bodyLimit: 1_024 }, async (request, reply) => {
    if (!guard(request, reply)) return reply;
    const params = PARAM.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_input", reason: "bad_request" });
    try {
      const { outboxId } = await sendDocument(deps, params.data.id);
      return reply.code(202).send({ outbox_id: outboxId });
    } catch (error) {
      return explain(error, reply, request);
    }
  });
};
