import type { FastifyBaseLogger } from "fastify";
import { issueDocument, loadSettings, sendDocument, type DocumentsDeps } from "./service.ts";
import type { DocumentType } from "./view.ts";

/**
 * The documents the bot flow produces by itself:
 *  - a new quote: the quote PDF, sent to the customer;
 *  - a confirmed appointment: the purchase order, sent to the customer, and the work order, which is only issued
 *    (it is for the technician and never goes to the customer).
 *
 * The safeguards:
 *  - It never throws. A PDF that fails (the engine is down, a template is wrong) must not break a quote or a
 *    confirmation the customer is waiting for: it is logged and the panel can issue the document by hand.
 *  - A real customer gets nothing automatic while the legal texts are unconfirmed (`confirmed` in settings.json).
 *    Nothing is even issued then, so the numbered series of real documents has no draft in it. Test leads always do.
 *  - Customer-facing files also require the brand's PDF switch. Internal work orders stay available.
 */

type Target = { deal_id: number; is_test: boolean; pdf_clientes_reales: boolean; appointment_id: number | null };

export type AutomaticDeps = DocumentsDeps & { log: FastifyBaseLogger };

/** What the tool tells the bot, so it only claims what is true. */
export type DocumentOutcome = { documento: "en_cola" | "no_disponible" };

const targetOf = async (deps: AutomaticDeps, conversationId: number): Promise<Target | null> => {
  const { rows } = await deps.db.query<{ result: Target | null }>("select api.document_target($1) as result", [conversationId]);
  return rows[0].result;
};

const attempt = async (deps: AutomaticDeps, label: string, work: () => Promise<unknown>): Promise<boolean> => {
  try {
    await work();
    return true;
  } catch (error) {
    // Name and code only: a message may carry a customer's data.
    deps.log.error({ err: (error as Error).name, code: (error as { code?: string }).code, step: label }, "automatic document failed");
    return false;
  }
};

const issueAndMaybeSend = async (
  deps: AutomaticDeps, target: Target, type: DocumentType, send: boolean, inboundMessageId?: number,
): Promise<boolean> =>
  attempt(deps, type, async () => {
    const document = await issueDocument(deps, { dealId: target.deal_id, documentType: type, appointmentId: type === "quote" ? null : target.appointment_id });
    // Only the call that created the document sends it: a document that already existed was handled before.
    if (send && document.created) await sendDocument(deps, document.id, "bot", inboundMessageId);
  });

/**
 * Whether the automatic flow may run for this conversation, and the deal it is about. Reading the settings is
 * part of it, so a missing or broken settings file stops the flow instead of letting a document out.
 */
const eligibleTarget = async (deps: AutomaticDeps, conversationId: number): Promise<Target | null> => {
  const target = await targetOf(deps, conversationId);
  if (!target) return null;
  if (!target.is_test && !(await loadSettings(deps.config)).confirmed) return null;
  return target;
};

const canSendToCustomer = (target: Target): boolean => target.is_test || target.pdf_clientes_reales;

/** Starts the quote PDF for the conversation's deal. Resolves with what the bot may say about it. */
export const documentForQuote = async (
  deps: AutomaticDeps, conversationId: number, inboundMessageId?: number,
): Promise<DocumentOutcome> => {
  let target: Target | null = null;
  const ok = await attempt(deps, "target", async () => {
    target = await eligibleTarget(deps, conversationId);
  });
  if (!ok || !target || !canSendToCustomer(target)) return { documento: "no_disponible" };
  const done = await issueAndMaybeSend(deps, target, "quote", true, inboundMessageId);
  return { documento: done ? "en_cola" : "no_disponible" };
};

/** Starts the purchase order (sent) and the work order (issued only) once the appointment is confirmed. */
export const documentsForConfirmation = async (
  deps: AutomaticDeps, conversationId: number, inboundMessageId?: number,
): Promise<DocumentOutcome> => {
  let target: Target | null = null;
  const ok = await attempt(deps, "target", async () => {
    target = await eligibleTarget(deps, conversationId);
  });
  if (!ok || !target) return { documento: "no_disponible" };
  const order = canSendToCustomer(target) && await issueAndMaybeSend(deps, target, "purchase_order", true, inboundMessageId);
  // The work order does not depend on the purchase order: one failing does not stop the other.
  await issueAndMaybeSend(deps, target, "work_order", false);
  return { documento: order ? "en_cola" : "no_disponible" };
};
