// Sends one message as WAHA would. Usage: npm run sim -- --phone 12025550123 --text "Hola" [--name Carlos] [--twice]
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { sendInbound, sendTwice, fakePhone } from "./waha-sim.ts";

const envFile = resolve(import.meta.dirname, "../../infra/local/.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const secret = process.env.WAHA_HMAC_BYTOGAM_PRUEBAS;
if (!secret) throw new Error('Missing WAHA_HMAC_BYTOGAM_PRUEBAS: run "npm run local:init"');

const config = {
  coreApiUrl: option("core-api") ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
  session: option("session") ?? "bytogam-pruebas",
  hmacSecret: secret,
};
const message = { phone: option("phone") ?? fakePhone(), text: option("text") ?? "Hola", pushName: option("name") };

if (args.includes("--twice")) {
  const [first, second] = await sendTwice(config, message);
  console.log("primera entrega:", first.status, JSON.stringify(first.body));
  console.log("segunda entrega:", second.status, JSON.stringify(second.body));
} else {
  const sent = await sendInbound(config, message);
  console.log(sent.status, JSON.stringify(sent.body), `(teléfono ${message.phone})`);
}
