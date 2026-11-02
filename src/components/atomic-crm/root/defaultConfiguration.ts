import type { ConfigurationContextValue } from "./ConfigurationContext";
// Import the logos as module assets so Vite resolves their URL relative to the
// JS chunk (import.meta.url), not the current route. A plain "./logos/..." path
// breaks on nested routes like /oauth/consent and under a deployment sub-path.
import salvionixMark from "./logos/salvionix-mark.png";

export const defaultDarkModeLogo = salvionixMark;
export const defaultLightModeLogo = salvionixMark;

export const defaultCurrency = "USD";

export const defaultTitle = "Salvionix CRM";

export const defaultCompanySectors = [
  { value: "communication-services", label: "Communication Services" },
  { value: "consumer-discretionary", label: "Consumer Discretionary" },
  { value: "consumer-staples", label: "Consumer Staples" },
  { value: "energy", label: "Energy" },
  { value: "financials", label: "Financials" },
  { value: "health-care", label: "Health Care" },
  { value: "industrials", label: "Industrials" },
  { value: "information-technology", label: "Information Technology" },
  { value: "materials", label: "Materials" },
  { value: "real-estate", label: "Real Estate" },
  { value: "utilities", label: "Utilities" },
];

export const defaultDealStages = [
  { value: "opportunity", label: "Nueva consulta" },
  { value: "contacted", label: "Contactado" },
  { value: "assessment", label: "Evaluación del espacio" },
  { value: "proposal-sent", label: "Propuesta enviada" },
  { value: "in-negociation", label: "Seguimiento de propuesta" },
  { value: "won", label: "Servicio contratado" },
  { value: "lost", label: "No concretado" },
  { value: "delayed", label: "Aplazado" },
];

export const defaultDealPipelineStatuses = ["won"];

export const defaultDealCategories = [
  { value: "virus-bacteria", label: "Virus y bacterias" },
  { value: "food-surfaces", label: "Superficies en contacto con alimentos" },
  { value: "mold-fungi", label: "Moho y hongos" },
  { value: "allergens", label: "Alérgenos" },
  { value: "odors", label: "Olores" },
  { value: "air-ducts", label: "Aire acondicionado y ductos" },
  { value: "fabrics", label: "Telas y tapizados" },
  { value: "other", label: "Otro" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Cold", color: "#7dbde8" },
  { value: "warm", label: "Warm", color: "#e8cb7d" },
  { value: "hot", label: "Hot", color: "#e88b7d" },
  { value: "in-contract", label: "In Contract", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "none", label: "Sin tipo" },
  { value: "call", label: "Llamada" },
  { value: "whatsapp", label: "Mensaje de WhatsApp" },
  { value: "email", label: "Correo electrónico" },
  { value: "assessment", label: "Evaluar el espacio" },
  { value: "quotation", label: "Preparar o enviar propuesta" },
  { value: "appointment", label: "Coordinar visita" },
  { value: "follow-up", label: "Seguimiento" },
  { value: "meeting", label: "Reunión" },
  { value: "thank-you", label: "Agradecimiento" },
  { value: "demo", label: "Demostración" },
  { value: "lunch", label: "Almuerzo" },
  { value: "ship", label: "Envío" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
