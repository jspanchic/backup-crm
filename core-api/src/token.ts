import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "core-api";
const AUDIENCE = "bot-tools";

export type ConversationClaims = { brandId: number; conversationId: number };

/** The token carries the conversation and nothing about the customer. The tools take no id from the caller. */
export const signConversationToken = async (
  secret: string,
  claims: ConversationClaims,
  now: Date = new Date(),
): Promise<string> =>
  new SignJWT({ brd: claims.brandId, cnv: claims.conversationId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));

export type VerifiedToken = { ok: true; claims: ConversationClaims } | { ok: false };

export const verifyConversationToken = async (
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<VerifiedToken> => {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
      requiredClaims: ["exp", "iat", "jti", "brd", "cnv"],
    });
    const { brd, cnv } = payload as { brd?: unknown; cnv?: unknown };
    if (!Number.isSafeInteger(brd) || !Number.isSafeInteger(cnv)) return { ok: false };
    return { ok: true, claims: { brandId: brd as number, conversationId: cnv as number } };
  } catch {
    return { ok: false };
  }
};
