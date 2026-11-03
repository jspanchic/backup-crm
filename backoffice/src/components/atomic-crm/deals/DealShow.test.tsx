import {
  CoreAdminContext,
  ResourceContextProvider,
  type DataProvider,
} from "ra-core";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { Deal } from "../types";
import { DealShow } from "./DealShow";

const i18n = {
  translate: (key: string) => key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

// A deal created by the bot: it has a stage and an amount, but no expected closing date.
const botDeal = {
  id: 5,
  name: "Nueva consulta",
  stage: "proposal-sent",
  amount: 208,
  index: 0,
  contact_ids: [],
  expected_closing_date: null,
  created_at: "2026-11-03T17:00:00Z",
} as unknown as Deal;

const open = (deal: Deal) => {
  const dataProvider = {
    getOne: async () => ({ data: deal }),
    getList: async () => ({ data: [], total: 0 }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
  } as unknown as DataProvider;
  return render(
    <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18n}>
      <ResourceContextProvider value="deals">
        <DealShow open id="5" />
      </ResourceContextProvider>
    </CoreAdminContext>,
  );
};

describe("DealShow", () => {
  it("opens a deal that was not quoted yet, with no amount", async () => {
    const screen = await open({ ...botDeal, amount: null } as unknown as Deal);

    await expect
      .element(screen.getByText("Nueva consulta").first())
      .toBeInTheDocument();
    await expect.element(screen.getByText("$0.00")).toBeInTheDocument();
  });

  it("opens a deal that has no expected closing date instead of failing", async () => {
    const screen = await open(botDeal);

    await expect
      .element(screen.getByText("Nueva consulta").first())
      .toBeInTheDocument();
    await expect.element(screen.getByText("—")).toBeInTheDocument();
    await expect
      .element(screen.getByText("crm.common.past"))
      .not.toBeInTheDocument();
  });
});
