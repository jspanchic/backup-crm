import { buildApp } from "./app.ts";
import { startBackground } from "./background.ts";
import type { FetchLike } from "./bot.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";

const config = loadConfig();
const db = createDb(config);

const app = buildApp({
  config,
  env: process.env,
  db,
  fetch: (url, init) => fetch(url, init),
  outboxFetch: (url, init) => fetch(url, init),
  proxyFetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  logger: { level: config.LOG_LEVEL },
});

const httpFetch: FetchLike = (url, init) => fetch(url, init);
const stopBackground = startBackground({
  app,
  db,
  bot: { config, env: process.env, db, fetch: httpFetch, log: app.log, now: () => new Date() },
  outbox: {
    config,
    db,
    fetch: httpFetch,
    log: app.log,
    sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
    random: Math.random,
  },
});

const shutdown = async () => {
  stopBackground();
  await app.close();
  await app.idle();
  await db.close();
};
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
