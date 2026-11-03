import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";

/**
 * What the panel's calendar can do with appointments and availability. Every rule lives in the database
 * (schema api, migration 0015); this only checks the shape of the request and maps the database's
 * refusals to answers the panel can show. Same wall as the proxy: only with a development identity, never in
 * production, until Access arrives (CRM-T3).
 */

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true });

const BOOK = z.strictObject({
  deal_id: id,
  technician_id: id,
  start_at: instant,
  address: z.string().trim().max(300).nullish(),
  confirm: z.boolean().default(false),
});
const RESCHEDULE = z.strictObject({ technician_id: id, start_at: instant });
const WINDOWS = z.strictObject({
  windows: z
    .array(z.strictObject({ weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }))
    .max(70),
});
const TIME_OFF = z.strictObject({ from: instant, to: instant, reason: z.string().trim().max(200).nullish() });
const PARAM = z.strictObject({ id });

/** The database refuses with an error code and a hint; the panel gets both, never the SQL. */
export const refusal = (error: unknown): { status: number; body: { error: string; reason?: string } } | null => {
  const { code, hint } = error as { code?: string; hint?: string };
  const reason = hint || undefined;
  if (code === "CX004") return { status: 400, body: { error: "invalid_input", reason } };
  if (code === "CX002") return { status: 409, body: { error: "invalid_state", reason } };
  if (code === "CX003") return { status: 409, body: { error: "hold_expired" } };
  if (code === "CX005") return { status: 409, body: { error: "slot_taken" } };
  return null;
};

export const adminAgenda = (app: FastifyInstance, deps: AppDeps, cors: (request: FastifyRequest, reply: FastifyReply) => void): void => {
  const methods = "POST, DELETE";

  app.options("/admin/agenda/*", async (request, reply) => {
    cors(request, reply);
    reply.header("Access-Control-Allow-Methods", methods);
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    reply.header("Access-Control-Max-Age", "600");
    return reply.code(204).send();
  });

  const body = (request: FastifyRequest): unknown => {
    try {
      const raw = request.body as Buffer | undefined;
      return raw && raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      return undefined;
    }
  };

  const route = <B, P>(
    method: "POST" | "DELETE",
    url: string,
    schemas: { body?: z.ZodType<B>; params?: z.ZodType<P> },
    call: (input: { body: B; params: P }) => Promise<{ sql: string; values: unknown[] }>,
  ) =>
    app.route({
      method,
      url,
      bodyLimit: 16_384,
      handler: async (request, reply) => {
        cors(request, reply);
        if (!deps.config.ADMIN_DEV_SUB) return reply.code(401).send({ error: "unauthorized" });
        const params = schemas.params ? schemas.params.safeParse(request.params) : { success: true as const, data: undefined as P };
        const parsed = schemas.body ? schemas.body.safeParse(body(request)) : { success: true as const, data: undefined as B };
        if (!params.success || !parsed.success) return reply.code(400).send({ error: "invalid_input", reason: "bad_request" });

        const { sql, values } = await call({ body: parsed.data, params: params.data });
        try {
          const { rows } = await deps.db.query<{ result: unknown }>(sql, values);
          return reply.code(200).send(rows[0].result);
        } catch (error) {
          const answer = refusal(error);
          if (answer) return reply.code(answer.status).send(answer.body);
          throw error;
        }
      },
    });

  route("POST", "/admin/agenda/appointments", { body: BOOK }, async ({ body: input }) => ({
    sql: "select api.staff_book($1, $2, $3, $4, $5) as result",
    values: [input.deal_id, input.technician_id, input.start_at, input.address ?? null, input.confirm],
  }));
  route("POST", "/admin/agenda/appointments/:id/confirm", { params: PARAM }, async ({ params }) => ({
    sql: "select api.staff_confirm($1) as result",
    values: [params.id],
  }));
  route("POST", "/admin/agenda/appointments/:id/cancel", { params: PARAM }, async ({ params }) => ({
    sql: "select api.staff_cancel($1) as result",
    values: [params.id],
  }));
  route("POST", "/admin/agenda/appointments/:id/reschedule", { params: PARAM, body: RESCHEDULE }, async ({ params, body: input }) => ({
    sql: "select api.staff_reschedule($1, $2, $3) as result",
    values: [params.id, input.technician_id, input.start_at],
  }));
  route("POST", "/admin/agenda/technicians/:id/availability", { params: PARAM, body: WINDOWS }, async ({ params, body: input }) => ({
    sql: "select api.set_availability($1, $2::jsonb) as result",
    values: [params.id, JSON.stringify(input.windows)],
  }));
  route("POST", "/admin/agenda/technicians/:id/time-off", { params: PARAM, body: TIME_OFF }, async ({ params, body: input }) => ({
    sql: "select api.add_time_off($1, $2, $3, $4) as result",
    values: [params.id, input.from, input.to, input.reason ?? null],
  }));
  route("DELETE", "/admin/agenda/time-off/:id", { params: PARAM }, async ({ params }) => ({
    sql: "select api.remove_time_off($1) as result",
    values: [params.id],
  }));
};
