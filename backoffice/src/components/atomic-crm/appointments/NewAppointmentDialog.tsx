import { useState } from "react";
import { useGetList, useGetMany, useNotify, useRefresh, useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Contact, Deal } from "../types";
import { bookAppointment, errorKey } from "./calendarApi";
import { zonedInstant } from "./calendarTime";
import type { Technician } from "./useTechnicians";

/** Books a time for an opportunity. The database decides whether it is allowed: this only asks. */
export const NewAppointmentDialog = ({
  technicians,
  technicianId,
  timezone,
  initial,
  onClose,
}: {
  technicians: Technician[];
  technicianId: number;
  timezone: string;
  initial: { day: string; time: string };
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [search, setSearch] = useState("");
  const [deal, setDeal] = useState<Deal | null>(null);
  const [address, setAddress] = useState("");
  const [day, setDay] = useState(initial.day);
  const [time, setTime] = useState(initial.time);
  const [technician, setTechnician] = useState(technicianId);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: deals = [] } = useGetList<Deal>(
    "deals",
    {
      filter: { q: search, "archived_at@is": null },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 6 },
    },
    { enabled: search.trim().length >= 2 && !deal },
  );

  // Several opportunities are called the same ("Nueva consulta"): the customer and the stage tell them apart.
  const { dealStages } = useConfigurationContext();
  const contactIds = deals.map((candidate) => candidate.contact_ids?.[0]).filter((id) => id != null);
  const { data: contacts = [] } = useGetMany<Contact>(
    "contacts_summary",
    { ids: contactIds },
    { enabled: contactIds.length > 0 },
  );
  const describe = (candidate: Deal) => {
    const contact = contacts.find((entry) => entry.id === candidate.contact_ids?.[0]);
    const stage = dealStages.find((entry) => entry.value === candidate.stage)?.label ?? candidate.stage;
    return [candidate.name, contact && `${contact.first_name} ${contact.last_name}`.trim(), stage].filter(Boolean).join(" · ");
  };

  const submit = async () => {
    if (!deal) return;
    setSaving(true);
    setError(null);
    try {
      await bookAppointment({
        dealId: Number(deal.id),
        technicianId: technician,
        startAt: zonedInstant(day, time, timezone),
        address,
        confirm,
      });
      notify("resources.appointments.calendar.booked", { type: "info" });
      refresh();
      onClose();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setSaving(false);
    }
  };

  const pick = (chosen: Deal) => {
    setDeal(chosen);
    setAddress(chosen.service_address ?? "");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{translate("resources.appointments.calendar.new")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {deal ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="font-medium">{describe(deal)}</span>
              <Button variant="ghost" size="sm" onClick={() => setDeal(null)}>
                {translate("resources.appointments.calendar.change_deal")}
              </Button>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                {translate("resources.appointments.fields.deal")}
                <Input
                  value={search}
                  placeholder={translate("resources.appointments.calendar.search_deal")}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <ul className="flex flex-col gap-1" aria-label={translate("resources.appointments.fields.deal")}>
                {deals.map((candidate) => (
                  <li key={candidate.id}>
                    <Button variant="outline" className="w-full justify-start" onClick={() => pick(candidate)}>
                      {describe(candidate)}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.day")}
              <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.time")}
              <Input type="time" step={60} value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            {translate("resources.appointments.fields.technician")}
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={technician}
              onChange={(event) => setTechnician(Number(event.target.value))}
            >
              {technicians.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {translate("resources.appointments.fields.address")}
            <Input value={address} onChange={(event) => setAddress(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
            {translate("resources.appointments.calendar.confirm_now")}
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {translate(`resources.appointments.calendar.errors.${error}`, {
                _: translate("resources.appointments.calendar.errors.unknown"),
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button disabled={!deal || saving} onClick={() => void submit()}>
            {translate("resources.appointments.calendar.book")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
