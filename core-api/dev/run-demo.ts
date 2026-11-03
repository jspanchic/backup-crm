// Runs the demo against a core-api that is already up. Usage: npm run demo -- [--bot mock|external]
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { owner } from "../scripts/db-lib.ts";
import { runDemo } from "./demo.ts";
import { startMockBot } from "./mock-bot.ts";
import { startWahaServer } from "./waha-sim.ts";

const envFile = resolve(import.meta.dirname, "../../infra/local/.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const bot = option("bot", "mock");
const coreApiUrl = option("core-api", `http://127.0.0.1:${process.env.PORT ?? 3000}`);
const session = option("session", process.env.DEMO_SESSION ?? "demo");
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}: run "npm run local:init" in core-api`);
  return value;
};

const health = await fetch(`${coreApiUrl}/healthz`).catch(() => null);
if (!health?.ok) {
  console.error(`core-api does not answer at ${coreApiUrl}. Start it with: npm run start:demo`);
  process.exit(2);
}

const wahaUrl = new URL(process.env.WAHA_BASE_URL ?? "http://127.0.0.1:3100");
const waha = await startWahaServer({ port: Number(wahaUrl.port), apiKey: process.env.WAHA_API_KEY });
const mock =
  bot === "mock"
    ? await startMockBot({
        port: Number(new URL(need("BOT_URL_JAVIER")).port),
        path: new URL(need("BOT_URL_JAVIER")).pathname,
        coreApiUrl,
        botHmacSecret: need("BOT_HMAC_SECRET"),
        log: (line) => console.log(line),
      })
    : undefined;

console.log(`Demo con ${bot === "mock" ? "el bot de guion (sin Claude)" : "el bot externo (n8n)"} · core-api en ${coreApiUrl} · sesión "${session}"`);
const db = await owner(process.env.PGDATABASE ?? "salvionix");
try {
  const channel = await db.query("select 1 from core.channels where provider = 'waha' and identifier = $1 and active", [session]);
  if (!channel.rowCount) {
    console.error(`No hay un canal "${session}". Carga los datos de demostración: npm run db:seed-demo`);
    process.exit(2);
  }
  const { checks } = await runDemo({
    sim: { coreApiUrl, session, hmacSecret: need("WAHA_HMAC_BYTOGAM_PRUEBAS") },
    waha,
    db,
  });
  process.exitCode = checks.every((entry) => entry.ok) ? 0 : 1;
} finally {
  await db.end();
  await mock?.close();
  await waha.close();
}
