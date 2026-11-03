import type { RenderData } from "../src/documents/view.ts";

/**
 * A complete document with made-up data. The tests and `npm run docs:preview` use it, so a template is always
 * tried against every field that exists. Nothing here is a real customer.
 */
export const sampleRenderData = (overrides: Partial<RenderData> = {}, payload: Record<string, unknown> = {}): RenderData => ({
  id: 7,
  display_number: "COT-000501",
  document_type: "quote",
  is_test: false,
  status: "issued",
  issued_at: "2030-06-01T16:30:00Z",
  payload: {
    brand_name: "Salvionix",
    timezone: "America/New_York",
    customer_name: "Ana Gómez",
    deal_name: "Servicio",
    service_space_type: "home",
    service_space_size: "3 recámaras",
    service_address: "1 Main St, Orlando, FL 32801",
    quote_valid_until: "2030-06-15",
    appointment_start_at: "2030-06-03T14:00:00Z",
    appointment_end_at: "2030-06-03T15:00:00Z",
    technician_name: "Luis Pérez",
    quote_version: 2,
    covered_sqft: 1860,
    uncovered_sqft: 0,
    subtotal: 223.2,
    discount: 15.62,
    total: 207.58,
    min_applied: false,
    currency: "USD",
    price_confirmed: true,
    ...payload,
  },
  ...overrides,
});
