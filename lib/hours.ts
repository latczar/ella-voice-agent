// Business-hours logic for the check_hours tool. Pure functions, no network.
// Times are worked out in the client's timezone, so the server's own timezone never matters.

import type { Day, WeekSchedule } from "./config";

const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES: Record<Day, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

export interface HoursResult {
  open: boolean;
  /** Spoken-friendly, e.g. "Monday at 7 AM". Null when always open. */
  nextOpen: string | null;
  /** Local time used for the decision, e.g. "Saturday 2:05 PM". */
  localTime: string;
}

/** Day of week and minutes since midnight in the given timezone. */
function localParts(now: Date, timezone: string): { day: Day; minutes: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as Day;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const label = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(now);
  return { day, minutes, label };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function spokenTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 || h === 24 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function checkHours(schedule: WeekSchedule, timezone: string, now: Date = new Date()): HoursResult {
  const { day, minutes, label } = localParts(now, timezone);
  const today = schedule[day];

  if (Object.values(schedule).every((s) => s === "24h")) return { open: true, nextOpen: null, localTime: label };

  let open = false;
  if (today === "24h") open = true;
  else if (today !== "closed") {
    const [start, end] = today.split("-");
    open = minutes >= toMinutes(start) && minutes < toMinutes(end);
  }
  if (open) return { open, nextOpen: null, localTime: label };

  // Find the next opening: later today, then the following seven days.
  const todayIndex = DAYS.indexOf(day);
  for (let offset = 0; offset <= 7; offset++) {
    const d = DAYS[(todayIndex + offset) % 7];
    const span = schedule[d];
    if (span === "closed") continue;
    const start = span === "24h" ? "00:00" : span.split("-")[0];
    if (offset === 0 && toMinutes(start) <= minutes) continue;
    const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_NAMES[d];
    return { open: false, nextOpen: `${when} at ${spokenTime(start)}`, localTime: label };
  }
  return { open: false, nextOpen: null, localTime: label };
}
