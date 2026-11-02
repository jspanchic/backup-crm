import { describe, expect, it } from "vitest";
import { defaultConfiguration } from "./defaultConfiguration";
import { adaptLegacyConfiguration } from "./adaptLegacyConfiguration";

describe("adaptLegacyConfiguration", () => {
  it("upgrades untouched old stages while preserving existing identifiers", () => {
    const oldStages = [
      { value: "opportunity", label: "Opportunity" },
      { value: "proposal-sent", label: "Proposal Sent" },
      { value: "in-negociation", label: "In Negotiation" },
      { value: "won", label: "Won" },
      { value: "lost", label: "Lost" },
      { value: "delayed", label: "Delayed" },
    ];
    const config = { ...defaultConfiguration, dealStages: oldStages };
    const result = adaptLegacyConfiguration(config);
    expect(result.dealStages.map((stage) => stage.value)).toEqual([
      "opportunity",
      "contacted",
      "assessment",
      "proposal-sent",
      "in-negociation",
      "won",
      "lost",
      "delayed",
    ]);
    expect(config.dealStages).toEqual(oldStages);
  });

  it("does not overwrite a customized pipeline", () => {
    const stages = [{ value: "opportunity", label: "Mi propio proceso" }];
    expect(
      adaptLegacyConfiguration({ ...defaultConfiguration, dealStages: stages })
        .dealStages,
    ).toEqual(stages);
  });
});
