import { describe, expect, it } from "vitest";

import {
  addDays,
  localParts,
  toMinutes,
  toTime,
  todayIn,
  weekOf,
  weekRange,
  weekdayOf,
  zonedInstant,
} from "./calendarTime";

const NEW_YORK = "America/New_York";

describe("calendar time", () => {
  describe("days and weeks", () => {
    it("starts the week on Monday and ends it on Sunday", () => {
      // 2026-11-04 is a Wednesday.
      expect(weekOf("2026-11-04")).toEqual([
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
        "2026-11-08",
      ]);
    });

    it("keeps a Sunday in the week that ends with it", () => {
      expect(weekOf("2026-11-08")[0]).toBe("2026-11-02");
      expect(weekOf("2026-11-09")[0]).toBe("2026-11-09");
    });

    it("crosses months and years", () => {
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
      expect(weekOf("2027-01-01")[0]).toBe("2026-12-28");
    });

    it("numbers weekdays like the database: 0 is Sunday", () => {
      expect(weekdayOf("2026-11-08")).toBe(0);
      expect(weekdayOf("2026-11-02")).toBe(1);
    });

    it("converts times of day both ways", () => {
      expect(toMinutes("09:30")).toBe(570);
      expect(toTime(570)).toBe("09:30");
      expect(toTime(0)).toBe("00:00");
    });
  });

  describe("the clock of the brand, not the browser's", () => {
    it("reads an instant on the clock of the zone", () => {
      // 15:00 UTC is 10:00 in New York in winter and 11:00 in summer.
      expect(localParts("2026-11-05T15:00:00Z", NEW_YORK)).toEqual({ day: "2026-11-05", minutes: 600 });
      expect(localParts("2026-07-05T15:00:00Z", NEW_YORK)).toEqual({ day: "2026-07-05", minutes: 660 });
    });

    it("puts an evening instant on the previous day of a western zone", () => {
      expect(localParts("2026-11-05T02:30:00Z", NEW_YORK)).toEqual({ day: "2026-11-04", minutes: 21 * 60 + 30 });
    });

    it("knows what day it is there, which can differ from here", () => {
      expect(todayIn(NEW_YORK, new Date("2026-11-05T02:30:00Z"))).toBe("2026-11-04");
      expect(todayIn("UTC", new Date("2026-11-05T02:30:00Z"))).toBe("2026-11-05");
    });

    it("turns a time on the wall of the zone into the right instant, in winter and in summer", () => {
      expect(zonedInstant("2026-11-05", "10:00", NEW_YORK)).toBe("2026-11-05T15:00:00.000Z");
      expect(zonedInstant("2026-07-05", "10:00", NEW_YORK)).toBe("2026-07-05T14:00:00.000Z");
    });

    it("gives back the same time it was given, through any day of the year", () => {
      for (const day of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"]) {
        for (const time of ["00:00", "01:30", "09:00", "12:00", "23:30"]) {
          const instant = zonedInstant(day, time, NEW_YORK);
          const back = localParts(instant, NEW_YORK);
          // 02:00 on 2026-03-08 does not exist in New York: it is not in this list.
          expect({ day: back.day, time: toTime(back.minutes) }).toEqual({ day, time });
        }
      }
    });

    it("is not 168 hours long the week the clocks go back", () => {
      // 2026-11-01 is the Sunday on which New York goes back one hour.
      const { from, to } = weekRange(weekOf("2026-10-28"), NEW_YORK);
      expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(169);
      expect(localParts(from, NEW_YORK)).toEqual({ day: "2026-10-26", minutes: 0 });
      expect(localParts(to, NEW_YORK)).toEqual({ day: "2026-11-02", minutes: 0 });
    });
  });
});
