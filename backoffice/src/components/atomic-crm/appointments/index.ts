import { isPresentationMode } from "../presentation/presentationMode";
import { PresentationAgenda } from "../presentation/PresentationAgenda";
import { AppointmentCalendar } from "./AppointmentCalendar";
import type { Appointment } from "./AppointmentList";

// The calendar is the way in; the read-only table is one click away. Appointments are changed from the
// calendar, through core-api, never by editing the record.
export default {
  // Presentation mode adds one card under the calendar: the zone discount, which arrives later.
  list: isPresentationMode() ? PresentationAgenda : AppointmentCalendar,
  recordRepresentation: (record: Appointment) =>
    `${record.deal_name} - ${new Date(record.start_at).toLocaleString()}`,
};