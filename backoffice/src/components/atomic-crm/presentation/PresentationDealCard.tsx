import { CheckSquare } from "lucide-react";
import { useGetList, useGetMany } from "ra-core";

import { CardContent } from "@/components/ui/card";

import type { Contact, Deal, Task } from "../types";
import { formatUsd } from "./money";

/** Contacts that have at least one pending task. One query shared by every card of the board. */
const usePendingTaskContacts = (): Set<number> => {
  const { data = [] } = useGetList<Task>("tasks", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "due_date", order: "ASC" },
    filter: { "done_date@is": null },
  });
  return new Set(data.map((task) => Number(task.contact_id)));
};

/** Inside of a board card in presentation mode: title, contact, amount and a pending-task icon. */
export const PresentationDealCard = ({ deal }: { deal: Deal }) => {
  const contactId = Number(
    (deal as Deal & { primary_contact_id?: number }).primary_contact_id ??
      deal.contact_ids?.[0],
  );
  const { data: contacts = [] } = useGetMany<Contact>(
    "contacts",
    { ids: [contactId] },
    { enabled: Number.isFinite(contactId) },
  );
  const contact = contacts[0];
  const hasTask = usePendingTaskContacts().has(contactId);

  return (
    <CardContent className="flex flex-col gap-1.5 px-3">
      <p className="text-sm font-medium leading-snug">{deal.name}</p>
      {contact && (
        <p className="text-xs text-muted-foreground">
          {contact.first_name} {contact.last_name}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-primary">
          {deal.amount ? formatUsd(deal.amount) : ""}
        </span>
        {hasTask && (
          <span title="Tiene una tarea pendiente" aria-label="Tarea pendiente">
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </span>
        )}
      </div>
    </CardContent>
  );
};
