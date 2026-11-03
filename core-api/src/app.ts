import Fastify, { type FastifyInstance } from "fastify";
import type { BotDeps } from "./bot.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { RenderPdf } from "./documents/gotenberg.ts";
import type { OutboxDeps } from "./outbox.ts";
import { adminProxy } from "./routes/admin-proxy.ts";
import { toolRoutes } from "./routes/tools.ts";
import { whatsappRoutes } from "./routes/whatsapp.ts";

export type ProxyFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Buffer; signal: AbortSignal },
) => Promise<{ status: number; headers: { get: (name: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer>; json: () => Promise<unknown> }>;

export type AppDeps = BotDeps & {
  outboxFetch: OutboxDeps["fetch"];
  proxyFetch: ProxyFetch;
  /** HTML in, PDF out. Gotenberg in production; tests and the previews can pass their own. */
  renderPdf: RenderPdf;
  /** Keeps a promise that runs after the response, so tests and shutdown can wait for it. */
  track: (work: Promise<unknown>) => void;
};

export type BuiltApp = FastifyInstance & {
  routesRegistered: string[];
  /** Resolves when background work started by earlier requests has finished. */
  idle: () => Promise<void>;
};

export const buildApp = (deps: Omit<AppDeps, "track" | "log"> & { logger?: boolean | { level: string } }): BuiltApp => {
  const pending = new Set<Promise<unknown>>();
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 1_048_576,
    // Bodies are never parsed here: the signature is checked over the exact bytes first.
    exposeHeadRoutes: false,
  }) as unknown as BuiltApp;

  const full: AppDeps = {
    ...deps,
    log: app.log,
    track: (work) => {
      pending.add(work);
      void work.finally(() => pending.delete(work));
    },
  };

  app.removeAllContentTypeParsers();
  app.addContentTypeParser(/^application\/json(;.*)?$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.routesRegistered = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat()) {
      if (method !== "OPTIONS") app.routesRegistered.push(`${method} ${route.url}`);
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  whatsappRoutes(app, full);
  toolRoutes(app, full);
  // Without a development identity there is no panel yet: Access arrives with CRM-T3.
  if (deps.config.NODE_ENV !== "production" && deps.config.ADMIN_DEV_SUB) adminProxy(app, full);

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));
  app.setErrorHandler((error: { name?: string; code?: string; statusCode?: number }, request, reply) => {
    // Never log the body or the headers: they carry messages and signatures.
    request.log.error({ err: error.name, code: error.code }, "request failed");
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? "internal_error" : "invalid_request" });
  });

  app.idle = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };
  return app;
};
