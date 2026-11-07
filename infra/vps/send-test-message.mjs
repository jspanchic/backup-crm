// Sends ONE fake incoming WhatsApp message to core-api, signed like WAHA does, to start a conversation with the
// test copy of the bot without real WhatsApp. Run it INSIDE the core-api container (guide, section d):
//   docker compose exec -T core-api node --input-type=module - 14075550150 "Hola, quiero cotizar" < send-test-message.mjs
// The key is read from the environment of the container; it is never printed. Only for fictional numbers.
import { createHmac, randomBytes } from "node:crypto";

const [phone, text] = process.argv.slice(2);
if (!/^\d{11,15}$/.test(phone ?? "") || !text) {
  console.error('Usage: node - <phone digits with country code, no +> "<text>"   (use a fictional number, e.g. 14075550150)');
  process.exit(2);
}
const secret = process.env.WAHA_HMAC_BYTOGAM_PRUEBAS;
if (!secret) {
  console.error("WAHA_HMAC_BYTOGAM_PRUEBAS is empty in infra/vps/.env: fill it in and recreate core-api.");
  process.exit(2);
}

const from = `${phone}@c.us`;
const raw = JSON.stringify({
  event: "message",
  session: "bytogam-pruebas",
  engine: "WEBJS",
  payload: {
    id: `false_${from}_${randomBytes(16).toString("hex").toUpperCase()}`,
    timestamp: Math.floor(Date.now() / 1000),
    from,
    fromMe: false,
    body: text,
    hasMedia: false,
    _data: { Info: { PushName: "Prueba" } },
  },
});

const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/hooks/whatsapp`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-webhook-hmac": createHmac("sha512", secret).update(raw).digest("hex"),
    "x-webhook-hmac-algorithm": "sha512",
    "x-webhook-timestamp": String(Date.now()),
    "x-webhook-request-id": randomBytes(8).toString("hex"),
  },
  body: raw,
});
console.log(`core-api answered ${response.status}`);