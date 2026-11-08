import { useMemo, useState } from "react";
import { useGetList, useTranslate } from "ra-core";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AppointmentDialog } from "./AppointmentDialog";
import { AppointmentList, type Appointment } from "./AppointmentList";
import { AvailabilityDialog } from "./AvailabilityDialog";
import {
  MINUTES_PER_DAY,
  addDays,
  formatDayLabel,
  localParts,
  toMinutes,
  todayIn,
  weekOf,
  weekRange,
  weekdayOf,
} from "./calendarTime";
import { NewAppointmentDialog } from "./NewAppointmentDialog";
import { useTechnicians, type Technician } from "./useTechnicians";

const HOUR_PX = 48;
const SNAP_MINUTES = 30;
const DEFAULT_HOURS: [number, number] = [8, 18];

const BLOCK_STYLE: Record<string, string> = {
  hold: "border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  confirmed:
    "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  done: "border-slate-400 bg-slate-100 text-slate-700 opacity-70 dark:bg-slate-800 dark:text-slate-200",
  no_show: "border-red-400 bg-red-100 text-red-900 opacity-70 dark:bg-red-950 dark:text-red-100",
};

type Placed = { appointment: Appointment; top: number; height: number };

const availabilityOn = (technician: Technician, day: string): { start: string; end: string }[] =>
  technician.uses_dated_availability
    ? (technician.dated_availability ?? []).filter((window) => window.date === day)
    : technician.availability.filter((window) => window.weekday === weekdayOf(day));

const hoursOf = (technician: Technician, days: string[], appointments: Appointment[]): [number, number] => {
  const windows = days.flatMap((day) => availabilityOn(technician, day));
  const starts = windows.map((window) => toMinutes(window.start));
  const ends = windows.map((window) => toMinutes(window.end));
  for (const appointment of appointments) {
    const start = localParts(appointment.start_at, technician.timezone).minutes;
    starts.push(start);
    ends.push(start + (Date.parse(appointment.end_at) - Date.parse(appointment.start_at)) / 60000);
  }
  if (!starts.length) return DEFAULT_HOURS;
  return [
    Math.max(0, Math.floor(Math.min(...starts) / 60)),
    Math.min(24, Math.ceil(Math.max(...ends) / 60)),
  ];
};

