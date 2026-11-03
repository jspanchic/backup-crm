import { HttpError } from "ra-core";

import { getCoreApiUrl, httpClient } from "../providers/core-api/httpClient";

// The calendar writes through core-api's own routes (/admin/agenda/*): the rules (no clashes, a hold first,
// one booking at a time) are in the database, and a refusal comes back as { error, reason }.

export type AppointmentResult = {
  id: number;
  estado: "hold" | "confirmed" | "cancelled";
  tecnico_id: number;
  inicio: string;
  fin: string;
  vence_en: string | null;
  reemplaza?: number;
};

export type AvailabilityWindow = { weekday: number; start: string; end: string };

const post = async <T>(path: string, body: unknown = {}): Promise<T> => {
  const { json } = await httpClient(`${getCoreApiUrl()}/admin/agenda/${path}`, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return json as T;
};

export const bookAppointment = (input: {
  dealId: number;
  technicianId: number;
  startAt: string;
  address: string;
  confirm: boolean;
}) =>
  post<AppointmentResult>("appointments", {
    deal_id: input.dealId,
    technician_id: input.technicianId,
    start_at: input.startAt,
    address: input.address || null,
    confirm: input.confirm,
  });

export const confirmAppointment = (id: number) =>
  post<AppointmentResult>(`appointments/${id}/confirm`);

export const cancelAppointment = (id: number) =>
  post<AppointmentResult>(`appointments/${id}/cancel`);

export const rescheduleAppointment = (
  id: number,
  input: { technicianId: number; startAt: string },
) =>
  post<AppointmentResult>(`appointments/${id}/reschedule`, {
    technician_id: input.technicianId,
    start_at: input.startAt,
  });

export const setAvailability = (
  technicianId: number,
  windows: AvailabilityWindow[],
) =>
  post<{ ventanas: number; citas_fuera: number }>(
    `technicians/${technicianId}/availability`,
    { windows },
  );

export const addTimeOff = (
  technicianId: number,
  input: { from: string; to: string; reason: string },
) =>
  post<{ id: number; citas_en_conflicto: number }>(
    `technicians/${technicianId}/time-off`,
    { from: input.from, to: input.to, reason: input.reason || null },
  );

export const removeTimeOff = async (id: number) => {
  await httpClient(`${getCoreApiUrl()}/admin/agenda/time-off/${id}`, {
    method: "DELETE",
  });
};

/**
 * The key of the message that explains a refusal, under resources.appointments.calendar.errors. It is
 * the reason the database gave when there is one, else the kind of error; anything unknown is "unknown".
 */
export const errorKey = (error: unknown): string => {
  if (error instanceof HttpError) {
    const body = error.body as { error?: string; reason?: string } | undefined;
    return body?.reason ?? body?.error ?? "unknown";
  }
  return "unknown";
};
