import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { getShowTestLeads } from "../providers/core-api/testLeads";
import {
  isPresentationMode,
  PRESENTATION_DEAL_STAGES,
} from "./presentationMode";
import { ZoneDiscountSoon } from "./ZoneDiscountSoon";

afterEach(() => vi.unstubAllEnvs());

describe("presentation mode", () => {
  it("is off unless the variable is exactly true", () => {
    expect(isPresentationMode()).toBe(false);
    vi.stubEnv("VITE_PRESENTATION_MODE", "1");
    expect(isPresentationMode()).toBe(false);
    vi.stubEnv("VITE_PRESENTATION_MODE", "true");
    expect(isPresentationMode()).toBe(true);
  });

  it("keeps the stage values the database already has", () => {
    expect(PRESENTATION_DEAL_STAGES.map((stage) => stage.label)).toEqual([
      "Nueva consulta",
      "Cotizado",
      "Agendado",
      "Ganado",
      "Perdido",
    ]);
    expect(PRESENTATION_DEAL_STAGES.map((stage) => stage.value)).toEqual([
      "opportunity",
      "proposal-sent",
      "assessment",
      "won",
      "lost",
    ]);
  });

  it("shows test leads, because the presentation data is all marked as test", () => {
    vi.stubEnv("VITE_PRESENTATION_MODE", "true");
    expect(getShowTestLeads()).toBe(true);
  });

  it("keeps the zone discount as a coming-soon card, with its date", async () => {
    const screen = await render(<ZoneDiscountSoon />);
    await expect
      .element(screen.getByText("Citas agrupadas por zona, con descuento"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Próximamente · 20/11"))
      .toBeVisible();
  });
});