// Event creation — DATES UP FRONT, on the existing date model.
//
// Findmi already stores an Event's schedule as its Primary Date
// (events.start_at / end_at) plus event_occurrences for every other date,
// and Event Manager's bulkGenerateEventDates already turns "a date range"
// or "these dates" into concrete occurrence rows (deduplicated by calendar
// day, authoritative server-side). Creation reuses exactly that:
//
//   single    one start / end — the unchanged start_at / end_at fields.
//   range     consecutive days with the same daily hours: the first day is
//             the Primary Date, every other day an occurrence.
//   multiple  separately scheduled dates: the earliest is the Primary
//             Date, the rest occurrences.
//
// No second date model, no recurrence rule stored. Pure and dependency-free
// apart from lib/schedule-dates (tests/event-ux-corrections.test.mjs).

import { MAX_BULK_GENERATED_DATES, enumerateCalendarDates, resolveEndDateForTimes } from "./schedule-dates";

export type CreateScheduleMode = "single" | "range" | "multiple";
export const CREATE_SCHEDULE_MODES: readonly { key: CreateScheduleMode; label: string; hint: string }[] = [
  { key: "single", label: "Single Date", hint: "One start and end." },
  { key: "range", label: "Date Range", hint: "Consecutive days, same hours each day." },
  { key: "multiple", label: "Multiple Dates", hint: "Separate dates, each with its own hours." },
];

export const isCreateScheduleMode = (v: unknown): v is CreateScheduleMode => v === "single" || v === "range" || v === "multiple";

export interface ScheduleDate {
  date: string;
  start_time: string;
  end_time: string;
}

export type CreateScheduleResult =
  | { ok: true; primary: { startLocal: string; endLocal: string }; extraDates: ScheduleDate[] }
  | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validDate(d: ScheduleDate): string | null {
  if (!DATE_RE.test(d.date) || !TIME_RE.test(d.start_time) || !TIME_RE.test(d.end_time)) return "Every date needs a date, start time and end time.";
  if (d.start_time === d.end_time) return "Start and end time can't be the same.";
  return null;
}

const primaryOf = (d: ScheduleDate) => ({ startLocal: `${d.date}T${d.start_time}`, endLocal: `${resolveEndDateForTimes(d.date, d.start_time, d.end_time)}T${d.end_time}` });

/** Parses the client's multiple-dates JSON defensively (bounded). */
export function parseScheduleDates(raw: string | null | undefined): ScheduleDate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_BULK_GENERATED_DATES)
      .filter((x): x is ScheduleDate => Boolean(x) && typeof x === "object" && typeof (x as ScheduleDate).date === "string" && typeof (x as ScheduleDate).start_time === "string" && typeof (x as ScheduleDate).end_time === "string")
      .map((x) => ({ date: x.date, start_time: x.start_time, end_time: x.end_time }));
  } catch {
    return [];
  }
}

/** The Primary Date + extra occurrence dates for a non-single schedule. */
export function resolveCreateSchedule(
  mode: Exclude<CreateScheduleMode, "single">,
  input: { rangeStart?: string | null; rangeEnd?: string | null; dailyStart?: string | null; dailyEnd?: string | null; dates?: ScheduleDate[] }
): CreateScheduleResult {
  let dates: ScheduleDate[];
  if (mode === "range") {
    const { rangeStart, rangeEnd, dailyStart, dailyEnd } = input;
    if (!rangeStart || !rangeEnd || !dailyStart || !dailyEnd) return { ok: false, error: "Choose the first day, last day and daily hours." };
    if (rangeEnd <= rangeStart) return { ok: false, error: "The last day must be after the first day — use Single Date for one day." };
    const days = enumerateCalendarDates(rangeStart, rangeEnd);
    if (days.length > MAX_BULK_GENERATED_DATES) return { ok: false, error: `A range can cover at most ${MAX_BULK_GENERATED_DATES} days.` };
    dates = days.map((date) => ({ date, start_time: dailyStart, end_time: dailyEnd }));
  } else {
    // Sorted, ONE per calendar day — the same rule bulkGenerateEventDates
    // enforces (a second session on the same day is added in Event Manager
    // with Add a Date).
    const seen = new Set<string>();
    dates = [...(input.dates ?? [])]
      .sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`))
      .filter((d) => {
        if (seen.has(d.date)) return false;
        seen.add(d.date);
        return true;
      });
    if (dates.length < 2) return { ok: false, error: "Add at least two dates — or use Single Date." };
    if (dates.length > MAX_BULK_GENERATED_DATES) return { ok: false, error: `You can add at most ${MAX_BULK_GENERATED_DATES} dates at once.` };
  }
  for (const d of dates) {
    const problem = validDate(d);
    if (problem) return { ok: false, error: problem };
  }
  const [first, ...rest] = dates;
  return { ok: true, primary: primaryOf(first), extraDates: rest };
}
