import type { FastifyBaseLogger } from "fastify";
import { setTimeout as sleep } from "node:timers/promises";
import { botUrl } from "./config.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { signBotRequest } from "./signature.ts";
import { signConversationToken } from "./token.ts";
import { postWaha, type WahaFetch } from "./waha-client.ts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

type BotContext = {
  message_id: number;
  conversation_id: number;
  brand_id: number;
  bot_paused: boolean;
  tenant: string;
  bot: string;
} & Record<string, unknown>;

export type BotDeps = {
  config: Config;
  env: NodeJS.ProcessEnv;
  db: Db;
  fetch: FetchLike;
  wahaFetch: WahaFetch;
  presenceSleep?: (ms: number) => Promise<void>;
  log: FastifyBaseLogger;
  now: () => Date;
};

const BOT_TIMEOUT_MS = 10_000;

type WahaDispatch = {
  session: string;
  chatId: string;
  providerMessageId: string | null;
  beforeSeenMs: number;
  beforeTypingMs: number;
};

const preparePresence = async (deps: BotDeps, delivery: WahaDispatch) => {
  const wait = deps.presenceSleep ?? sleep;
  const chat = { session: delivery.session, chatId: delivery.chatId };
  const bestEffort = async (operation: "sendSeen" | "startTyping", body: Record<string, unknown>) => {
    try {
      const response = await postWaha(deps.config, deps.wahaFetch, operation, body, 5_000);
      if (!response.ok) deps.log.warn({ operation, status: response.status }, "inbound WAHA presence failed");
    } catch {
      deps.log.warn({ operation }, "inbound WAHA presence failed");
    }
  };
  await wait(delivery.beforeSeenMs);
  await bestEffort("sendSeen", delivery.providerMessageId ? { ...chat, messageIds: [delivery.providerMessageId] } : chat);
  await wait(delivery.beforeTypingMs);
  await bestEffort("startTyping", chat);
};

/**
 * Builds the context, signs a 15 minute token and calls the bot. Marks the message as dispatched
 * only when the bot answered 2xx, so a failure is retried by the sweeper.
 * The bot gets a masked phone number, never the full one.
 */
export const dispatchToBot = async (deps: BotDeps, messageId: number): Promise<"sent" | "failed" | "skipped"> => {
  const { rows: [{ claim }] } = await deps.db.query<{ claim: string | null }>(
    "select api.claim_bot_dispatch($1) as claim", [messageId],
  );
  if (!claim) return "skipped";
  let dispatched = false;

  try {
    const { rows: [{ context, generation, delivery }] } = await deps.db.query<{
      context: BotContext | null; generation: number | null; delivery: WahaDispatch | null;
    }>(
      `select case when generation is not null then api.bot_context($1) end as context, generation,
              case when $3 and generation is not null then api.bot_dispatch_waha($1) end as delivery
       from (select api.bot_dispatch_generation($1, $2) as generation) control`,
      [messageId, claim, deps.config.WAHA_SEND_ENABLED],
    );
    if (!context || generation === null || context.bot_paused) return "skipped";

    const url = botUrl(deps.env, context.bot);
    if (!url) {
      deps.log.error({ bot: context.bot }, "no URL configured for this bot");
      return "failed";
    }

    if (delivery?.chatId) {
      await preparePresence(deps, delivery);
      const { rows: [current] } = await deps.db.query<{ generation: number | null }>(
        "select api.bot_dispatch_generation($1, $2) as generation", [messageId, claim],
      );
      if (current.generation !== generation) return "skipped";
    }

    // The WAHA coordinates are separate from the signed n8n payload.
    const { brand_id, message_id, conversation_id, bot_paused: _paused, ...contract } = context;
    const token = await signConversationToken(
      deps.config.CONVERSATION_TOKEN_SECRET,
      { brandId: brand_id, conversationId: conversation_id, botGeneration: generation, inboundMessageId: message_id },
      deps.now(),
    );
    const body = JSON.stringify({ token, ...contract });
    const timestamp = Math.floor(deps.now().getTime() / 1000);
    try {
      const response = await deps.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Core-Signature": signBotRequest(deps.config.BOT_HMAC_SECRET, timestamp, body),
          "X-Core-Timestamp": String(timestamp),
        },
        body,
        signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
      });
      dispatched = response.ok;
      if (!dispatched) deps.log.warn({ status: response.status, messageId }, "bot rejected the message");
    } catch (error) {
      deps.log.warn({ err: (error as Error).name, messageId }, "bot call failed");
    }
    return dispatched ? "sent" : "failed";
  } finally {
    await deps.db.query("select api.finish_bot_dispatch($1, $2, $3)", [messageId, claim, dispatched]);
  }
};

/** Messages the bot never accepted (it was down, or core-api restarted): try again. */
export const sweepPendingDispatches = async (deps: BotDeps, olderThanSeconds = 30, limit = 20): Promise<number> => {
  const { rows } = await deps.db.query<{ message_id: number }>("select message_id::int from api.pending_dispatches($1, $2)", [
    olderThanSeconds,
    limit,
  ]);
  let sent = 0;
  for (const { message_id } of rows) {
    if ((await dispatchToBot(deps, message_id)) === "sent") sent++;
  }
  return sent;
};
