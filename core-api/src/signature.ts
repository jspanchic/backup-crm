import { createHmac, timingSafeEqual } from "node:crypto";

export const WAHA_TOLERANCE_MS = 5 * 60 * 1000;

export type SignatureResult = { ok: true } | { ok: false; reason: "algorithm" | "signature" | "timestamp" };

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? undefined : value);

/** Constant-time comparison of two hex strings of any length. */
export const safeEqualHex = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * WAHA signs the raw body with HMAC-SHA512 (hex) in X-Webhook-Hmac, and sends the time in
 * milliseconds in X-Webhook-Timestamp. The timestamp is not covered by the signature, so
 * replays are stopped by the duplicate check on the message id, not here.
 * ASSUMPTION until we capture a real delivery: hexadecimal encoding.
 */
export const verifyWahaSignature = (
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  nowMs: number,
): SignatureResult => {
  const algorithm = single(headers["x-webhook-hmac-algorithm"]);
  const signature = single(headers["x-webhook-hmac"]);
  const timestamp = single(headers["x-webhook-timestamp"]);

  if (algorithm?.toLowerCase() !== "sha512") return { ok: false, reason: "algorithm" };
  if (!signature) return { ok: false, reason: "signature" };

  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  if (!safeEqualHex(signature.toLowerCase(), expected)) return { ok: false, reason: "signature" };

  const sentAt = timestamp && /^\d{10,16}$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  if (!Number.isFinite(sentAt) || Math.abs(nowMs - sentAt) > WAHA_TOLERANCE_MS) return { ok: false, reason: "timestamp" };
  return { ok: true };
};

/** core-api to bot: the timestamp is part of what is signed, so a captured request cannot be replayed later. */
export const signBotRequest = (secret: string, timestampSeconds: number, rawBody: string): string =>
  createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex");
