import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { RenderPdf } from "./gotenberg.ts";
import { readStoredFile, saveFile } from "./store.ts";
import { renderTemplate } from "./template.ts";
import { buildView, captionFor, type DocumentType, type RenderData, type Settings } from "./view.ts";

export const DEFAULT_TEMPLATES_DIR = join(import.meta.dirname, "../../templates");

const templatesDirOf = (config: Config): string => config.TEMPLATES_DIR ?? DEFAULT_TEMPLATES_DIR;

export type DocumentsDeps = {
  config: Config;
  db: Db;
  renderPdf: RenderPdf;
};

export type StoredDocument = {
  id: number;
  displayNumber: string;
  documentType: DocumentType;
  created: boolean;
  file: { id: number; sha256: string; sizeBytes: number };
};

/** A refusal the route can explain, as opposed to a bug. */
export class DocumentError extends Error {
  code: "no_file" | "legal_unconfirmed";

  constructor(code: "no_file" | "legal_unconfirmed", message: string) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
  }
}

type FileRow = { id: number; sha256: string; size_bytes: number; is_test: boolean; document_type: DocumentType; display_number: string };

/** Templates and settings are read on every use: editing a file takes effect without restarting anything. */
const readSettings = async (dir: string): Promise<Settings> => JSON.parse(await readFile(join(dir, "settings.json"), "utf8")) as Settings;

const currentFile = async (db: Db, documentId: number): Promise<FileRow | null> => {
  const { rows } = await db.query<{ result: FileRow | null }>("select api.document_file($1) as result", [documentId]);
  return rows[0].result;
};

const toStored = (file: FileRow, documentId: number, created: boolean): StoredDocument => ({
  id: documentId,
  displayNumber: file.display_number,
  documentType: file.document_type,
  created,
  file: { id: file.id, sha256: file.sha256, sizeBytes: file.size_bytes },
});

/**
 * Issues a document (the database numbers it and freezes its data), renders its template to a PDF and keeps
 * the file. Asking again returns what exists. If the rendering fails, the document stays issued without a file
 * and asking again finishes the job: a number is never lost and never used twice.
 */
export const issueDocument = async (
  deps: DocumentsDeps,
  input: { dealId: number; documentType: DocumentType; appointmentId: number | null },
): Promise<StoredDocument> => {
  const { db, config } = deps;
  const dir = templatesDirOf(config);

  const issued = await db.query<{ result: { id: number; created: boolean } }>("select api.issue_document($1, $2, $3) as result", [
    input.dealId,
    input.documentType,
    input.appointmentId,
  ]);
  const { id, created } = issued.rows[0].result;

  const existing = await currentFile(db, id);
  if (existing) return toStored(existing, id, created);

  const { rows } = await db.query<{ result: RenderData }>("select api.document_render_data($1) as result", [id]);
  const data = rows[0].result;
  const settings = await readSettings(dir);
  const html = renderTemplate(await readFile(join(dir, `${data.document_type}.html`), "utf8"), buildView(data, settings));
  const pdf = await deps.renderPdf(html);

  const saved = await saveFile(config.DOCUMENTS_DIR, pdf);
  await db.query("select api.record_document_file($1, $2, $3, $4, $5)", [
    id,
    data.document_type,
    settings.template_version,
    saved.sha256,
    saved.sizeBytes,
  ]);
  const stored = await currentFile(db, id);
  return toStored(stored!, id, created);
};

/** The bytes of the current file, checked against the hash the database holds. */
export const readDocumentPdf = async (deps: DocumentsDeps, documentId: number): Promise<{ bytes: Buffer; name: string }> => {
  const file = await currentFile(deps.db, documentId);
  if (!file) throw new DocumentError("no_file", "the document has no file");
  return { bytes: await readStoredFile(deps.config.DOCUMENTS_DIR, file.sha256), name: `${file.display_number}.pdf` };
};

/**
 * Queues the file for the customer. A real customer receives nothing until JM confirms the legal texts
 * (`confirmed` in settings.json); test leads can always be sent to.
 */
export const sendDocument = async (deps: DocumentsDeps, documentId: number): Promise<{ outboxId: number }> => {
  const file = await currentFile(deps.db, documentId);
  if (!file) throw new DocumentError("no_file", "the document has no file");
  const settings = await readSettings(templatesDirOf(deps.config));
  if (!file.is_test && !settings.confirmed) {
    throw new DocumentError("legal_unconfirmed", "the legal texts are not confirmed, so real customers do not receive documents yet");
  }
  const caption = captionFor({ document_type: file.document_type, display_number: file.display_number }, settings);
  const { rows } = await deps.db.query<{ id: number }>("select api.enqueue_document($1, $2, $3) as id", [documentId, file.id, caption]);
  return { outboxId: rows[0].id };
};
