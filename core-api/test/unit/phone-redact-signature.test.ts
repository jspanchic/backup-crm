import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toE164 } from "../../src/phone.ts";
import { CARD_PLACEHOLDER, redactCards } from "../../src/redact.ts";
import { signBotRequest, verifyWahaSignature, WAHA_TOLERANCE_MS } from "../../src/signature.ts";
import { parseDelivery, toAccepted } from "../../src/waha.ts";

describe("phone numbers", () => {
  it.each([
    ["12025550123", "+12025550123"],
    ["593991119218", "+593991119218"],
    ["+1 (202) 555-0123", "+12025550123"],
    ["5491155550123", "+5491155550123"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["", "123", "abc", "1234567", "9999999999999999"])("rejects %j", (input) => {
    expect(toE164(input)).toBeNull();
  });
});

describe("card redaction", () => {
  it.each([
    ["4111111111111111", "Visa test number"],
    ["4111 1111 1111 1111", "grouped with spaces"],
    ["4111-1111-1111-1111", "grouped with dashes"],
    ["378282246310005", "15 digits (Amex test number)"],
  ])("redacts %s (%s)", (card) => {
    expect(redactCards(`mi tarjeta es ${card} gracias`)).toBe(`mi tarjeta es ${CARD_PLACEHOLDER} gracias`);
  });

  it.each([
    ["a phone number", "llámame al +1 202 555 0123"],
    ["a 16 digit number that fails Luhn", "pedido 4111111111111112"],
    ["a zip code", "mi zip es 32801"],
    ["a short number", "somos 1234 personas"],
    ["a date", "el 2030-06-01 a las 10"],
  ])("leaves %s alone", (_name, text) => {
    expect(redactCards(text)).toBe(text);
  });

  it("redacts a card in the middle of other numbers, and two cards", () => {
    const text = "dormitorios 3, tarjeta 4111111111111111 o 5500 0000 0000 0004, zip 32801";
    expect(redactCards(text)).toBe(`dormitorios 3, tarjeta ${CARD_PLACEHOLDER} o ${CARD_PLACEHOLDER}, zip 32801`);
  });
});

describe("WAHA signature", () => {
  const secret = "s".repeat(32);
  const now = 1_900_000_000_000;
  const raw = Buffer.from('{"session":"x"}');
  const good = createHmac("sha512", secret).update(raw).digest("hex");
  const headers = (overrides: Record<string, string | string[] | undefined> = {}) => ({
    "x-webhook-hmac": good,
    "x-webhook-hmac-algorithm": "sha512",
    "x-webhook-timestamp": String(now),
    ...overrides,
  });

  it("accepts a valid signature, in either letter case", () => {
    expect(verifyWahaSignature(raw, headers(), secret, now)).toEqual({ ok: true });
    expect(verifyWahaSignature(raw, headers({ "x-webhook-hmac": good.toUpperCase() }), secret, now)).toEqual({ ok: true });
  });

  it.each([
    ["a body changed by one byte", () => verifyWahaSignature(Buffer.from('{"session":"y"}'), headers(), secret, now)],
    ["another secret", () => verifyWahaSignature(raw, headers(), "t".repeat(32), now)],
    ["a missing signature", () => verifyWahaSignature(raw, headers({ "x-webhook-hmac": undefined }), secret, now)],
    ["a truncated signature", () => verifyWahaSignature(raw, headers({ "x-webhook-hmac": good.slice(0, 64) }), secret, now)],
    ["a repeated header", () => verifyWahaSignature(raw, headers({ "x-webhook-hmac": [good, good] }), secret, now)],
  ])("rejects %s", (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: "signature" });
  });

  it.each(["sha256", "SHA1", ""])("rejects the algorithm %j", (algorithm) => {
    expect(verifyWahaSignature(raw, headers({ "x-webhook-hmac-algorithm": algorithm }), secret, now)).toMatchObject({
      ok: false,
      reason: "algorithm",
    });
  });

  it("rejects a signature made with sha256 even when the header claims sha512", () => {
    const weak = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyWahaSignature(raw, headers({ "x-webhook-hmac": weak }), secret, now)).toMatchObject({ ok: false });
  });

  it("rejects timestamps more than 5 minutes away, in either direction, and in seconds", () => {
    const check = (timestamp: string | undefined) =>
      verifyWahaSignature(raw, headers({ "x-webhook-timestamp": timestamp }), secret, now);
    expect(check(String(now - WAHA_TOLERANCE_MS))).toEqual({ ok: true });
    expect(check(String(now - WAHA_TOLERANCE_MS - 1))).toMatchObject({ reason: "timestamp" });
    expect(check(String(now + WAHA_TOLERANCE_MS + 1))).toMatchObject({ reason: "timestamp" });
    expect(check(String(Math.floor(now / 1000)))).toMatchObject({ reason: "timestamp" });
    expect(check("not-a-number")).toMatchObject({ reason: "timestamp" });
    expect(check(undefined)).toMatchObject({ reason: "timestamp" });
  });
});

