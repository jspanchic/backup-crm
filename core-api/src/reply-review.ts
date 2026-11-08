/**
 * Review of what the model wants to say, against what the database knows.
 *
 * This is a second wall, not the first one: amounts and appointments cannot be written by the model in
 * the first place (they come from the quote and from a reserved appointment). What the review stops is the
 * model saying something different from the database. It matches patterns in the text, so it can miss an
 * amount written in words ("doscientos ocho") and it can stop a legitimate sentence; when it stops one,
 * the model gets the reason and tries again.
 */

import { localParts, type LocalParts } from "./schedule-time.ts";

export type ReplyFacts = {
  timezone: string;
  currency: string | null;
  allowed_reply_domains: string[];
  phone_e164: string | null;
  rates: { covered: number; uncovered: number; discount_pct: number; min_total: number } | null;
  quote: { total: number; subtotal: number; discount: number; tax?: number; covered_cost: number; uncovered_cost: number } | null;
  appointment: { status: "hold" | "confirmed"; start_at: string; end_at: string } | null;
  /** Times shown to this conversation by horarios_libres in the last day. */
  offered_slots: { start_at: string; end_at: string }[];
};

export type ReviewResult = { ok: true } | { ok: false; reason: ReviewReason; message: string };

export type ReviewReason =
  | "amount_not_from_quote"
  | "confirmation_without_appointment"
  | "time_mismatch"
  | "date_mismatch"
  | "schedule_not_offered"
  | "url_not_allowed"
  | "phone_in_reply"
  | "phone_unavailable";

export const PHONE_PLACEHOLDER = "{{telefono}}";

const reject = (reason: ReviewReason, message: string): ReviewResult => ({ ok: false, reason, message });

// ---------------------------------------------------------------- amounts

const AMOUNT_BEFORE = /(?:US\$|USD|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
const AMOUNT_AFTER = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:USD|d[oó]lares?|dollars?|bucks)\b/gi;

export const findAmounts = (text: string): number[] => {
  const found: number[] = [];
  for (const pattern of [AMOUNT_BEFORE, AMOUNT_AFTER]) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1].replaceAll(",", ""));
      if (Number.isFinite(value)) found.push(value);
    }
  }
  return found;
};

const allowedAmounts = (facts: ReplyFacts): number[] => {
  const allowed: number[] = [];
  if (facts.rates) allowed.push(facts.rates.covered, facts.rates.uncovered, facts.rates.min_total);
  if (facts.quote) {
    const { total, subtotal, discount, tax, covered_cost, uncovered_cost } = facts.quote;
    allowed.push(total, subtotal, discount, covered_cost, uncovered_cost);
    // The tax is part of the total the database calculated, so the bot may say it. Quotes before the tax existed have none.
    if (typeof tax === "number" && tax > 0) allowed.push(tax);
  }
  return allowed;
};

const money = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(2));

const reviewAmounts = (text: string, facts: ReplyFacts): ReviewResult => {
  const allowed = allowedAmounts(facts);
  const stray = findAmounts(text).filter((amount) => !allowed.some((ok) => Math.abs(ok - amount) < 0.005));
  if (stray.length === 0) return { ok: true };
  const list = allowed.length ? [...new Set(allowed.map(money))].join(", ") : "ninguno todavía: usa cotizar primero";
  return reject(
    "amount_not_from_quote",
    `El monto ${stray.map(money).join(", ")} no viene de la cotización. Los montos permitidos son: ${list}. Usa cotizar para obtener los montos y copia los valores exactos.`,
  );
};

// ---------------------------------------------------------------- appointments

