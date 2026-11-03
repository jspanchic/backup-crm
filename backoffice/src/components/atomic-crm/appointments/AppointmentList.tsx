import { useRecordContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { DataTable } from "@/components/admin/data-table";
import { List } from "@/components/admin/list";
import { SelectInput } from "@/components/admin/select-input";
import { Badge } from "@/components/ui/badge";

import { TopToolbar } from "../layout/TopToolbar";

export type AppointmentStatus =
  | "hold"
  | "confirmed"
  | "done"
  | "cancelled"
  | "no_show"
  | "expired";

export type Appointment = {
  id: number;
  deal_id: number;
  deal_name: string;
  contact_id: number;
  first_name: string | null;
  last_name: string | null;
  technician_id: number;
  technician_name: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  hold_expires_at: string | null;
  address: string | null;
  is_test: boolean;
};

const STATUSES: AppointmentStatus[] = ["hold", "confirmed", "done", "cancelled", "no_show", "expired"];

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  hold: "border-amber-400 text-amber-700 dark:text-amber-300",
  confirmed: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
  done: "border-slate-400 text-slate-600 dark:text-slate-300",
  cancelled: "border-red-400 text-red-700 dark:text-red-300",
  no_show: "border-red-400 text-red-700 dark:text-red-300",
  expired: "border-slate-300 text-slate-500",
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const StatusField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Appointment>();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <div className="flex flex-row flex-wrap gap-1">
      <Badge variant="outline" className={STATUS_STYLE[record.status]}>
        {translate(`resources.appointments.status.${record.status}`, { _: record.status })}
      </Badge>
      {record.is_test && (
        <Badge variant="outline" className="border-violet-400 text-violet-700 dark:text-violet-300">
          {translate("resources.appointments.fields.is_test", { _: "Test" })}
        </Badge>
      )}
    </div>
  );
};

const WhenField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Appointment>();
  if (!record) return null;
  return (
    <div className="flex flex-col">
      <span className="font-medium">{formatDateTime(record.start_at)}</span>
      {record.status === "hold" && record.hold_expires_at && (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(record.hold_expires_at)}
        </span>
      )}
    </div>
  );
};

const ContactField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Appointment>();
  if (!record) return null;
  const name = [record.first_name, record.last_name].filter(Boolean).join(" ");
  return (
    <Link to={`/contacts/${record.contact_id}/show`} className="text-primary hover:underline">
      {name || `#${record.contact_id}`}
    </Link>
  );
};

const DealField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Appointment>();
  if (!record) return null;
  return (
    <Link to={`/deals/${record.deal_id}/show`} className="text-primary hover:underline">
      {record.deal_name}
    </Link>
  );
};

const AppointmentListActions = () => <TopToolbar />;

/**
 * Read-only list of appointments. They are created by the bot (hold, confirm); editing them from the
 * panel is Delivery 2, so there is no create, edit or delete button.
 */
export const AppointmentList = () => {
  const translate = useTranslate();
  const filters = [
    <SelectInput
      key="status"
      source="status"
      alwaysOn
      emptyText="resources.appointments.filters.any_status"
      choices={STATUSES.map((status) => ({
        id: status,
        name: translate(`resources.appointments.status.${status}`, { _: status }),
      }))}
    />,
  ];

  return (
    <List
      filters={filters}
      actions={<AppointmentListActions />}
      sort={{ field: "start_at", order: "DESC" }}
      perPage={25}
      exporter={false}
    >
      <DataTable bulkActionButtons={false} rowClick={false}>
        <DataTable.Col source="start_at" label="resources.appointments.fields.start_at">
          <WhenField />
        </DataTable.Col>
        <DataTable.Col source="status" label="resources.appointments.fields.status">
          <StatusField />
        </DataTable.Col>
        <DataTable.Col source="contact_id" label="resources.appointments.fields.contact" disableSort>
          <ContactField />
        </DataTable.Col>
        <DataTable.Col source="deal_id" label="resources.appointments.fields.deal" disableSort>
          <DealField />
        </DataTable.Col>
        <DataTable.Col source="technician_name" label="resources.appointments.fields.technician" />
        <DataTable.Col source="address" label="resources.appointments.fields.address" />
      </DataTable>
    </List>
  );
};
