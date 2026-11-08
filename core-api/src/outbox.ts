import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { readStoredFile, StoredFileError } from "./documents/store.ts";
import { postWaha, type WahaFetch } from "./waha-client.ts";

export type OutboxDeps = {
  config: Config;
  db: Db;
  fetch: WahaFetch;
  log: FastifyBaseLogger;
  /** Injected so tests can verify the channel's wait without sleeping. */
  sleep: (ms: number) => Promise<void>;
};

type Claimed = {
  id: number;
  session: string;
  destination: string;
  body: string;
  attempts: number;
  document_file_id: number | null;
  file_sha256: string | null;
  file_name: string | null;
  waha_before_send_ms: number;
};

type Outcome = "sent" | "retry" | "uncertain" | "failed" | "throttled" | "stale";

const notConnected = (error: unknown): boolean => {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(cause?.code ?? "");
};

/** The WAHA body of one message. A file is read from the private folder and checked against its hash first. */
const payloadOf = async (deps: OutboxDeps, item: Claimed): Promise<Record<string, unknown>> => {
  if (!item.file_sha256) return { session: item.session, chatId: item.destination, text: item.body };
  const bytes = await readStoredFile(deps.config.DOCUMENTS_DIR, item.file_sha256);
  return {
    session: item.session,
    chatId: item.destination,
    caption: item.body,
    file: { mimetype: "application/pdf", filename: item.file_name, data: bytes.toString("base64") },
  };
};

/** The database leases one job across workers and fences the actual POST before it can leave this process. */
export const runOutboxOnce = async (deps: OutboxDeps, limit = 10): Promise<{ sent: number; failed: number }> => {
  if (!deps.config.WAHA_SEND_ENABLED) return { sent: 0, failed: 0 };
  const { rows: [item] } = await deps.db.query<Claimed>("select * from api.claim_outbox($1)", [limit]);
  if (!item) return { sent: 0, failed: 0 };

  let outcome: Outcome = "stale";
  let error: string | null = null;
  let startedSend = false;
  try {
    const { rows: [control] } = await deps.db.query<{ sendable: boolean }>(
      "select api.outbox_sendable($1, $2) as sendable", [item.id, item.attempts],
    );
    if (control.sendable) {
      const payload = await payloadOf(deps, item);
      await deps.sleep(item.waha_before_send_ms);
      const { rows: [{ decision }] } = await deps.db.query<{ decision: "send" | "throttled" | "stale" }>(
        "select api.begin_outbox_send($1, $2) as decision", [item.id, item.attempts],
      );
      outcome = decision === "send" ? "uncertain" : decision;
      if (decision === "send") {
        startedSend = true;
        const response = await postWaha(deps.config, deps.fetch, item.file_sha256 ? "sendFile" : "sendText", payload, 15_000);
        if (response.ok) outcome = "sent";
        else {
          error = `WAHA send HTTP ${response.status}`;
          if (response.status === 429) outcome = "retry";
          else if (response.status >= 400 && response.status < 500 && response.status !== 408) outcome = "failed";
        }
      }
    }
  } catch (cause) {
    outcome = startedSend && !notConnected(cause) ? "uncertain" : "retry";
    error = startedSend ? "WAHA send response unconfirmed" : cause instanceof StoredFileError ? cause.name : "WAHA preparation failed";
  } finally {
    if (startedSend && !item.file_sha256) {
      // Presence cleanup never changes a delivery result or causes a second POST.
      try {
        const response = await postWaha(deps.config, deps.fetch, "stopTyping", { session: item.session, chatId: item.destination }, 5_000);
        if (!response.ok) deps.log.warn({ outboxId: item.id, status: response.status }, "outbox stop typing failed");
      } catch {
        deps.log.warn({ outboxId: item.id }, "outbox stop typing failed");
      }
    }
  }
  await deps.db.query("select api.finish_paced_outbox($1, $2, $3, $4)", [item.id, item.attempts, outcome, error]);
  if (outcome === "sent") return { sent: 1, failed: 0 };
  if (outcome === "stale" || outcome === "throttled") return { sent: 0, failed: 0 };
  deps.log.warn({ outboxId: item.id, attempt: item.attempts, outcome }, "outbox send failed");
  return { sent: 0, failed: 1 };
};
