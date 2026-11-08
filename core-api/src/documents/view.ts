import type { View } from "./template.ts";

export type DocumentType = "quote" | "purchase_order" | "work_order";
export const DOCUMENT_TYPES: readonly DocumentType[] = ["quote", "purchase_order", "work_order"];

/** What api.document_render_data returns: the numbered record and its frozen payload. */
export type RenderData = {
  id: number;
  display_number: string;
  document_type: DocumentType;
  is_test: boolean;
  status: string;
  issued_at: string;
  payload: Record<string, unknown>;
};

/** templates/settings.json: the legal data and texts JM owns, and the switch that lets real customers receive PDFs. */
export type Settings = {
  confirmed: boolean;
  template_version: string;
  captions: Record<DocumentType, string>;
  legal: Record<string, string>;
};

const TYPE_LABELS: Record<DocumentType, string> = {
  quote: "Cotización",
  purchase_order: "Orden de compra",
  work_order: "Orden de trabajo",
};

const SPACE_TYPES: Record<string, string> = {
  home: "Hogar",
  office_warehouse: "Oficina o bodega",
  restaurant_kitchen: "Restaurante o cocina",
  clinic: "Clínica o consultorio",
  veterinary: "Veterinaria o espacio para mascotas",
  gym: "Gimnasio",
  school_daycare: "Escuela o guardería",
  hotel_rental: "Hotel o alquiler",
  other: "Otro",
};

const LOCALE = "es-US";
const MISSING = "—";

const text = (value: unknown): string => (value === null || value === undefined || value === "" ? MISSING : String(value));
const number = (value: unknown): number | null => (typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : null);

const money = (value: unknown, currency: string): string => {
  const amount = number(value);
  return amount === null ? MISSING : new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(amount);
};

const instant = (value: unknown, timeZone: string, options: Intl.DateTimeFormatOptions): string => {
  if (typeof value !== "string") return MISSING;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? MISSING : new Intl.DateTimeFormat(LOCALE, { timeZone, ...options }).format(date);
};

/**
 * Everything a template can print, already formatted. Templates only see this object, so a field that is
 * not listed in docs/PLANTILLAS_PDF.md cannot be used. It reads the frozen payload and nothing else:
 * rendering a document again later shows what the customer was told on the day it was issued.
 */
export const buildView = (data: RenderData, settings: Settings): View => {
  const p = data.payload;
  const zone = typeof p.timezone === "string" ? p.timezone : "UTC";
  const currency = typeof p.currency === "string" ? p.currency : "USD";
  const date = { dateStyle: "long" } as const;
  const time = { timeStyle: "short" } as const;
  const validUntil = typeof p.quote_valid_until === "string" ? `${p.quote_valid_until}T12:00:00Z` : null;
  // A discount row is printed only when the brand had the discount on and it took something off. Older quotes have no flag.
  const discountShown = p.discount_applied !== false && (number(p.discount) ?? 0) > 0;
  const percent = (value: unknown) => `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(number(value) ?? 0)}%`;
  const sqft = (value: unknown) => {
    const n = number(value);
    return n === null ? MISSING : `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(n)} ft²`;
  };

  return {
    document: {
      number: data.display_number,
      type: TYPE_LABELS[data.document_type],
      issued_date: instant(data.issued_at, zone, date),
      // Test leads get a visible mark so a test document can never be mistaken for a real one.
      test_notice: data.is_test ? "DOCUMENTO DE PRUEBA — SIN VALOR" : "",
    },
    brand: { name: text(p.brand_name) },
    customer: { name: text(p.customer_name) },
    service: {
      space_type: typeof p.service_space_type === "string" ? (SPACE_TYPES[p.service_space_type] ?? p.service_space_type) : MISSING,
      address: text(p.service_address),
      space_size: text(p.service_space_size),
    },
    appointment: {
      date: instant(p.appointment_start_at, zone, date),
      start_time: instant(p.appointment_start_at, zone, time),
      end_time: instant(p.appointment_end_at, zone, time),
      technician: text(p.technician_name),
    },
    quote: {
      version: text(p.quote_version),
      valid_until: validUntil ? instant(validUntil, "UTC", date) : MISSING,
      // Hides the validity line when the quote has no date.
      valid_class: validUntil ? "" : "hidden",
      covered_area: sqft(p.covered_sqft),
      uncovered_area: sqft(p.uncovered_sqft),
      // The whole measured area in one figure, for the highlighted block of the quote.
      total_area: sqft((number(p.covered_sqft) ?? 0) + (number(p.uncovered_sqft) ?? 0)),
      subtotal: money(p.subtotal, currency),
      discount: discountShown ? money(-(number(p.discount) ?? 0), currency) : MISSING,
      // The templates have no conditions: this class hides the discount row when the brand has the discount off.
      discount_class: discountShown ? "" : "hidden",
      tax_label: `Impuesto (${percent(p.tax_pct)})`,
      tax: money(p.tax ?? 0, currency),
      total: money(p.total, currency),
      minimum_note: p.min_applied === true ? "Se aplicó el cargo mínimo del servicio." : "",
      price_note: p.price_confirmed === true ? "" : "Precios por confirmar.",
    },
    legal: settings.legal,
  };
};

/** The sentence that goes with the file in WhatsApp. */
export const captionFor = (data: Pick<RenderData, "document_type" | "display_number">, settings: Settings): string =>
  settings.captions[data.document_type].replaceAll("{{number}}", data.display_number);
