import { useState } from "react";
import { useNotify, useRefresh, useTranslate } from "ra-core";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  addTimeOff,
  errorKey,
  removeTimeOff,
  setAvailability,
  type AvailabilityWindow,
} from "./calendarApi";
import { localParts, todayIn, toTime, zonedInstant } from "./calendarTime";
import type { Technician } from "./useTechnicians";

type Window = { start: string; end: string };

/** Monday first, as the calendar shows the week. 0 is Sunday, like the database. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

// 2024-01-07 was a Sunday.
const weekdayName = (weekday: number) =>
  new Date(Date.UTC(2024, 0, 7 + weekday)).toLocaleDateString(undefined, {
    weekday: "long",
    timeZone: "UTC",
  });

const initialWindows = (technician: Technician): Record<number, Window[]> =>
  Object.fromEntries(
    WEEKDAYS.map((weekday) => [
      weekday,
      technician.availability
        .filter((window) => window.weekday === weekday)
        .map(({ start, end }) => ({ start, end })),
    ]),
  );

/** The weekly hours and the time off of one technician. Existing appointments are never touched: the answer says how many are left outside. */
export const AvailabilityDialog = ({
  technician,
  onClose,
}: {
  technician: Technician;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const [windows, setWindows] = useState(() => initialWindows(technician));
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const today = todayIn(technician.timezone);
  const [off, setOff] = useState({ fromDay: today, fromTime: "09:00", toDay: today, toTime: "17:00", reason: "" });

  const guard = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setWorking(false);
    }
  };

  const save = () =>
    guard(async () => {
      const list: AvailabilityWindow[] = WEEKDAYS.flatMap((weekday) =>
        windows[weekday].map(({ start, end }) => ({ weekday, start, end })),
      );
      const result = await setAvailability(technician.id, list);
      notify(
        result.citas_fuera
          ? translate("resources.appointments.calendar.availability_saved_outside", { smart_count: result.citas_fuera })
          : "resources.appointments.calendar.availability_saved",
        { type: result.citas_fuera ? "warning" : "info" },
      );
      refresh();
      onClose();
    });

  const addOff = () =>
    guard(async () => {
      const result = await addTimeOff(technician.id, {
        from: zonedInstant(off.fromDay, off.fromTime, technician.timezone),
        to: zonedInstant(off.toDay, off.toTime, technician.timezone),
        reason: off.reason,
      });
      notify(
        result.citas_en_conflicto
          ? translate("resources.appointments.calendar.time_off_conflicts", { smart_count: result.citas_en_conflicto })
          : "resources.appointments.calendar.time_off_added",
        { type: result.citas_en_conflicto ? "warning" : "info" },
      );
      refresh();
      onClose();
    });

  const removeOff = (id: number) =>
    guard(async () => {
      await removeTimeOff(id);
      refresh();
      onClose();
    });

  const change = (weekday: number, index: number, field: keyof Window, value: string) =>
    setWindows((current) => ({
      ...current,
      [weekday]: current[weekday].map((window, position) => (position === index ? { ...window, [field]: value } : window)),
    }));

  const format = (iso: string) => {
    const parts = localParts(iso, technician.timezone);
    return `${parts.day} ${toTime(parts.minutes)}`;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate("resources.appointments.calendar.availability")} · {technician.name}
          </DialogTitle>
        </DialogHeader>

        <section className="flex flex-col gap-2" aria-label={translate("resources.appointments.calendar.weekly_hours")}>
          <h3 className="font-semibold">{translate("resources.appointments.calendar.weekly_hours")}</h3>
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="flex flex-wrap items-center gap-2" role="group" aria-label={weekdayName(weekday)}>
              <span className="w-28 text-sm capitalize">{weekdayName(weekday)}</span>
              {windows[weekday].length === 0 && (
                <span className="text-sm text-muted-foreground">{translate("resources.appointments.calendar.not_available")}</span>
              )}
              {windows[weekday].map((window, index) => (
                <span key={index} className="flex items-center gap-1">
                  <Input
                    type="time"
                    className="w-28"
                    aria-label={`${weekdayName(weekday)} ${translate("resources.appointments.calendar.from")}`}
                    value={window.start}
                    onChange={(event) => change(weekday, index, "start", event.target.value)}
                  />
                  –
                  <Input
                    type="time"
                    className="w-28"
                    aria-label={`${weekdayName(weekday)} ${translate("resources.appointments.calendar.to")}`}
                    value={window.end}
                    onChange={(event) => change(weekday, index, "end", event.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={translate("ra.action.delete")}
                    onClick={() => setWindows((current) => ({ ...current, [weekday]: current[weekday].filter((_, position) => position !== index) }))}
                  >
                    <Trash2 />
                  </Button>
                </span>
              ))}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${translate("resources.appointments.calendar.add_window")} ${weekdayName(weekday)}`}
                onClick={() => setWindows((current) => ({ ...current, [weekday]: [...current[weekday], { start: "09:00", end: "17:00" }] }))}
              >
                <Plus />
              </Button>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-2" aria-label={translate("resources.appointments.calendar.time_off")}>
          <h3 className="font-semibold">{translate("resources.appointments.calendar.time_off")}</h3>
          <ul className="flex flex-col gap-1">
            {technician.time_off.map((period) => (
              <li key={period.id} className="flex items-center justify-between rounded-md border px-3 py-1 text-sm">
                <span>
                  {format(period.from)} → {format(period.to)}
                  {period.reason ? ` · ${period.reason}` : ""}
                </span>
                <Button variant="ghost" size="icon" aria-label={translate("ra.action.delete")} disabled={working} onClick={() => void removeOff(period.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.from")}
              <span className="flex gap-1">
                <Input type="date" value={off.fromDay} onChange={(event) => setOff({ ...off, fromDay: event.target.value })} />
                <Input type="time" value={off.fromTime} onChange={(event) => setOff({ ...off, fromTime: event.target.value })} />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {translate("resources.appointments.calendar.to")}
              <span className="flex gap-1">
                <Input type="date" value={off.toDay} onChange={(event) => setOff({ ...off, toDay: event.target.value })} />
                <Input type="time" value={off.toTime} onChange={(event) => setOff({ ...off, toTime: event.target.value })} />
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder={translate("resources.appointments.calendar.reason")}
              value={off.reason}
              onChange={(event) => setOff({ ...off, reason: event.target.value })}
            />
            <Button variant="outline" disabled={working} onClick={() => void addOff()}>
              {translate("resources.appointments.calendar.add_time_off")}
            </Button>
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {translate(`resources.appointments.calendar.errors.${error}`, {
              _: translate("resources.appointments.calendar.errors.unknown"),
            })}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.close")}
          </Button>
          <Button disabled={working} onClick={() => void save()}>
            {translate("resources.appointments.calendar.save_availability")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
