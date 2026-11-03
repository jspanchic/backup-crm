import { useGetList } from "ra-core";

import type { AvailabilityWindow } from "./calendarApi";

export type TimeOff = {
  id: number;
  from: string;
  to: string;
  reason: string | null;
};

export type Technician = {
  id: number;
  brand_id: number;
  name: string;
  active: boolean;
  /** The time zone of the brand: the calendar is drawn on its clock, not the browser's. */
  timezone: string;
  availability: (AvailabilityWindow & { id: number })[];
  time_off: TimeOff[];
};

export const useTechnicians = () => {
  const { data, isPending, error } = useGetList<Technician>(
    "technicians_summary",
    {
      filter: { active: true },
      sort: { field: "name", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
    },
  );
  return { technicians: data ?? [], isPending, error };
};
