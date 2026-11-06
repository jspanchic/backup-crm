import { Droppable } from "@hello-pangea/dnd";
import { useListContext } from "ra-core";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { formatUsd } from "../presentation/money";
import { isPresentationMode } from "../presentation/presentationMode";
import { findDealLabel } from "./dealUtils";
import { DealCard } from "./DealCard";

export const DealColumn = ({
  stage,
  deals,
}: {
  stage: string;
  deals: Deal[];
}) => {
  const totalAmount = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const { dealStages, currency } = useConfigurationContext();
  const { data: allDeals = [] } = useListContext<Deal>();
  const everything = allDeals.reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0);
  const share = everything ? Math.round((totalAmount / everything) * 100) : 0;
  return (
    <div className="flex-1 pb-8">
      <div className="flex flex-col items-center">
        <h3 className="text-base font-medium">
          {findDealLabel(dealStages, stage)}
        </h3>
        {isPresentationMode() && stage === "opportunity" && (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Leads
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {isPresentationMode()
            ? totalAmount
              ? `${deals.length} · ${formatUsd(totalAmount)}`
              : `${deals.length}`
            : totalAmount.toLocaleString("en-US", {
                notation: "compact",
                style: "currency",
                currency,
                currencyDisplay: "narrowSymbol",
                minimumSignificantDigits: 3,
              })}
        </p>
        {isPresentationMode() && (
          <div
            className="mt-1.5 h-1 w-3/4 overflow-hidden rounded-full bg-muted"
            title={`${share}% del monto`}
            aria-label={`${share}% del monto`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
          </div>
        )}
      </div>
      <Droppable droppableId={stage}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={`flex flex-col rounded-2xl mt-2 gap-2 ${
              snapshot.isDraggingOver ? "bg-muted" : ""
            }`}
          >
            {deals.map((deal, index) => (
              <DealCard key={deal.id} deal={deal} index={index} />
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};
