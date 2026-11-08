/**
 * Presentation mode (VITE_PRESENTATION_MODE=true, off by default). The panel shows what works with test data. Read at
 * call time so a test can change it.
 */
export const isPresentationMode = (): boolean =>
  import.meta.env.VITE_PRESENTATION_MODE === "true";

/** The deal stages of the presentation, in order. Values are the ones the database already has. */
export const PRESENTATION_DEAL_STAGES = [
  { value: "opportunity", label: "Nueva consulta" },
  { value: "proposal-sent", label: "Cotizado" },
  { value: "assessment", label: "Agendado" },
  { value: "won", label: "Ganado" },
  { value: "lost", label: "Perdido" },
];