const CONFIRMATION_CLAIM = /\b(agendad[oa]s?|confirmad[oa]s?|scheduled|booked|confirmed)\b/i;

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const timesIn = (text: string): number[] => {
  const minutes: number[] = [];
  const to24 = (hour: number, minute: number, meridiem?: string): number | null => {
    if (minute > 59) return null;
    const mer = meridiem?.toLowerCase().replaceAll(".", "");
    if (mer) {
      if (hour < 1 || hour > 12) return null;
      return ((hour % 12) + (mer === "pm" ? 12 : 0)) * 60 + minute;
    }
    return hour > 23 ? null : hour * 60 + minute;
  };
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/gi)) {
    const value = to24(Number(match[1]), Number(match[2]), match[3]);
    if (value !== null) minutes.push(value);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/gi)) {
    const value = to24(Number(match[1]), 0, match[2]);
    if (value !== null) minutes.push(value);
  }
  return minutes;
};

type Day = { month: number; day: number };

const daysIn = (text: string): Day[][] => {
  // Each entry is the set of readings of one date: 05/06 can be May 6 or June 5.
  const found: Day[][] = [];
  const names = Object.keys(MONTHS).join("|");
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${names})\\b`, "gi"))) {
    found.push([{ month: MONTHS[match[2].toLowerCase()], day: Number(match[1]) }]);
  }
  for (const match of text.matchAll(new RegExp(`\\b(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"))) {
    found.push([{ month: MONTHS[match[1].toLowerCase()], day: Number(match[2]) }]);
  }
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.push([{ month: Number(match[2]), day: Number(match[3]) }]);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    found.push([{ month: a, day: b }, { month: b, day: a }]);
  }
  return found;
};

const weekdaysIn = (text: string): number[] => {
  const names = Object.keys(WEEKDAYS).join("|");
  return [...text.matchAll(new RegExp(`(?<![\\p{L}])(${names})(?![\\p{L}])`, "giu"))].map((m) => WEEKDAYS[m[1].toLowerCase()]);
};

type SlotTimes = { start: number; end: number };

/** A start time is always fine. An end time is fine only when the sentence also says the start ("de 10:00 a 11:00"). */
const timeAllowed = (minutes: number, mentioned: number[], slots: SlotTimes[]): boolean =>
  slots.some((slot) => slot.start === minutes || (slot.end === minutes && mentioned.includes(slot.start)));

const reviewConfirmation = (text: string, facts: ReplyFacts): ReviewResult => {
  if (!CONFIRMATION_CLAIM.test(text)) return { ok: true };
  const appointment = facts.appointment;
  if (!appointment || appointment.status !== "confirmed") {
    return reject(
      "confirmation_without_appointment",
      "No hay un horario confirmado en la base. No digas que el servicio está agendado o confirmado: ofrece horarios con horarios_libres, reserva con reservar y confirma con confirmar.",
    );
  }

  const start = localParts(appointment.start_at, facts.timezone);
  const end = localParts(appointment.end_at, facts.timezone);
  const mentioned = timesIn(text);
  const badTime = mentioned.find((minutes) => !timeAllowed(minutes, mentioned, [{ start: start.minutes, end: end.minutes }]));
  if (badTime !== undefined) {
    return reject("time_mismatch", "La hora que escribes no es la de la cita confirmada. Usa exactamente la de la ficha.");
  }
  const badDay = daysIn(text).find((readings) => !readings.some((d) => d.month === start.month && d.day === start.day));
  if (badDay) {
    return reject("date_mismatch", "La fecha que escribes no es la de la cita confirmada. Usa exactamente la de la ficha.");
  }
  if (weekdaysIn(text).some((weekday) => weekday !== start.weekday)) {
    return reject("date_mismatch", "El día de la semana que escribes no es el de la cita confirmada.");
  }
  return { ok: true };
};

// ---------------------------------------------------------------- links and phone numbers

const hostAllowed = (host: string, allowed: string[]): boolean =>
  allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));

