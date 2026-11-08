import { z } from "zod";
import { toE164 } from "./phone.ts";
import { redactCards } from "./redact.ts";

// Fields taken from the Router of the TEST workflow and from the WAHA documentation.
// ASSUMPTION until we capture a real delivery: the format of payload.id.
const envelope = z.object({
  event: z.string().max(40).optional(),
  session: z.string().min(1).max(100),
  payload: z.object({
    id: z.string().min(1).max(300),
    timestamp: z.number().optional(),
    from: z.string().max(200).optional(),
    fromMe: z.union([z.boolean(), z.string()]).optional(),
    participant: z.string().max(200).optional(),
    body: z.string().max(10_000).nullish(),
    hasMedia: z.boolean().optional(),
    media: z.object({}).nullish(),
    type: z.string().optional(),
    notifyName: z.string().max(200).optional(),
    _data: z
      .object({
        Info: z
          .object({
            Sender: z.string().max(200).optional(),
            SenderAlt: z.string().max(200).optional(),
            PushName: z.string().max(200).optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  }),
});

export type WahaDelivery = z.infer<typeof envelope>;

export const parseDelivery = (raw: Buffer): { ok: true; data: WahaDelivery } | { ok: false } => {
  try {
    const parsed = envelope.safeParse(JSON.parse(raw.toString("utf8")));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
};

/** Session name only, read before the signature check to find the channel secret. Nothing else is trusted. */
export const peekSession = (raw: Buffer): string | null => {
  try {
    const body = JSON.parse(raw.toString("utf8")) as { session?: unknown };
    return typeof body.session === "string" && body.session.length > 0 && body.session.length <= 100 ? body.session : null;
  } catch {
    return null;
  }
};

const isOwnOrForeign = (delivery: WahaDelivery): boolean => {
  const { from, fromMe } = delivery.payload;
  if (!from) return true;
  if (/@(broadcast|newsletter|g\.us)/.test(from) || from.startsWith("status")) return true;
  if (fromMe === true || fromMe === "true") return true;
  return false;
};

const chatPart = (value: string): string => value.split("@")[0].split(":")[0];
const mediaTypes = new Set(["audio", "ptt", "voice", "image", "video", "document", "sticker"]);

export type Accepted = {
  providerMessageId: string;
  chatId: string;
  sentAt: Date;
  body: string;
  phone: string | null;
  lid: string | null;
  pushName: string | null;
};

/** What the Router did, kept in one place: ignore other people's chats, find the real number, never use an @lid as a phone. */
export const toAccepted = (delivery: WahaDelivery, now: Date): { ignore: true } | { ignore: false; message: Accepted } => {
  if (delivery.event && delivery.event !== "message") return { ignore: true };
  if (isOwnOrForeign(delivery)) return { ignore: true };

  const { payload } = delivery;
  const info = payload._data?.Info ?? {};
  const candidates = [info.SenderAlt, info.Sender, payload.participant, payload.from]
    .filter((value): value is string => Boolean(value) && !value!.includes("@lid"))
    .map((value) => chatPart(value));

  let phone: string | null = null;
  for (const candidate of candidates) {
    phone = toE164(candidate);
    if (phone) break;
  }
  const sender = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/.exec(payload.from ?? "");
  const lid = sender?.[2] === "lid" ? `${sender[1]}@lid` : null;
  if (!phone && !lid) return { ignore: true };
  const chatId = lid ?? `${sender?.[1] ?? phone!.slice(1)}@c.us`;

  const text = (payload.body ?? "").trim();
  if (!text && !payload.hasMedia && !payload.media && !mediaTypes.has(payload.type ?? "")) return { ignore: true };

  const seconds = payload.timestamp;
  const sentAt = seconds && seconds > 1_000_000_000 && seconds < 100_000_000_000 ? new Date(seconds * 1000) : now;

  return {
    ignore: false,
    message: {
      providerMessageId: payload.id,
      chatId,
      sentAt,
      body: text ? redactCards(text) : "[El cliente envió un audio o archivo sin texto]",
      phone,
      lid: phone ? null : lid,
      pushName: info.PushName ?? payload.notifyName ?? null,
    },
  };
};
