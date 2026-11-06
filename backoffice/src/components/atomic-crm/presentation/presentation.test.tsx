import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ContactConversation } from "../contacts/ContactConversation";
import { getShowTestLeads } from "../providers/core-api/testLeads";
import type { Contact } from "../types";
import { AgendaPreview } from "./AgendaPreview";
import {
  isPresentationMode,
  NEXT_DELIVERY,
  PRESENTATION_DEAL_STAGES,
} from "./presentationMode";

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

  it("opens the conversation as an empty preview, without asking for any message", async () => {
    vi.stubEnv("VITE_PRESENTATION_MODE", "true");
    // No data provider around it: if it asked for messages, it would fail.
    const screen = await render(
      <ContactConversation contact={{ id: 7 } as unknown as Contact} />,
    );
    await expect
      .element(screen.getByText("Conversación de WhatsApp"))
      .toBeVisible();
  });

  it("shows the agenda as a preview, with disabled buttons and the 20/11 card", async () => {
    const screen = await render(<AgendaPreview />);
    await expect
      .element(
        screen.getByText(
          "Aquí verás las citas de cada aplicador y los horarios que ofrece Javier.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Nueva cita" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Próximamente · 20/11"))
      .toBeVisible();
    await expect.element(screen.getByText(NEXT_DELIVERY)).toBeVisible();
  });
});
