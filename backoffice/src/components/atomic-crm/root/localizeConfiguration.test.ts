import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./defaultConfiguration";
import { localizeConfiguration } from "./localizeConfiguration";

describe("localizeConfiguration", () => {
  it("translates standard labels without changing identifiers or source configuration", () => {
    const localized = localizeConfiguration(defaultConfiguration);
    expect(localized.dealStages[0]).toEqual({
      value: "opportunity",
      label: "Nueva consulta",
    });
    expect(defaultConfiguration.dealStages[0].label).toBe("Nueva consulta");
    expect(localized.noteStatuses[0].color).toBe(
      defaultConfiguration.noteStatuses[0].color,
    );
  });

  it("keeps custom labels and values as entered", () => {
    const custom = {
      ...defaultConfiguration,
      dealStages: [
        { value: "opportunity", label: "Prospectos nuevos" },
        { value: "custom", label: "Mi etapa" },
      ],
    };
    expect(localizeConfiguration(custom).dealStages).toEqual(custom.dealStages);
  });
});