const reviewLinks = (text: string, facts: ReplyFacts): ReviewResult => {
  const candidates = [
    ...text.matchAll(/https?:\/\/([^\s/?#)>\]"']+)/gi),
    ...text.matchAll(/(?<![\w@/.])(?:www\.)([a-z0-9.-]+\.[a-z]{2,})/gi),
    ...text.matchAll(/(?<![\w@/.-])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|app|me|ly|info|biz|us|ec))(?![\w-])/gi),
  ];
  const stray = candidates
    .map((match) => match[1].toLowerCase().replace(/^www\./, "").replace(/[.,;:!?]+$/, ""))
    .find((host) => !hostAllowed(host, facts.allowed_reply_domains));
  return stray ? reject("url_not_allowed", `No puedes enviar el enlace ${stray}. Solo se permiten los dominios de la marca.`) : { ok: true };
};

const reviewPhones = (text: string, facts: ReplyFacts): ReviewResult => {
  const withoutPlaceholder = text.replaceAll(PHONE_PLACEHOLDER, "");
  const bare = withoutPlaceholder.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [];
  if (bare.some((candidate) => candidate.replace(/\D/g, "").length >= 10)) {
    return reject(
      "phone_in_reply",
      `No escribas números de teléfono: no los tienes. Si necesitas repetirle su celular al cliente, escribe ${PHONE_PLACEHOLDER} y core-api pone el número.`,
    );
  }
  if (text.includes(PHONE_PLACEHOLDER) && !facts.phone_e164) {
    return reject("phone_unavailable", "Este cliente no tiene un número de celular conocido: pídeselo y no uses la marca del teléfono.");
  }
  return { ok: true };
};

// A sentence that talks about a service time. Dates elsewhere (issue date, validity) are not checked here.
const SCHEDULING_WORDS = /\b(servicio|cita|visita|agend\w*|horario|appointment|service|visit|schedul\w*|available|disponible)\b/i;

const sentences = (text: string): string[] => text.split(/\n+|(?<=[.!?])\s+/).filter(Boolean);

/**
 * Every clock time the bot writes must be one it was shown by horarios_libres in this conversation
 * (or the time of its own hold or appointment). Dates and weekdays are checked in the sentences that talk
 * about the service or contain a time. The bot offers times; it does not make them up or accept the customer's.
 */
const reviewSchedule = (text: string, facts: ReplyFacts): ReviewResult => {
  const allowedSlots = [...facts.offered_slots, ...(facts.appointment ? [facts.appointment] : [])];
  const allowed = allowedSlots.flatMap((slot) => [localParts(slot.start_at, facts.timezone), localParts(slot.end_at, facts.timezone)]);
  const slotTimes: SlotTimes[] = allowedSlots.map((slot) => ({
    start: localParts(slot.start_at, facts.timezone).minutes,
    end: localParts(slot.end_at, facts.timezone).minutes,
  }));
  const allowedDays = allowed.map((p) => p);

  const hint = allowedSlots.length
    ? "Los horarios permitidos son los que salieron de horarios_libres en esta conversación."
    : "Todavía no has consultado horarios_libres en esta conversación: llámalo antes de mencionar una hora.";

  for (const sentence of sentences(text)) {
    const times = timesIn(sentence);
    if (times.some((minutes) => !timeAllowed(minutes, times, slotTimes))) {
      return reject("schedule_not_offered", `Esa hora no salió de horarios_libres. ${hint}`);
    }
    if (times.length === 0 && !SCHEDULING_WORDS.test(sentence)) continue;
    const badDay = daysIn(sentence).find((readings) => !readings.some((d) => allowedDays.some((a) => a.month === d.month && a.day === d.day)));
    if (badDay) return reject("schedule_not_offered", `Esa fecha no salió de horarios_libres. ${hint}`);
    const weekdays = weekdaysIn(sentence);
    if (weekdays.some((weekday) => !allowedDays.some((a) => a.weekday === weekday))) {
      return reject("schedule_not_offered", `Ese día de la semana no salió de horarios_libres. ${hint}`);
    }
  }
  return { ok: true };
};

/** Order matters only for which reason the model sees first. Nothing here changes the text. */
export const reviewReply = (text: string, facts: ReplyFacts): ReviewResult => {
  for (const review of [reviewPhones, reviewLinks, reviewAmounts, reviewConfirmation, reviewSchedule]) {
    const result = review(text, facts);
    if (!result.ok) return result;
  }
  return { ok: true };
};
