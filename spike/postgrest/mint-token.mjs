// CRM-T1 spike: mint a local HS256 JWT. Usage: node mint-token.mjs <env-file> [sub] [role]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const [
  envFile,
  sub = "11111111-1111-1111-1111-111111111111",
  role = "crm_api",
] = process.argv.slice(2);
const secret = readFileSync(envFile, "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("JWT_SECRET="))
  .slice(11);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role, iat: now, exp: now + 8 * 3600 })}`;
process.stdout.write(
  `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`,
);
