export type LocalParts = { year: number; month: number; day: number; weekday: number; minutes: number };

export type Language = "es" | "en";

const WEEKDAY_NAMES: Record<Language, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
const MONTH_NAMES: Record<Language, string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** The date and time of an instant on the wall clock of a time zone. */
export const localParts = (iso: string, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
};

/** American style, as the sales prompt asks: 11:00 AM. */
export const clock = (minutes: number): string => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};

export const dayLabel = (parts: LocalParts, language: Language): string =>
  language === "en"
    ? `${WEEKDAY_NAMES.en[parts.weekday]}, ${MONTH_NAMES.en[parts.month - 1]} ${parts.day}, ${parts.year}`
    : `${WEEKDAY_NAMES.es[parts.weekday]} ${parts.day} de ${MONTH_NAMES.es[parts.month - 1]} de ${parts.year}`;

/** One slot as the bot reads it: "martes 4 de junio de 2030, 11:00 AM". */
export const slotLabel = (startIso: string, timeZone: string, language: Language): string => {
  const parts = localParts(startIso, timeZone);
  return `${dayLabel(parts, language)}, ${clock(parts.minutes)}`;
};

/**
 * The message the customer gets when the sale closes. Written by core-api from the appointment in the
 * database, never by the model. Copy taken from the sales prompt; the English version is an example
 * to be confirmed by JM.
 */
export const confirmationMessage = (startIso: string, timeZone: string, language: Language): string => {
  const when = slotLabel(startIso, timeZone, language);
  return language === "en"
    ? `Thank you for choosing us. Your service is now scheduled for ${when}. One of our team members may contact you to confirm a detail. Have a great day.`
    : `Gracias por elegirnos. Tu servicio ya quedó agendado para el ${when}. Es posible que yo o alguno de nuestros colaboradores te contacte para confirmar algún detalle. Que tengas un buen día.`;
};
