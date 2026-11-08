import { buildApp } from "./app.ts";
import { startBackground } from "./background.ts";
import type { FetchLike } from "./bot.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { gotenbergRenderer } from "./documents/gotenberg.ts";
import type { WahaFetch } from "./waha-client.ts";

const config = loadConfig();
const db = createDb(config);
const httpFetch: FetchLike = (url, init) => fetch(url, init);
const wahaFetch: WahaFetch = (url, init) => fetch(url, init);

const app = buildApp({
  config,
  env: process.env,
  db,
  fetch: httpFetch,
  wahaFetch,
  proxyFetch: (url, init) => fetch(url, init),
  renderPdf: gotenbergRenderer(config),
  now: () => new Date(),
  logger: { level: config.LOG_LEVEL },
});

const stopBackground = startBackground({
  app,
  db,
  bot: { config, env: process.env, db, fetch: httpFetch, wahaFetch, log: app.log, now: () => new Date() },
  outbox: {
    config,
    db,
    fetch: wahaFetch,
    log: app.log,
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  },
});

const shutdown = async () => {
  const drained = stopBackground();
  await app.close();
  await app.idle();
  await drained;
  await db.close();
};
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
