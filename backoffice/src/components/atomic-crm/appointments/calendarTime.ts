// Date arithmetic for the calendar, in the time zone of the brand (not the browser's): a day is a
// "YYYY-MM-DD" string, a time of day is minutes since midnight, and an instant is an ISO string.

const pad = (value: number) => String(value).padStart(2, "0");

export const MINUTES_PER_DAY = 24 * 60;

/** "09:30" -> 570 */
export const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** 570 -> "09:30" */
export const toTime = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
};

const formatDay = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const addDays = (day: string, days: number): string => {
  const date = parseDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
};

/** 0 = Sunday, like the availability windows of the database. */
export const weekdayOf = (day: string): number => parseDay(day).getUTCDay();

/** The seven days of the week that contains `day`, starting on Monday. */
export const weekOf = (day: string): string[] => {
  const sinceMonday = (weekdayOf(day) + 6) % 7;
  const monday = addDays(day, -sinceMonday);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
};

type Parts = { day: string; minutes: number };

/** The day and the time of day an instant has on the clock of `timeZone`. */
export const localParts = (iso: string, timeZone: string): Parts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return {
    day: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
};

export const todayIn = (timeZone: string, now: Date = new Date()): string =>
  localParts(now.toISOString(), timeZone).day;

/**
 * The instant at which the clock of `timeZone` reads `day` `time`. It starts from the guess that the zone is
 * UTC and corrects by what the zone really shows, twice: the second pass settles the days that change offset.
 */
export const zonedInstant = (day: string, time: string, timeZone: string): string => {
  const wanted = Date.parse(`${day}T${time}:00Z`);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const shown = localParts(new Date(guess).toISOString(), timeZone);
    const shownMs = Date.parse(`${shown.day}T${toTime(shown.minutes)}:00Z`);
    guess += wanted - shownMs;
  }
  return new Date(guess).toISOString();
};

/** The span of the week as instants, for asking the server: from the first day's midnight to the next Monday's. */
export const weekRange = (days: string[], timeZone: string): { from: string; to: string } => ({
  from: zonedInstant(days[0], "00:00", timeZone),
  to: zonedInstant(addDays(days[6], 1), "00:00", timeZone),
});

export const formatDayLabel = (day: string, locale?: string): string =>
  parseDay(day).toLocaleDateString(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
