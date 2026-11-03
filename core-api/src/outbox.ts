import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { readStoredFile } from "./documents/store.ts";

export type OutboxFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export type OutboxDeps = {
  config: Config;
  db: Db;
  fetch: OutboxFetch;
  log: FastifyBaseLogger;
  /** Injected so tests do not wait; production waits 2 to 5 seconds between messages. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
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
};

const paceMs = (deps: OutboxDeps): number => {
  const { OUTBOX_PACE_MIN_MS: min, OUTBOX_PACE_MAX_MS: max } = deps.config;
  return Math.round(min + deps.random() * Math.max(max - min, 0));
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

/**
 * Sends what is due, one message at a time, with a pause between sends so WhatsApp does not see a burst.
 * Nothing leaves the system any other way: not the bot, not n8n.
 */
export const runOutboxOnce = async (deps: OutboxDeps, limit = 10): Promise<{ sent: number; failed: number }> => {
  const { rows } = await deps.db.query<Claimed>("select * from api.claim_outbox($1)", [limit]);
  let sent = 0;
  let failed = 0;

  for (const [index, item] of rows.entries()) {
    if (index > 0) await deps.sleep(paceMs(deps));
    let error: string | null = null;
    try {
      const response = await deps.fetch(`${deps.config.WAHA_BASE_URL}/api/${item.file_sha256 ? "sendFile" : "sendText"}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(deps.config.WAHA_API_KEY ? { "X-Api-Key": deps.config.WAHA_API_KEY } : {}),
        },
        body: JSON.stringify(await payloadOf(deps, item)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) error = `WAHA answered ${response.status}`;
    } catch (cause) {
      error = (cause as Error).name;
    }
    await deps.db.query("select api.finish_outbox($1, $2, $3)", [item.id, error === null, error]);
    if (error === null) sent++;
    else {
      failed++;
      deps.log.warn({ outboxId: item.id, attempt: item.attempts }, "outbox send failed");
    }
  }
  return { sent, failed };
};
