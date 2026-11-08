import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signConversationToken, TOKEN_TTL_SECONDS, verifyConversationToken } from "../../src/token.ts";

const secret = "t".repeat(40);
const claims = { brandId: 1, conversationId: 42 };
const at = (seconds: number) => new Date(Date.UTC(2030, 0, 1, 0, 0, 0) + seconds * 1000);
const key = new TextEncoder().encode(secret);

const make = (extra: Record<string, unknown>, options: { aud?: string; iss?: string; alg?: "HS256" | "HS512" } = {}) =>
  new SignJWT(extra)
    .setProtectedHeader({ alg: options.alg ?? "HS256" })
    .setIssuer(options.iss ?? "core-api")
    .setAudience(options.aud ?? "bot-tools")
    .setJti("a")
    .setIssuedAt(Math.floor(at(0).getTime() / 1000))
    .setExpirationTime(Math.floor(at(0).getTime() / 1000) + 600)
    .sign(key);

describe("conversation token", () => {
  it("verifies and returns only the brand and the conversation", async () => {
    const token = await signConversationToken(secret, claims, at(0));
    expect(await verifyConversationToken(secret, token, at(10))).toEqual({ ok: true, claims });
  });

  it("carries the bot generation when issued for a live brand", async () => {
    const generatedClaims = { ...claims, botGeneration: 2 };
    const token = await signConversationToken(secret, generatedClaims, at(0));
    expect(await verifyConversationToken(secret, token, at(10))).toEqual({ ok: true, claims: generatedClaims });
    expect(await verifyConversationToken(secret, await make({ brd: 1, cnv: 42, gen: "2" }), at(10))).toEqual({ ok: false });
  });

  it("lives for 15 minutes", async () => {
    expect(TOKEN_TTL_SECONDS).toBe(900);
    const token = await signConversationToken(secret, claims, at(0));
    expect(await verifyConversationToken(secret, token, at(899))).toMatchObject({ ok: true });
    expect(await verifyConversationToken(secret, token, at(901))).toEqual({ ok: false });
  });

  it("is rejected when expired, however old", async () => {
    const token = await signConversationToken(secret, claims, at(0));
    expect(await verifyConversationToken(secret, token, at(86_400))).toEqual({ ok: false });
  });

  it("carries no customer data", async () => {
    const token = await signConversationToken(secret, claims, at(0));
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["aud", "brd", "cnv", "exp", "iat", "iss", "jti"]);
  });

  it("is rejected with another secret, a changed signature or a changed claim", async () => {
    const token = await signConversationToken(secret, claims, at(0));
    expect(await verifyConversationToken("u".repeat(40), token, at(1))).toEqual({ ok: false });
    expect(await verifyConversationToken(secret, `${token.slice(0, -2)}xx`, at(1))).toEqual({ ok: false });

    const [head, body, signature] = token.split(".");
    const changed = { ...JSON.parse(Buffer.from(body, "base64url").toString()), cnv: 43 };
    const forged = Buffer.from(JSON.stringify(changed)).toString("base64url");
    expect(await verifyConversationToken(secret, `${head}.${forged}.${signature}`, at(1))).toEqual({ ok: false });
  });

  it("is rejected with the wrong audience, issuer or algorithm", async () => {
    expect(await verifyConversationToken(secret, await make({ brd: 1, cnv: 42 }), at(1))).toMatchObject({ ok: true });
    expect(await verifyConversationToken(secret, await make({ brd: 1, cnv: 42 }, { aud: "someone-else" }), at(1))).toEqual({ ok: false });
    expect(await verifyConversationToken(secret, await make({ brd: 1, cnv: 42 }, { iss: "another" }), at(1))).toEqual({ ok: false });
    expect(await verifyConversationToken(secret, await make({ brd: 1, cnv: 42 }, { alg: "HS512" }), at(1))).toEqual({ ok: false });
  });

  it("is rejected without a signature (alg none) and when claims are missing or not numbers", async () => {
    const unsigned = [
      Buffer.from('{"alg":"none"}').toString("base64url"),
      Buffer.from(JSON.stringify({ iss: "core-api", aud: "bot-tools", brd: 1, cnv: 1, jti: "a", iat: 1, exp: 99_999_999_999 })).toString("base64url"),
      "",
    ].join(".");
    expect(await verifyConversationToken(secret, unsigned, at(1))).toEqual({ ok: false });

    expect(await verifyConversationToken(secret, await make({ brd: 1 }), at(1))).toEqual({ ok: false });
    expect(await verifyConversationToken(secret, await make({ brd: "1", cnv: "42" }), at(1))).toEqual({ ok: false });
    expect(await verifyConversationToken(secret, "garbage", at(1))).toEqual({ ok: false });
  });
});
