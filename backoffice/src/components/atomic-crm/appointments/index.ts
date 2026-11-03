import { AppointmentList, type Appointment } from "./AppointmentList";

// Read only: there is no create, edit or show page.
export default {
  list: AppointmentList,
  recordRepresentation: (record: Appointment) =>
    `${record.deal_name} - ${new Date(record.start_at).toLocaleString()}`,
};
