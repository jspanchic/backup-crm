import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { documentForQuote, documentsForConfirmation, type DocumentOutcome } from "../documents/automatic.ts";
import { PHONE_PLACEHOLDER, reviewReply, type ReplyFacts } from "../reply-review.ts";
import { confirmationMessage, slotLabel, type Language } from "../schedule-time.ts";
import { verifyConversationToken } from "../token.ts";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

// Every schema is strict: an unknown key, including any id of a customer, is a 400.
// The Spanish keys are the contract with the bot; the database uses English names.

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), "control characters");

const spaceTypes = ["home", "office_warehouse", "restaurant_kitchen", "clinic", "veterinary", "gym", "school_daycare", "hotel_rental", "other"] as const;

const saveDataSchema = z
  .strictObject({
    nombre: text(80).optional(),
    apellido: text(80).optional(),
    email: z.email().max(200).optional(),
    idioma: z.enum(["es", "en"]).optional(),
    tipo_cliente: z.enum(["hogar", "empresa"]).optional(),
    tipo_espacio: z.enum(spaceTypes).optional(),
    direccion: text(300).optional(),
    tamano: text(100).optional(),
    zip: text(10).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "at least one field");

const area = z.union([
  z.strictObject({ techada: z.boolean(), pies: z.number().positive().max(10_000_000) }),
  z.strictObject({ techada: z.boolean(), metros: z.number().positive().max(1_000_000) }),
  z.strictObject({ techada: z.boolean(), pasos_largo: z.number().positive().max(10_000), pasos_ancho: z.number().positive().max(10_000) }),
]);

const quoteSchema = z
  .strictObject({
    tipo_cliente: z.enum(["hogar", "empresa"]),
    dormitorios: z.int().min(0).max(30).optional(),
    pies_cubiertos: z.number().min(0).max(10_000_000).optional(),
    autos_techados: z.int().min(0).max(20).optional(),
    autos_descubiertos: z.int().min(0).max(20).optional(),
    areas_extra: z.array(area).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipo_cliente === "hogar" && data.dormitorios === undefined) ctx.addIssue({ code: "custom", message: "dormitorios is required for a home", path: ["dormitorios"] });
    if (data.tipo_cliente === "hogar" && data.pies_cubiertos !== undefined) ctx.addIssue({ code: "custom", message: "a home is estimated from bedrooms", path: ["pies_cubiertos"] });
    if (data.tipo_cliente === "empresa" && data.pies_cubiertos === undefined) ctx.addIssue({ code: "custom", message: "pies_cubiertos is required for a business", path: ["pies_cubiertos"] });
    if (data.tipo_cliente === "empresa" && data.dormitorios !== undefined) ctx.addIssue({ code: "custom", message: "dormitorios is only for a home", path: ["dormitorios"] });
  });

const escalateSchema = z.strictObject({ motivo: text(300) });
const freeSlotsSchema = z.strictObject({
  desde: z.iso.date().optional(),
  dias: z.int().min(1).max(14).optional(),
  zip: text(10).regex(/^[0-9]{5}(?:-[0-9]{4})?$/).optional(),
});
const reserveSchema = z.strictObject({ inicio: z.iso.datetime({ offset: true }) });
const confirmSchema = z.strictObject({});
const holderSchema = z
  .strictObject({ es_la_misma_persona: z.boolean(), nombre_nuevo: text(80).optional() })
  .refine((data) => !(data.es_la_misma_persona && data.nombre_nuevo !== undefined), "nombre_nuevo is only for a different person");
const replySchema = z.strictObject({ texto: text(4000) });

const toQuoteInputs = (input: z.infer<typeof quoteSchema>) => ({
  client_type: input.tipo_cliente === "hogar" ? "home" : "business",
  bedrooms: input.dormitorios,
  covered_sqft: input.pies_cubiertos,
  covered_parking_cars: input.autos_techados,
  uncovered_parking_cars: input.autos_descubiertos,
  extra_areas: input.areas_extra?.map((item) => ({
    covered: item.techada,
    ...("pies" in item ? { sqft: item.pies } : {}),
    ...("metros" in item ? { sqm: item.metros } : {}),
    ...("pasos_largo" in item ? { paces_long: item.pasos_largo, paces_wide: item.pasos_ancho } : {}),
  })),
});

