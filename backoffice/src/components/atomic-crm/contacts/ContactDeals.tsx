import { useGetList, useRecordContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { DealStageSelect } from "../deals/DealStageSelect";
import { AsideSection } from "../misc/AsideSection";
import type { Contact, Deal } from "../types";

/** The opportunities of this contact, each with its stage ready to change. */
export const ContactDeals = () => {
  const contact = useRecordContext<Contact>();
  const translate = useTranslate();
  const { data: deals } = useGetList<Deal>(
    "deals",
    {
      filter: { "contact_ids@cs": `{${contact?.id}}`, "archived_at@is": null },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 20 },
    },
    { enabled: !!contact },
  );

  if (!contact || !deals?.length) return null;
  return (
    <AsideSection title={translate("crm.contact_deals.title")}>
      <ul
        aria-label={translate("crm.contact_deals.title")}
        className="flex flex-col gap-3"
      >
        {deals.map((deal) => (
          <li key={deal.id} className="flex flex-col gap-1">
            <Link to={`/deals/${deal.id}/show`} className="font-medium">
              {deal.name}
            </Link>
            <DealStageSelect deal={deal} />
          </li>
        ))}
      </ul>
    </AsideSection>
  );
};
