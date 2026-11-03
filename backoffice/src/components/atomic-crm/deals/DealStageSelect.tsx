import { useDataProvider, useNotify, useTranslate, useUpdate } from "ra-core";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";

/**
 * Moves an opportunity to another stage from its record, without opening the board. It goes to the end
 * of the new column, like a card dropped there.
 */
export const DealStageSelect = ({
  deal,
  onChanged,
}: {
  deal: Deal;
  onChanged?: (stage: string) => void;
}) => {
  const { dealStages } = useConfigurationContext();
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const [update, { isPending }] = useUpdate();

  const change = async (stage: string) => {
    if (stage === deal.stage) return;
    try {
      const { data: last } = await dataProvider.getList<Deal>("deals", {
        filter: { stage, "archived_at@is": null },
        sort: { field: "index", order: "DESC" },
        pagination: { page: 1, perPage: 1 },
        // The position must be free among all the deals of the column, the hidden test ones too.
        meta: { includeTestLeads: true },
      });
      await update(
        "deals",
        {
          id: deal.id,
          data: { stage, index: (last[0]?.index ?? -1) + 1 },
          previousData: deal,
        },
        {
          mutationMode: "pessimistic",
          onSuccess: () => {
            notify("crm.contact_deals.changed", { type: "info" });
            onChanged?.(stage);
          },
          onError: () => notify("crm.contact_deals.error", { type: "error" }),
        },
      );
    } catch {
      notify("crm.contact_deals.error", { type: "error" });
    }
  };

  return (
    <select
      aria-label={translate("crm.contact_deals.stage")}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs disabled:opacity-50"
      disabled={isPending}
      value={deal.stage}
      onChange={(event) => void change(event.target.value)}
    >
      {!dealStages.some((stage) => stage.value === deal.stage) && (
        <option value={deal.stage}>{deal.stage}</option>
      )}
      {dealStages.map((stage) => (
        <option key={stage.value} value={stage.value}>
          {stage.label}
        </option>
      ))}
    </select>
  );
};
