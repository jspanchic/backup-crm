import { useGetList, useListContext } from "ra-core";
import { Link } from "react-router";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Deal } from "../types";

// Two list views for the presentation: name, city, phone, opportunities and last activity. Read only: they show what
// the list already loaded, plus the opportunities, which are counted from the database.

type Row = Record<string, any> & { id: number };

const shortDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
        new Date(value),
      )
    : "—";

const useDeals = () =>
  useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "created_at", order: "DESC" },
    filter: { "archived_at@is": null },
  }).data ?? [];

const Head = ({ labels }: { labels: string[] }) => (
  <TableHeader>
    <TableRow>
      {labels.map((label) => (
        <TableHead key={label} className="text-xs uppercase tracking-wide">
          {label}
        </TableHead>
      ))}
    </TableRow>
  </TableHeader>
);

export const ContactsTable = () => {
  const { data = [] } = useListContext<Row>();
  const deals = useDeals();
  const dealsOf = (id: number) =>
    deals.filter(
      (deal) =>
        Number((deal as Row).primary_contact_id) === Number(id) ||
        deal.contact_ids?.map(Number).includes(Number(id)),
    );

  return (
    <Card className="py-0">
      <Table>
        <Head
          labels={["Nombre", "Ciudad", "Teléfono", "Oportunidades", "Última actividad"]}
        />
        <TableBody>
          {data.map((contact) => {
            const own = dealsOf(contact.id);
            const city =
              contact.background ||
              own.find((deal) => deal.service_address)?.service_address ||
              "—";
            return (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">
                  <Link to={`/contacts/${contact.id}/show`} className="hover:underline">
                    {contact.first_name} {contact.last_name}
                  </Link>
                  {contact.company_name && (
                    <div className="text-xs font-normal text-muted-foreground">
                      {contact.company_name}
                    </div>
                  )}
                </TableCell>
                <TableCell>{city}</TableCell>
                <TableCell>
                  {contact.phone_jsonb?.find((phone: Record<string, any>) => phone.number)?.number ?? "—"}
                </TableCell>
                <TableCell>{own.length}</TableCell>
                <TableCell>{shortDate(contact.last_seen)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
};

export const CompaniesTable = () => {
  const { data = [] } = useListContext<Row>();
  const deals = useDeals();
  const dealsOf = (id: number) =>
    deals.filter((deal) => Number(deal.company_id) === Number(id));

  return (
    <Card className="py-0">
      <Table>
        <Head
          labels={["Nombre", "Ciudad", "Teléfono", "Oportunidades", "Última actividad"]}
        />
        <TableBody>
          {data.map((company) => {
            const own = dealsOf(company.id);
            const latest = own
              .map((deal) => deal.updated_at)
              .sort()
              .at(-1);
            return (
              <TableRow key={company.id}>
                <TableCell className="font-medium">
                  <Link to={`/companies/${company.id}/show`} className="hover:underline">
                    {company.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {[company.city, company.state_abbr].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell>{company.phone_number || "—"}</TableCell>
                <TableCell>{company.nb_deals ?? own.length}</TableCell>
                <TableCell>{shortDate(latest ?? company.created_at)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
};
