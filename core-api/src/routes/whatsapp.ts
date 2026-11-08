import type { FastifyInstance } from "fastify";
import { namedSecret } from "../config.ts";
import { dispatchToBot } from "../bot.ts";
import { verifyWahaSignature } from "../signature.ts";
import { parseDelivery, peekSession, toAccepted } from "../waha.ts";
import type { AppDeps } from "../app.ts";
import { resolveWahaLid } from "../waha-client.ts";

type ResolvedChannel = { channel_id: number; secret_ref: string; bot_key: string; is_test: boolean };
type Ingested = { status: "duplicate" } | { status: "accepted"; message_id: number; bot_paused: boolean };

/**
 * WAHA calls this with every message of one session. Order matters:
 * channel, signature, validation, then the database. A failure answers a bare status and does nothing.
 */
export const whatsappRoutes = (app: FastifyInstance, deps: AppDeps): void => {
  app.post("/hooks/whatsapp", async (request, reply) => {
    const raw = request.body as Buffer;
    const session = peekSession(raw);
    if (!session) return reply.code(400).send({ error: "invalid_request" });

    const { rows } = await deps.db.query<{ channel: ResolvedChannel | null }>("select api.resolve_channel('waha', $1) as channel", [
      session,
    ]);
    const channel = rows[0].channel;
    if (!channel) {
      // Not verifiable (we have no secret for it): recorded without content, never sent to a bot.
      await deps.db.query("select api.record_unrouted('waha', $1)", [session]);
      return reply.code(200).send({ status: "unrouted" });
    }

    const secret = namedSecret(deps.env, channel.secret_ref);
    if (!secret) {
      request.log.error({ secretRef: channel.secret_ref }, "channel secret is not configured");
      return reply.code(401).send();
    }
    const signature = verifyWahaSignature(raw, request.headers, secret, deps.now().getTime());
    if (!signature.ok) {
      request.log.warn({ reason: signature.reason }, "webhook rejected");
      return reply.code(401).send();
    }

    const delivery = parseDelivery(raw);
    if (!delivery.ok) return reply.code(400).send({ error: "invalid_payload" });

    const accepted = toAccepted(delivery.data, deps.now());
    if (accepted.ignore) return reply.code(200).send({ status: "ignored" });
    const { message } = accepted;

    let phone = message.phone;
    if (!phone && message.lid) {
      phone = await resolveWahaLid(deps.config, deps.wahaFetch, session, message.lid, message.ownPhone);
      if (!phone) {
        const { rows: [{ id }] } = await deps.db.query<{ id: number | null }>(
          "select api.escalate_waha_lid($1, $2, $3) as id", [channel.channel_id, message.providerMessageId, message.chatId],
        );
        if (id === null) return reply.code(200).send({ status: "duplicate" });
        request.log.warn({ escalationId: id, channelId: channel.channel_id }, "unresolved WAHA LID escalated");
        return reply.code(200).send({ status: "escalated" });
      }
    }

    if (message.resetRequested && phone) {
      const { rows: [{ status }] } = await deps.db.query<{ status: "reset" | "duplicate" | "protected" | "not_authorized" }>(
        "select api.try_team_reset($1, $2, $3, $4) as status", [session, message.providerMessageId, phone, message.chatId],
      );
      if (status !== "not_authorized") return reply.code(200).send({ status });
    }

    const ingested = await deps.db.query<{ result: Ingested }>("select api.ingest_inbound($1, $2, $3, $4, $5, $6, $7, $8, $9) as result", [
      "waha",
      session,
      message.providerMessageId,
      message.sentAt,
      message.body,
      phone,
      null,
      message.pushName,
      message.chatId,
    ]);
    const result = ingested.rows[0].result;
    if (result.status === "duplicate") return reply.code(200).send({ status: "duplicate" });

    // Answer first: providers retry slow webhooks, and Claude can take longer than their timeout.
    await reply.code(200).send({ status: "accepted" });
    if (!result.bot_paused) {
      deps.track(
        dispatchToBot(deps, result.message_id).catch((error: Error) => {
          request.log.error({ err: error.name }, "dispatch failed");
        }),
      );
    }
    return reply;
  });
};
