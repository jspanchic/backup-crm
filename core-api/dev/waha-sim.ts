import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A stand-in for WAHA, for the demo and the tests. It does the two things WAHA does with core-api:
 *  - sends signed webhooks for incoming messages (the envelope of the WAHA documentation), and
 *  - handles presence POSTs and keeps the text and files core-api sends out.
 * ASSUMPTION until we capture a real delivery: the format of payload.id, the hexadecimal encoding of the
 * signature and the unit of payload.timestamp. It is NOT a copy of real traffic.
 */

export type SimConfig = {
  coreApiUrl: string;
  session: string;
  /** The HMAC key of the channel: the value of the variable named in core.channels.secret_ref. */
  hmacSecret: string;
  now?: () => Date;
};

export type Inbound = {
  /** Digits with the country code, no "+": 12025550123 */
  phone: string;
  text: string;
  /** The name WhatsApp shows for the contact. */
  pushName?: string;
  /** Reuse an id to send the same message twice. */
  id?: string;
  /** When the customer wrote it. Defaults to now. */
  sentAt?: Date;
  /** Chat id, when it is not the phone: a group, a status, a @lid. */
  from?: string;
  fromMe?: boolean;
  event?: string;
};

export type Sent = { status: number; body: unknown; id: string };

/**
 * A fictional number, never in the 202 area code: the test helpers draw their numbers from 202, and the
 * database of a test run is shared, so the two must not be able to meet. Unique within the process.
 */
const used = new Set<string>();
export const fakePhone = (): string => {
  for (;;) {
    const phone = `1${[305, 407, 415, 512, 617, 702, 713, 808][randomInt(0, 8)]}555${randomInt(1000, 9999)}`;
    if (!used.has(phone)) {
      used.add(phone);
      return phone;
    }
  }
};

export const newMessageId = (from: string, fromMe = false): string => `${fromMe}_${from}_${randomBytes(16).toString("hex").toUpperCase()}`;

export const buildDelivery = (config: SimConfig, message: Inbound): Record<string, unknown> => {
  const from = message.from ?? `${message.phone}@c.us`;
  const now = config.now?.() ?? new Date();
  return {
    event: message.event ?? "message",
    session: config.session,
    engine: "WEBJS",
    payload: {
      id: message.id ?? newMessageId(from, message.fromMe ?? false),
      timestamp: Math.floor((message.sentAt ?? now).getTime() / 1000),
      from,
      fromMe: message.fromMe ?? false,
      body: message.text,
      hasMedia: false,
      _data: { Info: { PushName: message.pushName } },
    },
  };
};

/** HMAC-SHA512 over the exact bytes sent, in hexadecimal, as WAHA does. */
export const signedHeaders = (raw: string, secret: string, now: Date): Record<string, string> => ({
  "content-type": "application/json",
  "x-webhook-hmac": createHmac("sha512", secret).update(raw).digest("hex"),
  "x-webhook-hmac-algorithm": "sha512",
  "x-webhook-timestamp": String(now.getTime()),
  "x-webhook-request-id": randomBytes(8).toString("hex"),
});

export const sendInbound = async (config: SimConfig, message: Inbound): Promise<Sent> => {
  const delivery = buildDelivery(config, message);
  const raw = JSON.stringify(delivery);
  const response = await fetch(`${config.coreApiUrl}/hooks/whatsapp`, {
    method: "POST",
    headers: signedHeaders(raw, config.hmacSecret, config.now?.() ?? new Date()),
    body: raw,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A bare 401 has no body.
  }
  return { status: response.status, body, id: (delivery.payload as { id: string }).id };
};

/** The same delivery again, as WAHA does when it retries. Returns both answers. */
export const sendTwice = async (config: SimConfig, message: Inbound): Promise<[Sent, Sent]> => {
  const id = message.id ?? newMessageId(message.from ?? `${message.phone}@c.us`);
  const first = await sendInbound(config, { ...message, id });
  const second = await sendInbound(config, { ...message, id });
  return [first, second];
};

/** A file arrives with its caption in `text`, so the tests read both kinds of message the same way. */
export type OutboundFile = { filename: string; mimetype: string; bytes: Buffer };
export type OutboundMessage = { session: string; chatId: string; text: string; at: Date; file?: OutboundFile };

export type WahaServer = {
  url: string;
  sent: OutboundMessage[];
  /** What was sent to one chat, in order. */
  to: (phone: string) => OutboundMessage[];
  /** Resolves when `count` messages in total were sent to the chat, or fails after `timeoutMs`. */
  waitFor: (phone: string, count: number, timeoutMs?: number) => Promise<OutboundMessage[]>;
  close: () => Promise<void>;
};

const presenceRoutes = new Set(["/api/sendSeen", "/api/startTyping", "/api/stopTyping"]);

export const startWahaServer = async (options: { port: number; apiKey?: string; host?: string }): Promise<WahaServer> => {
  const sent: OutboundMessage[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const route = request.url ?? "";
      if (request.method !== "POST" || (!presenceRoutes.has(route) && route !== "/api/sendText" && route !== "/api/sendFile")) {
        return reply(404, { error: "not found" });
      }
      if (options.apiKey && request.headers["x-api-key"] !== options.apiKey) return reply(401, { error: "bad api key" });
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          session?: unknown;
          chatId?: unknown;
          text?: string;
          caption?: string;
          file?: { mimetype?: string; filename?: string; data?: string };
          messageIds?: unknown;
        } | null;
        const { session, chatId, text, messageIds } = body ?? {};
        if (typeof session !== "string" || !session || typeof chatId !== "string" || !chatId) {
          return reply(422, { error: "invalid body" });
        }
        if (presenceRoutes.has(route)) {
          if (route === "/api/sendSeen" && messageIds !== undefined &&
              (!Array.isArray(messageIds) || !messageIds.every((id) => typeof id === "string" && id.length > 0))) {
            return reply(422, { error: "invalid body" });
          }
          return reply(201, {});
        }
        if (route === "/api/sendFile") {
          const file = body?.file;
          if (!file?.filename || !file.mimetype || !file.data) return reply(422, { error: "invalid body" });
          sent.push({
            session,
            chatId,
            text: body?.caption ?? "",
            at: new Date(),
            file: { filename: file.filename, mimetype: file.mimetype, bytes: Buffer.from(file.data, "base64") },
          });
          return reply(201, { id: `true_${chatId}_${randomBytes(8).toString("hex").toUpperCase()}` });
        }
        if (typeof text !== "string") return reply(422, { error: "invalid body" });
        sent.push({ session, chatId, text, at: new Date() });
        return reply(201, { id: `true_${chatId}_${randomBytes(8).toString("hex").toUpperCase()}` });
      } catch {
        return reply(400, { error: "invalid json" });
      }
    });
  });
  await new Promise<void>((done) => server.listen(options.port, options.host ?? "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;

  const to = (phone: string) => sent.filter((message) => message.chatId === `${phone}@c.us`);
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    sent,
    to,
    waitFor: async (phone, count, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (to(phone).length < count) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for message ${count} to ${phone} (got ${to(phone).length})`);
        await new Promise((done) => setTimeout(done, 50));
      }
      return to(phone);
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
};