export const AppointmentCalendar = () => {
  const translate = useTranslate();
  const { technicians, isPending } = useTechnicians();
  const [technicianId, setTechnicianId] = useState<number | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const technician = technicians.find((entry) => entry.id === technicianId) ?? technicians[0];
  const timezone = technician?.timezone ?? "UTC";

  const [anchor, setAnchor] = useState<string | null>(null);
  const today = todayIn(timezone);
  const days = weekOf(anchor ?? today);
  const range = weekRange(days, timezone);

  const { data: appointments = [] } = useGetList<Appointment>(
    "appointments",
    {
      filter: {
        technician_id: technician?.id,
        "start_at@gte": range.from,
        "start_at@lt": range.to,
      },
      sort: { field: "start_at", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: !!technician },
  );
  const shown = useMemo(
    () => appointments.filter((entry) => entry.status !== "cancelled" && entry.status !== "expired"),
    [appointments],
  );

  const [selected, setSelected] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<{ day: string; time: string } | null>(null);
  const [editingAvailability, setEditingAvailability] = useState(false);

  if (view === "list") {
    return (
      <div className="flex flex-col gap-3">
        <ViewToggle view={view} onChange={setView} />
        <AppointmentList />
      </div>
    );
  }

  if (!technician) {
    return (
      <div className="flex flex-col gap-3">
        <ViewToggle view={view} onChange={setView} />
        <p className="text-sm text-muted-foreground">
          {translate(isPending ? "ra.page.loading" : "resources.appointments.calendar.no_technicians")}
        </p>
      </div>
    );
  }

  const [firstHour, lastHour] = hoursOf(technician, days, shown);
  const startMinutes = firstHour * 60;
  const height = (lastHour - firstHour) * HOUR_PX;
  const px = (minutes: number) => ((minutes - startMinutes) / 60) * HOUR_PX;

  const placeOn = (day: string): Placed[] =>
    shown
      .map((appointment) => {
        const start = localParts(appointment.start_at, timezone);
        if (start.day !== day) return null;
        const length = (Date.parse(appointment.end_at) - Date.parse(appointment.start_at)) / 60000;
        return { appointment, top: px(start.minutes), height: Math.max((length / 60) * HOUR_PX, 18) };
      })
      .filter((entry): entry is Placed => entry !== null);

  const timeOffOn = (day: string) =>
    technician.time_off.flatMap((period) => {
      const from = localParts(period.from, timezone);
      const to = localParts(period.to, timezone);
      if (to.day < day || from.day > day) return [];
      const start = from.day < day ? 0 : from.minutes;
      const end = to.day > day ? MINUTES_PER_DAY : to.minutes;
      return [{ id: period.id, reason: period.reason, top: px(start), height: px(end) - px(start) }];
    });

  const open = (day: string, event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const minutes = startMinutes + ((event.clientY - box.top) / HOUR_PX) * 60;
    const snapped = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const hh = String(Math.floor(snapped / 60)).padStart(2, "0");
    const mm = String(snapped % 60).padStart(2, "0");
    setCreating({ day, time: `${hh}:${mm}` });
  };

  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ViewToggle view={view} onChange={setView} />
        <select
          aria-label={translate("resources.appointments.fields.technician")}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={technician.id}
          onChange={(event) => setTechnicianId(Number(event.target.value))}
        >
          {technicians.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={translate("resources.appointments.calendar.previous_week")}
            onClick={() => setAnchor(addDays(days[0], -7))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(null)}>
            {translate("resources.appointments.calendar.today")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={translate("resources.appointments.calendar.next_week")}
            onClick={() => setAnchor(addDays(days[0], 7))}
          >
            <ChevronRight />
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">
          {formatDayLabel(days[0])} – {formatDayLabel(days[6])} · {timezone}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setEditingAvailability(true)}>
            {translate("resources.appointments.calendar.availability")}
          </Button>
          <Button onClick={() => setCreating({ day: days.find((day) => day >= today) ?? days[0], time: "09:00" })}>
            <Plus />
            {translate("resources.appointments.calendar.new")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border" role="grid" aria-label={translate("resources.appointments.calendar.title")}>
        <div className="grid min-w-[720px]" style={{ gridTemplateColumns: "3.5rem repeat(7, minmax(0, 1fr))" }}>
          <div />
          {days.map((day) => (
            <div
              key={day}
              role="columnheader"
              className={cn("border-l px-2 py-1 text-center text-sm font-medium", day === today && "bg-primary/10")}
            >
              {formatDayLabel(day)}
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((hour) => (
              <span
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground"
                style={{ top: (hour - firstHour) * HOUR_PX + (hour === firstHour ? 8 : 0) }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day}
              role="gridcell"
              aria-label={day}
              className="relative cursor-pointer border-l"
              style={{
                height,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--border) ${HOUR_PX - 1}px, var(--border) ${HOUR_PX}px)`,
              }}
              onClick={(event) => open(day, event)}
            >
              {availabilityOn(technician, day).map((window) => (
                <div
                  key={window.start}
                  data-testid="availability"
                  className="pointer-events-none absolute inset-x-0 bg-emerald-500/10"
                  style={{ top: px(toMinutes(window.start)), height: px(toMinutes(window.end)) - px(toMinutes(window.start)) }}
                />
              ))}
              {timeOffOn(day).map((period) => (
                <div
                  key={period.id}
                  data-testid="time-off"
                  title={period.reason ?? undefined}
                  className="pointer-events-none absolute inset-x-0 bg-slate-400/30 text-xs text-slate-600"
                  style={{ top: period.top, height: period.height }}
                >
                  {period.reason}
                </div>
              ))}
              {placeOn(day).map(({ appointment, top, height: blockHeight }) => (
                <button
                  key={appointment.id}
                  type="button"
                  data-status={appointment.status}
                  className={cn(
                    "absolute inset-x-1 overflow-hidden rounded border-l-4 px-1 text-left text-xs",
                    BLOCK_STYLE[appointment.status],
                    appointment.is_test && "border-dashed",
                  )}
                  style={{ top, height: blockHeight }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected(appointment);
                  }}
                >
                  <span className="font-medium">
                    {String(Math.floor(localParts(appointment.start_at, timezone).minutes / 60)).padStart(2, "0")}:
                    {String(localParts(appointment.start_at, timezone).minutes % 60).padStart(2, "0")}
                  </span>{" "}
                  {[appointment.first_name, appointment.last_name].filter(Boolean).join(" ")}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <AppointmentDialog
          appointment={selected}
          technicians={technicians}
          timezone={timezone}
          onClose={() => setSelected(null)}
        />
      )}
      {creating && (
        <NewAppointmentDialog
          technicians={technicians}
          technicianId={technician.id}
          timezone={timezone}
          initial={creating}
          onClose={() => setCreating(null)}
        />
      )}
      {editingAvailability && (
        <AvailabilityDialog
          technician={technician}
          onClose={() => setEditingAvailability(false)}
        />
      )}
    </div>
  );
};

const ViewToggle = ({
  view,
  onChange,
}: {
  view: "calendar" | "list";
  onChange: (view: "calendar" | "list") => void;
}) => {
  const translate = useTranslate();
  return (
    <div className="inline-flex rounded-md border p-0.5" role="group">
      {(["calendar", "list"] as const).map((entry) => (
        <Button
          key={entry}
          size="sm"
          variant={view === entry ? "default" : "ghost"}
          aria-pressed={view === entry}
          onClick={() => onChange(entry)}
        >
          {translate(`resources.appointments.calendar.view_${entry}`)}
        </Button>
      ))}
    </div>
  );
};
