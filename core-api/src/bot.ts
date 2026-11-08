import type { FastifyBaseLogger } from "fastify";
import { botUrl } from "./config.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { signBotRequest } from "./signature.ts";
import { signConversationToken } from "./token.ts";

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
  log: FastifyBaseLogger;
  now: () => Date;
};

const BOT_TIMEOUT_MS = 10_000;

/**
 * Builds the context, signs a 15 minute token and calls the bot. Marks the message as dispatched
 * only when the bot answered 2xx, so a failure is retried by the sweeper.
 * The bot gets a masked phone number, never the full one.
 */
export const dispatchToBot = async (deps: BotDeps, messageId: number): Promise<"sent" | "failed" | "skipped"> => {
  const { rows: [{ context, generation }] } = await deps.db.query<{ context: BotContext | null; generation: number | null }>(
    `select case when generation is not null then api.bot_context($1) end as context, generation
     from (select api.bot_dispatch_generation($1) as generation) control`,
    [messageId],
  );
  if (!context || generation === null || context.bot_paused) return "skipped";

  const url = botUrl(deps.env, context.bot);
  if (!url) {
    deps.log.error({ bot: context.bot }, "no URL configured for this bot");
    return "failed";
  }

  // Internal ids stay inside core-api: only the token carries them, signed.
  const { brand_id, message_id, conversation_id, bot_paused: _paused, ...contract } = context;
  const token = await signConversationToken(
    deps.config.CONVERSATION_TOKEN_SECRET,
    { brandId: brand_id, conversationId: conversation_id, botGeneration: generation },
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
    if (!response.ok) {
      deps.log.warn({ status: response.status, messageId: message_id }, "bot rejected the message");
      return "failed";
    }
  } catch (error) {
    deps.log.warn({ err: (error as Error).name, messageId: message_id }, "bot call failed");
    return "failed";
  }
  await deps.db.query("select api.mark_dispatched($1)", [message_id]);
  return "sent";
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
