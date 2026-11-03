import { buildApp } from "./app.ts";
import type { FetchLike } from "./bot.ts";
import { sweepPendingDispatches } from "./bot.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { runOutboxOnce } from "./outbox.ts";

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
const botDeps = { config, env: process.env, db, fetch: httpFetch, log: app.log, now: () => new Date() };
const outboxDeps = {
  config,
  db,
  fetch: httpFetch,
  log: app.log,
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  random: Math.random,
};

// Two small loops: send what is queued, and retry what the bot never accepted.
const timers = [
  setInterval(() => void runOutboxOnce(outboxDeps).catch((error: Error) => app.log.error({ err: error.name }, "outbox loop")), 1_000),
  setInterval(() => void sweepPendingDispatches(botDeps).catch((error: Error) => app.log.error({ err: error.name }, "sweep loop")), 30_000),
];

const shutdown = async () => {
  timers.forEach(clearInterval);
  await app.close();
  await app.idle();
  await db.close();
};
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

await app.listen({ host: config.HOST, port: config.PORT });
