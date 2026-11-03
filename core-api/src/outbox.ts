import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";

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

type Claimed = { id: number; session: string; destination: string; body: string; attempts: number };

const paceMs = (deps: OutboxDeps): number => {
  const { OUTBOX_PACE_MIN_MS: min, OUTBOX_PACE_MAX_MS: max } = deps.config;
  return Math.round(min + deps.random() * Math.max(max - min, 0));
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
      const response = await deps.fetch(`${deps.config.WAHA_BASE_URL}/api/sendText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(deps.config.WAHA_API_KEY ? { "X-Api-Key": deps.config.WAHA_API_KEY } : {}),
        },
        body: JSON.stringify({ session: item.session, chatId: item.destination, text: item.body }),
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
