import { describe, expect, it } from "vitest";

import { getPendingAmount } from "./DealsChart";

describe("getPendingAmount", () => {
  it("sums open deals, including new and custom stages, without probabilities", () => {
    expect(
      getPendingAmount([
        { stage: "opportunity", amount: 100 },
        { stage: "contacted", amount: 100 },
        { stage: "assessment", amount: 100 },
        { stage: "proposal-sent", amount: 100 },
        { stage: "in-negociation", amount: 100 },
        { stage: "delayed", amount: 100 },
        { stage: "custom", amount: 75 },
        { stage: "won", amount: 200 },
        { stage: "lost", amount: 300 },
      ]),
    ).toBe(675);
  });

  it("keeps an unknown stage or invalid amount from breaking the chart", () => {
    expect(
      getPendingAmount([
        { stage: "custom", amount: 500 },
        { stage: "toString", amount: 500 },
        { stage: "assessment", amount: Number.NaN },
        { stage: "opportunity", amount: 100 },
      ]),
    ).toBe(1100);
  });
});
