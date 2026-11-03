import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import type { AppDeps } from "../app.ts";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

const CRUD: Method[] = ["GET", "POST", "PATCH", "DELETE"];

/**
 * The only resources the panel may reach, and how. Anything else is a 404, as if it did not exist.
 * The database role limits this further; this list is the first wall, not the only one.
 */
export const ADMIN_RESOURCES: Record<string, Method[]> = {
  companies: CRUD,
  contacts: CRUD,
  contact_notes: CRUD,
  deals: CRUD,
  deal_notes: CRUD,
  tags: CRUD,
  tasks: CRUD,
  configuration: ["GET", "PATCH"],
  sales: ["GET", "PATCH"],
  companies_summary: ["GET"],
  contacts_summary: ["GET"],
  activity_log: ["GET"],
  appointments_summary: ["GET"],
  "rpc/global_search": ["POST"],
};

const ALLOWED_PREFER = /^(return=(minimal|representation)|count=(exact|planned|estimated))(,\s*(return=(minimal|representation)|count=(exact|planned|estimated)))*$/;
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-range", "content-location"];
const PANEL_TOKEN_TTL_SECONDS = 300;

const signPostgrestToken = (secret: string, sub: string, now: Date): Promise<string> =>
  new SignJWT({ role: "crm_api" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + PANEL_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));

export const adminProxy = (app: FastifyInstance, deps: AppDeps): void => {
  const { config } = deps;
  const origins = new Set(config.ADMIN_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()));

  const cors = (request: FastifyRequest, reply: FastifyReply): void => {
    const origin = request.headers.origin;
    if (origin && origins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Expose-Headers", "Content-Range");
    }
  };

  app.options("/admin/rest/*", async (request, reply) => {
    cors(request, reply);
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Prefer, Range");
    reply.header("Access-Control-Max-Age", "600");
    return reply.code(204).send();
  });

  app.route({
    method: ["GET", "POST", "PATCH", "DELETE"],
    url: "/admin/rest/*",
    handler: async (request, reply) => {
    cors(request, reply);
    const resource = (request.params as { "*": string })["*"];
    const methods = ADMIN_RESOURCES[resource];
    if (!methods) return reply.code(404).send({ error: "not_found" });
    if (!methods.includes(request.method as Method)) return reply.code(405).send({ error: "method_not_allowed" });

    // Development identity. Production replaces this with the Cloudflare Access JWT (CRM-T3).
    if (!config.ADMIN_DEV_SUB) return reply.code(401).send({ error: "unauthorized" });

    const prefer = request.headers.prefer;
    if (typeof prefer === "string" && !ALLOWED_PREFER.test(prefer)) return reply.code(400).send({ error: "invalid_request" });

    const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
    const token = await signPostgrestToken(config.PGRST_JWT_SECRET, config.ADMIN_DEV_SUB, deps.now());
    const hasBody = request.method === "POST" || request.method === "PATCH";
    const upstream = await deps.proxyFetch(`${config.POSTGREST_URL}/${resource}${query}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(typeof prefer === "string" ? { Prefer: prefer } : {}),
        ...(typeof request.headers.range === "string" ? { Range: request.headers.range } : {}),
      },
      body: hasBody ? (request.body as Buffer) : undefined,
      signal: AbortSignal.timeout(20_000),
    });

    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) reply.header(name, value);
    }
    return reply.code(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  },
  });
};
