import type { ConfigurationContextValue } from "./ConfigurationContext";
import { defaultConfiguration } from "./defaultConfiguration";

// Only translate untouched upstream labels. A customized label, even one
// sharing a default value, belongs to the user and must not be rewritten.
const labels = {
  companySectors: {
    "communication-services": "Servicios de comunicación",
    "consumer-discretionary": "Consumo discrecional",
    "consumer-staples": "Productos de primera necesidad",
    energy: "Energía",
    financials: "Servicios financieros",
    "health-care": "Salud",
    industrials: "Industria",
    "information-technology": "Tecnología de la información",
    materials: "Materiales",
    "real-estate": "Bienes raíces",
    utilities: "Servicios públicos",
  },
  dealStages: {
    opportunity: "Nueva consulta",
    contacted: "Contactado",
    assessment: "Evaluación del espacio",
    "proposal-sent": "Propuesta enviada",
    "in-negociation": "Seguimiento de propuesta",
    won: "Servicio contratado",
    lost: "No concretado",
    delayed: "Aplazado",
  },
  dealCategories: {
    "virus-bacteria": "Virus y bacterias",
    "food-surfaces": "Superficies en contacto con alimentos",
    "mold-fungi": "Moho y hongos",
    allergens: "Alérgenos",
    odors: "Olores",
    "air-ducts": "Aire acondicionado y ductos",
    fabrics: "Telas y tapizados",
    other: "Otro",
  },
  noteStatuses: {
    cold: "Frío",
    warm: "Templado",
    hot: "Caliente",
    "in-contract": "En contrato",
  },
  taskTypes: {
    none: "Sin tipo",
    email: "Correo electrónico",
    demo: "Demostración",
    lunch: "Almuerzo",
    meeting: "Reunión",
    "follow-up": "Seguimiento",
    "thank-you": "Agradecimiento",
    ship: "Envío",
    call: "Llamada",
    whatsapp: "Mensaje de WhatsApp",
    assessment: "Evaluar el espacio",
    quotation: "Preparar o enviar propuesta",
    appointment: "Coordinar visita",
  },
} satisfies Record<string, Record<string, string>>;

function translateLabels<T extends { value: string; label: string }>(
  items: T[],
  defaults: { value: string; label: string }[],
  translations: Record<string, string>,
): T[] {
  return items.map((item) => {
    const original = defaults.find((entry) => entry.value === item.value);
    const translated = translations[item.value];
    return original && item.label === original.label && translated
      ? { ...item, label: translated }
      : item;
  });
}

export function localizeConfiguration(config: ConfigurationContextValue) {
  return {
    ...config,
    companySectors: translateLabels(
      config.companySectors,
      defaultConfiguration.companySectors,
      labels.companySectors,
    ),
    dealStages: translateLabels(
      config.dealStages,
      defaultConfiguration.dealStages,
      labels.dealStages,
    ),
    dealCategories: translateLabels(
      config.dealCategories,
      defaultConfiguration.dealCategories,
      labels.dealCategories,
    ),
    noteStatuses: translateLabels(
      config.noteStatuses,
      defaultConfiguration.noteStatuses,
      labels.noteStatuses,
    ),
    taskTypes: translateLabels(
      config.taskTypes,
      defaultConfiguration.taskTypes,
      labels.taskTypes,
    ),
  };
}