const toSaveData = (input: z.infer<typeof saveDataSchema>) => ({
  first_name: input.nombre,
  last_name: input.apellido,
  email: input.email,
  language: input.idioma,
  client_type: input.tipo_cliente === undefined ? undefined : input.tipo_cliente === "hogar" ? "home" : "business",
  space_type: input.tipo_espacio,
  address: input.direccion,
  space_size: input.tamano,
  zip: input.zip,
});

const withoutUndefined = (value: object) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

/** What the bot may say about the PDF: only what is true. Sending it is core-api's doing, not the bot's. */
const pdfNotice = (outcome: DocumentOutcome, what: string) => ({
  pdf: outcome.documento,
  aviso_pdf:
    outcome.documento === "en_cola"
      ? `${what[0].toUpperCase()}${what.slice(1)} en PDF ya se puso en cola para enviarse por WhatsApp. Puedes mencionarlo, sin prometer a qué hora llega.`
      : `No se envió ningún PDF de ${what}. No lo menciones ni lo prometas.`,
});

type ToolContext = { conversationId: number; paused: boolean; inboundMessageId?: number };
type ToolConversation = {
  conversation_id: number;
  bot_paused: boolean;
  closed: boolean;
  bot_enabled: boolean;
  bot_agenda_enabled: boolean;
  bot_generation: number;
};

const phoneForCustomer = (e164: string): string => parsePhoneNumberFromString(e164)?.formatNational() ?? e164;

