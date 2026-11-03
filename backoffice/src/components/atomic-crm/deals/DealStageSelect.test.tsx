import { CoreAdminContext, type DataProvider } from "ra-core";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import type { Deal } from "../types";
import { DealStageSelect } from "./DealStageSelect";

const deal = { id: 5, name: "Nueva consulta", stage: "opportunity", index: 0 } as unknown as Deal;

const i18n = {
  translate: (key: string) => key,
  changeLocale: () => Promise.resolve(),
  getLocale: () => "es",
};

type Update = { resource: string; id: unknown; data: Record<string, unknown> };

const setup = (columnTop: number | null, options: { failUpdate?: boolean } = {}) => {
  const updates: Update[] = [];
  const lists: unknown[] = [];
  const dataProvider = {
    getList: async (_resource: string, params: { filter: unknown }) => {
      lists.push(params.filter);
      return { data: columnTop === null ? [] : [{ id: 99, index: columnTop }], total: 1 };
    },
    update: async (resource: string, params: { id: unknown; data: Record<string, unknown> }) => {
      if (options.failUpdate) throw new Error("rejected");
      updates.push({ resource, id: params.id, data: params.data });
      return { data: { ...deal, ...params.data } };
    },
  } as unknown as DataProvider;
  return { updates, lists, dataProvider };
};

const open = (dataProvider: DataProvider, onChanged?: (stage: string) => void) =>
  render(
    <CoreAdminContext dataProvider={dataProvider} i18nProvider={i18n}>
      <DealStageSelect deal={deal} onChanged={onChanged} />
    </CoreAdminContext>,
  );

describe("DealStageSelect", () => {
  it("offers every stage of the pipeline and shows the current one", async () => {
    const { dataProvider } = setup(null);
    const screen = await open(dataProvider);

    const select = screen.getByRole("combobox", { name: "crm.contact_deals.stage" });
    await expect.element(select).toHaveValue("opportunity");
    for (const label of ["Nueva consulta", "Contactado", "Servicio contratado", "No concretado"]) {
      await expect.element(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("moves the opportunity to the end of the new column", async () => {
    const { dataProvider, updates, lists } = setup(4);
    const changed: string[] = [];
    const screen = await open(dataProvider, (stage) => changed.push(stage));

    await screen.getByRole("combobox").selectOptions("proposal-sent");

    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toEqual({ resource: "deals", id: 5, data: { stage: "proposal-sent", index: 5 } });
    expect(lists[0]).toMatchObject({ stage: "proposal-sent" });
    expect(changed).toEqual(["proposal-sent"]);
  });

  it("starts the column at zero when it is empty", async () => {
    const { dataProvider, updates } = setup(null);
    const screen = await open(dataProvider);

    await screen.getByRole("combobox").selectOptions("won");

    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0].data).toEqual({ stage: "won", index: 0 });
  });

  it("does not call the server when the stage does not change", async () => {
    const { dataProvider, updates, lists } = setup(2);
    const screen = await open(dataProvider);

    await screen.getByRole("combobox").selectOptions("opportunity");

    expect(updates).toEqual([]);
    expect(lists).toEqual([]);
  });

  it("does not report a change the server refused", async () => {
    const { dataProvider, updates } = setup(2, { failUpdate: true });
    const changed: string[] = [];
    const screen = await open(dataProvider, (stage) => changed.push(stage));

    await screen.getByRole("combobox").selectOptions("lost");

    await expect.poll(() => screen.getByRole("combobox").element().hasAttribute("disabled")).toBe(false);
    expect(updates).toEqual([]);
    expect(changed).toEqual([]);
  });
});