describe("bot request signature", () => {
  it("binds the timestamp, so the same body cannot be replayed at another time", () => {
    const secret = "k".repeat(32);
    expect(signBotRequest(secret, 100, "{}")).not.toBe(signBotRequest(secret, 101, "{}"));
    expect(signBotRequest(secret, 100, "{}")).toBe(createHmac("sha256", secret).update("100.{}").digest("hex"));
  });
});

describe("reading a delivery", () => {
  const now = new Date("2030-06-01T12:00:00Z");
  const read = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const parsed = parseDelivery(Buffer.from(JSON.stringify({ session: "s", payload: { id: "x", body: "hi", ...payload }, ...extra })));
    if (!parsed.ok) throw new Error("did not parse");
    return toAccepted(parsed.data, now);
  };

  it.each([
    ["@c.us", { from: "12025550123@c.us" }, "+12025550123"],
    ["@s.whatsapp.net", { from: "12025550123@s.whatsapp.net" }, "+12025550123"],
    ["a device suffix", { from: "12025550123:12@s.whatsapp.net" }, "+12025550123"],
    ["a number in SenderAlt while from is a lid", { from: "99887766@lid", _data: { Info: { SenderAlt: "12025550123@s.whatsapp.net" } } }, "+12025550123"],
    ["a plain digits SenderAlt", { from: "99887766@lid", _data: { Info: { SenderAlt: "12025550123" } } }, "+12025550123"],
  ])("finds the phone in %s", (_name, payload, phone) => {
    expect(read(payload)).toMatchObject({ ignore: false, message: { phone } });
  });

  it("keeps a lid as identity when there is no phone, and never treats it as a phone", () => {
    expect(read({ from: "99887766@lid" })).toMatchObject({ ignore: false, message: { phone: null, lid: "99887766@lid" } });
  });

  it.each([
    ["a group", { from: "12025550123-1600000000@g.us" }],
    ["a status", { from: "status@broadcast" }],
    ["a channel", { from: "1203630@newsletter" }],
    ["my own message", { from: "12025550123@c.us", fromMe: true }],
    ["my own message as text", { from: "12025550123@c.us", fromMe: "true" }],
    ["an empty message", { from: "12025550123@c.us", body: "  " }],
    ["no sender", {}],
  ])("ignores %s", (_name, payload) => {
    expect(read(payload)).toEqual({ ignore: true });
  });

  it("ignores events that are not an incoming message", () => {
    expect(read({ from: "12025550123@c.us" }, { event: "message.any" })).toEqual({ ignore: true });
    expect(read({ from: "12025550123@c.us" }, { event: "message" })).toMatchObject({ ignore: false });
  });

  it.each([{ hasMedia: true }, { media: {} }, { type: "audio" }])("keeps a voice note or file with no text, with a marker", (media) => {
    expect(read({ from: "12025550123@c.us", body: "", ...media })).toMatchObject({
      ignore: false,
      message: { body: "[El cliente envió un audio o archivo sin texto]" },
    });
  });

  it("uses the time WAHA reports in seconds, and falls back to now when it is nonsense", () => {
    expect(read({ from: "12025550123@c.us", timestamp: 1_900_000_000 })).toMatchObject({
      message: { sentAt: new Date(1_900_000_000_000) },
    });
    expect(read({ from: "12025550123@c.us", timestamp: 5 })).toMatchObject({ message: { sentAt: now } });
  });

  it("rejects a delivery with no message id, which is what the duplicate check needs", () => {
    expect(parseDelivery(Buffer.from(JSON.stringify({ session: "s", payload: { from: "1@c.us", body: "hi" } })))).toEqual({ ok: false });
    expect(parseDelivery(Buffer.from("not json"))).toEqual({ ok: false });
  });
});
