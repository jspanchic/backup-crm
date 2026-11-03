import { useState } from "react";
import { useNotify, useRefresh, useTranslate } from "ra-core";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { Appointment } from "./AppointmentList";
import {
  cancelAppointment,
  confirmAppointment,
  errorKey,
  rescheduleAppointment,
} from "./calendarApi";
import { localParts, toTime, zonedInstant } from "./calendarTime";
import type { Technician } from "./useTechnicians";

type Step = "details" | "reschedule" | "cancel";

/** One appointment: what it is, and what staff can do with it. Every action is the database's to allow or refuse. */
export const AppointmentDialog = ({
  appointment,
  technicians,
  timezone,
  onClose,
}: {
  appointment: Appointment;
  technicians: Technician[];
  timezone: string;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const start = localParts(appointment.start_at, timezone);
  const [step, setStep] = useState<Step>("details");
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(toTime(start.minutes));
  const [technician, setTechnician] = useState(appointment.technician_id);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setWorking(true);
    setError(null);
    try {
      await action();
      notify(`resources.appointments.calendar.${done}`, { type: "info" });
      refresh();
      onClose();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setWorking(false);
    }
  };

  const open = appointment.status === "hold" || appointment.status === "confirmed";
  const name = [appointment.first_name, appointment.last_name].filter(Boolean).join(" ");

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {toTime(start.minutes)} · {name}
          </DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{translate("resources.appointments.fields.status")}</dt>
          <dd className="flex gap-1">
            <Badge variant="outline">
              {translate(`resources.appointments.status.${appointment.status}`, { _: appointment.status })}
            </Badge>
            {appointment.is_test && (
              <Badge variant="outline">{translate("resources.appointments.fields.is_test", { _: "Test" })}</Badge>
            )}
          </dd>
          <dt className="text-muted-foreground">{translate("resources.appointments.fields.contact")}</dt>
          <dd>
            <Link className="text-primary hover:underline" to={`/contacts/${appointment.contact_id}/show`}>
              {name || `#${appointment.contact_id}`}
            </Link>
          </dd>
          <dt className="text-muted-foreground">{translate("resources.appointments.fields.deal")}</dt>
          <dd>
            <Link className="text-primary hover:underline" to={`/deals/${appointment.deal_id}/show`}>
              {appointment.deal_name}
            </Link>
          </dd>
          <dt className="text-muted-foreground">{translate("resources.appointments.fields.address")}</dt>
          <dd>{appointment.address ?? "—"}</dd>
        </dl>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {translate(`resources.appointments.calendar.errors.${error}`, {
              _: translate("resources.appointments.calendar.errors.unknown"),
            })}
          </p>
        )}

        {step === "reschedule" && (
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.day")}
              <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.time")}
              <Input type="time" step={60} value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
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
          </div>
        )}
        {step === "cancel" && (
          <p className="text-sm">{translate("resources.appointments.calendar.cancel_question")}</p>
        )}

        <DialogFooter>
          {step === "details" && open && (
            <>
              {appointment.status === "hold" && (
                <Button disabled={working} onClick={() => void run(() => confirmAppointment(appointment.id), "confirmed")}>
                  {translate("resources.appointments.calendar.confirm")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setStep("reschedule")}>
                {translate("resources.appointments.calendar.reschedule")}
              </Button>
              <Button variant="destructive" onClick={() => setStep("cancel")}>
                {translate("resources.appointments.calendar.cancel")}
              </Button>
            </>
          )}
          {step === "reschedule" && (
            <>
              <Button variant="outline" onClick={() => setStep("details")}>
                {translate("ra.action.back")}
              </Button>
              <Button
                disabled={working}
                onClick={() =>
                  void run(
                    () => rescheduleAppointment(appointment.id, { technicianId: technician, startAt: zonedInstant(day, time, timezone) }),
                    "rescheduled",
                  )
                }
              >
                {translate("resources.appointments.calendar.move")}
              </Button>
            </>
          )}
          {step === "cancel" && (
            <>
              <Button variant="outline" onClick={() => setStep("details")}>
                {translate("ra.action.back")}
              </Button>
              <Button variant="destructive" disabled={working} onClick={() => void run(() => cancelAppointment(appointment.id), "cancelled")}>
                {translate("resources.appointments.calendar.cancel_confirm")}
              </Button>
            </>
          )}
          {step === "details" && !open && (
            <Button variant="outline" onClick={onClose}>
              {translate("ra.action.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
