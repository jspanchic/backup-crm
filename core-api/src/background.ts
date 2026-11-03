import type { BuiltApp } from "./app.ts";
import { sweepPendingDispatches, type BotDeps } from "./bot.ts";
import type { Db } from "./db.ts";
import { runOutboxOnce, type OutboxDeps } from "./outbox.ts";

export type Intervals = { outboxMs: number; sweepMs: number; expiryMs: number };

export const DEFAULT_INTERVALS: Intervals = { outboxMs: 1_000, sweepMs: 30_000, expiryMs: 60_000 };

/**
 * The three small loops of the service: send what is queued, retry what the bot never accepted, and mark
 * the holds that ran out. They are separate from the HTTP server so that tests and the demo can run them
 * with short intervals. Returns a function that stops them.
 */
export const startBackground = (
  deps: { app: BuiltApp; db: Db; bot: BotDeps; outbox: OutboxDeps },
  intervals: Intervals = DEFAULT_INTERVALS,
): (() => void) => {
  const { app, db, bot, outbox } = deps;
  const timers = [
    setInterval(() => void runOutboxOnce(outbox).catch((error: Error) => app.log.error({ err: error.name }, "outbox loop")), intervals.outboxMs),
    setInterval(() => void sweepPendingDispatches(bot).catch((error: Error) => app.log.error({ err: error.name }, "sweep loop")), intervals.sweepMs),
    // Holds that ran out stop blocking a time as soon as they are marked; the booking function also does it.
    setInterval(() => void db.query("select api.expire_holds()").catch((error: Error) => app.log.error({ err: error.name }, "expiry loop")), intervals.expiryMs),
  ];
  return () => timers.forEach(clearInterval);
};
