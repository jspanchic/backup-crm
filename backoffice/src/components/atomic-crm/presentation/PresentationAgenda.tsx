import { AppointmentCalendar } from "../appointments/AppointmentCalendar";
import { ZoneDiscountSoon } from "./ZoneDiscountSoon";

/** The agenda in presentation mode: the working calendar, plus the card of what arrives on 20/11. */
export const PresentationAgenda = () => (
  <div className="flex flex-col gap-4">
    <AppointmentCalendar />
    <div className="mt-2">
      <ZoneDiscountSoon />
    </div>
  </div>
);