export const toolRoutes = (app: FastifyInstance, deps: AppDeps): void => {
  const documents = { config: deps.config, db: deps.db, renderPdf: deps.renderPdf, log: deps.log };

  /** Token to conversation. Nothing else identifies the customer: no tool takes an id. */
  const authenticate = async (request: FastifyRequest, reply: FastifyReply, agenda: boolean): Promise<ToolContext | null> => {
    const header = request.headers.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const verified = token ? await verifyConversationToken(deps.config.CONVERSATION_TOKEN_SECRET, token, deps.now()) : ({ ok: false } as const);
    if (!verified.ok) {
      await reply.code(401).send({ error: "invalid_token" });
      return null;
    }
    const { rows } = await deps.db.query<{ result: ToolConversation | null }>(
      "select api.tool_conversation($1, $2) as result",
      [verified.claims.conversationId, verified.claims.brandId],
    );
    const found = rows[0].result;
    if (!found) {
      await reply.code(401).send({ error: "invalid_token" });
      return null;
    }
    if (agenda && !found.bot_agenda_enabled) {
      await reply.code(409).send({ error: "agenda_apagada" });
      return null;
    }
    if (!found.bot_enabled) {
      await reply.code(409).send({ error: "bot_disabled" });
      return null;
    }
    if (found.bot_generation !== (verified.claims.botGeneration ?? 0)) {
      await reply.code(401).send({ error: "invalid_token" });
      return null;
    }
    if (found.closed) {
      await reply.code(409).send({ error: "conversation_closed" });
      return null;
    }
    return {
      conversationId: found.conversation_id,
      paused: found.bot_paused,
      inboundMessageId: verified.claims.inboundMessageId,
    };
  };

  const readBody = (request: FastifyRequest): unknown => {
    try {
      const raw = request.body as Buffer | undefined;
      return raw && raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Runs a database function and maps its errors; the message of a CX004 is for the model, any other is hidden. */
  const run = async (reply: FastifyReply, work: () => Promise<unknown>): Promise<FastifyReply> => {
    try {
      const result = await work();
      // A handler that already answered (a rejected reply) has nothing left to send. It cannot be
      // detected by comparing with `reply`: awaiting a reply, which is thenable, does not give it back.
      return reply.sent ? reply : reply.code(200).send(result);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "CX004") return reply.code(400).send({ error: "invalid_input", message: (error as Error).message });
      if (code === "CX002") return reply.code(409).send({ error: "invalid_state", message: (error as Error).message });
      if (code === "CX003") return reply.code(409).send({ error: "hold_expired" });
      if (code === "CX005") return reply.code(409).send({ error: "slot_taken", message: "Ese horario ya no está disponible. Consulta horarios_libres otra vez y ofrece otro." });
      if (code === "CX006") return reply.code(409).send({ error: "slot_not_offered", message: "Solo puedes reservar un horario que salió de horarios_libres en esta conversación." });
      if (code === "CX007") return reply.code(409).send({ error: "bot_disabled" });
      if (code === "CX008") return reply.code(409).send({ error: "agenda_apagada" });
      throw error;
    }
  };

  const tool = <T>(
    method: "GET" | "POST",
    url: string,
    options: { schema?: z.ZodType<T>; pausable?: boolean; agenda?: boolean },
    handler: (context: ToolContext, input: T, reply: FastifyReply, request: FastifyRequest) => Promise<unknown>,
  ) =>
    app.route({
      method,
      url,
      bodyLimit: 16_384,
      handler: async (request, reply) => {
        const context = await authenticate(request, reply, options.agenda ?? false);
        if (!context) return reply;
        // Pause applies to everything the bot does except reading its own card.
        if (options.pausable !== false && context.paused) return reply.code(409).send({ error: "bot_paused" });

        let input = undefined as T;
        if (options.schema) {
          const parsed = options.schema.safeParse(readBody(request) ?? (method === "POST" ? {} : undefined));
          if (!parsed.success) {
            return reply.code(400).send({
              error: "invalid_input",
              fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || issue.message))],
            });
          }
          input = parsed.data;
        } else if (request.url.includes("?") || Number(request.headers["content-length"] ?? 0) > 0) {
          return reply.code(400).send({ error: "invalid_input" });
        }
        return run(reply, () => handler(context, input, reply, request));
      },
    });

  tool("GET", "/tools/ficha", { pausable: false }, async ({ conversationId }) => {
    const { rows } = await deps.db.query<{ card: Record<string, unknown> }>("select api.contact_card($1) as card", [conversationId]);
    const card = rows[0].card;
    // The bot speaks Spanish on the way in (tipo_cliente: hogar | empresa), so it hears the same on the way out.
    return { ...card, tipo_cliente: card.tipo_cliente === "home" ? "hogar" : card.tipo_cliente === "business" ? "empresa" : null };
  });

  tool("POST", "/tools/guardar_datos", { schema: saveDataSchema }, async ({ conversationId }, input) => {
    const { rows } = await deps.db.query("select api.save_contact_data($1, $2::jsonb) as result", [
      conversationId,
      JSON.stringify(withoutUndefined(toSaveData(input))),
    ]);
    return rows[0].result;
  });

  tool("POST", "/tools/cotizar", { schema: quoteSchema }, async ({ conversationId, inboundMessageId }, input) => {
    const { rows } = await deps.db.query("select api.create_quote($1, $2::jsonb) as quote", [
      conversationId,
      JSON.stringify(withoutUndefined(toQuoteInputs(input))),
    ]);
    const quote = rows[0].quote as Record<string, unknown>;
    return {
      version: quote.version,
      subtotal: quote.subtotal,
      descuento: quote.discount,
      total: quote.total,
      minimo_aplicado: quote.min_applied,
      pies_cubiertos: quote.covered_sqft,
      pies_descubiertos: quote.uncovered_sqft,
      moneda: quote.currency,
      descuento_pct: quote.discount_pct,
      // The discount switch and the tax rate belong to the brand. 	otal already includes the tax.
      descuento_aplicado: quote.discount_applied,
      impuesto: quote.tax,
      impuesto_pct: quote.tax_pct,
      // The prices are examples until JM confirms them: the bot must not present them as final.
      precios_confirmados: quote.price_confirmed,
      ...pdfNotice(await documentForQuote(documents, conversationId, inboundMessageId), "la cotización"),
    };
  });

  tool("POST", "/tools/escalar", { schema: escalateSchema }, async ({ conversationId }, input) => {
    const { rows } = await deps.db.query("select api.escalate($1, $2) as result", [conversationId, input.motivo]);
    return rows[0].result;
  });

  const languageOf = (facts: { language: string | null }): Language => (facts.language === "en" ? "en" : "es");

  tool("POST", "/tools/horarios_libres", { schema: freeSlotsSchema, agenda: true }, async ({ conversationId }, input) => {
    const { rows } = await deps.db.query<{ result: { zona_horaria: string; horarios: { inicio: string; fin: string }[]; fuera_de_cobertura?: true } }>(
      "select api.free_slots($1, $2::date, $3::int, $4) as result",
      [conversationId, input.desde ?? null, input.dias ?? null, input.zip ?? null],
    );
    if (rows[0].result.fuera_de_cobertura) return rows[0].result;
    const { rows: facts } = await deps.db.query<{ facts: { language: string | null } }>("select api.reply_facts($1) as facts", [conversationId]);
    const { zona_horaria, horarios } = rows[0].result;
    const language = languageOf(facts[0].facts);
    return {
      zona_horaria,
      horarios: horarios.map((slot) => ({ ...slot, texto: slotLabel(slot.inicio, zona_horaria, language) })),
    };
  });

  tool("POST", "/tools/reservar", { schema: reserveSchema, agenda: true }, async ({ conversationId }, input) => {
    const { rows } = await deps.db.query<{ result: { inicio: string; fin: string; vence_en: string } }>(
      "select api.hold_slot($1, $2::timestamptz) as result",
      [conversationId, input.inicio],
    );
    return { ...rows[0].result, aviso: "Es una reserva provisional: se confirma con confirmar cuando el cliente acepte la orden de compra." };
  });

  tool("POST", "/tools/confirmar", { schema: confirmSchema, agenda: true }, async ({ conversationId, inboundMessageId }, _input, reply) => {
    const { rows } = await deps.db.query<{ facts: ReplyFacts & { language: string | null } }>("select api.reply_facts($1) as facts", [conversationId]);
    const facts = rows[0].facts;
    const hold = facts.appointment;
    if (!hold || hold.status !== "hold") {
      return reply.code(409).send({ error: "invalid_state", message: "No hay un horario reservado para confirmar. Usa reservar primero." });
    }
    // The message is written here, from the appointment in the database, and goes out with the confirmation
    // in the same transaction: the customer is never told something the database does not hold.
    const message = confirmationMessage(hold.start_at, facts.timezone, languageOf(facts));
    const confirmed = await deps.db.query<{ result: { inicio: string; fin: string } }>(
      "select api.confirm_hold($1, $2::timestamptz, $3, $4) as result",
      [conversationId, hold.start_at, message, inboundMessageId ?? null],
    );
    return {
      confirmado: true,
      ...confirmed.rows[0].result,
      mensaje_enviado: true,
      aviso: "No escribas tú el mensaje de confirmación: ya se envió.",
      ...pdfNotice(await documentsForConfirmation(documents, conversationId, inboundMessageId), "la orden de compra"),
    };
  });

  tool("POST", "/tools/confirmar_titular", { schema: holderSchema }, async ({ conversationId }, input) => {
    const { rows } = await deps.db.query("select api.confirm_holder($1, $2, $3) as result", [conversationId, input.es_la_misma_persona, input.nombre_nuevo ?? null]);
    return rows[0].result;
  });

  tool("POST", "/tools/responder", { schema: replySchema }, async ({ conversationId, inboundMessageId }, input, reply) => {
    const { rows } = await deps.db.query<{ facts: ReplyFacts }>("select api.reply_facts($1) as facts", [conversationId]);
    const facts = rows[0].facts;
    const review = reviewReply(input.texto, facts);
    if (!review.ok) {
      await deps.db.query("select api.record_reply_review($1, $2, $3)", [conversationId, review.reason, input.texto]);
      return reply.code(422).send({ error: "reply_rejected", reason: review.reason, message: review.message });
    }
    // The history keeps the placeholder; only the message that leaves carries the number.
    const outgoing = facts.phone_e164 ? input.texto.replaceAll(PHONE_PLACEHOLDER, phoneForCustomer(facts.phone_e164)) : input.texto;
    const queued = await deps.db.query("select api.enqueue_outbound($1, $2, 'bot', $3, $4) as id", [
      conversationId, input.texto, outgoing, inboundMessageId ?? null,
    ]);
    return reply.code(200).send({ encolado: true, id: Number(queued.rows[0].id) });
  });
};
