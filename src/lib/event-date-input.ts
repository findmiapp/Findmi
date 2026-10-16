/** Event date/time precision — the ONE parser for the Admin Event editor's
 * submitted dates (pure; unit-tested). The calendar DATE is required data;
 * the exact start / end are optional precision on it:
 *
 *   date + start + end  → valid (end must follow start)
 *   date + start        → valid (no end: never defaulted)
 *   date only           → valid (no times: never defaulted)
 *   end without start   → rejected (a start is never guessed)
 *   no date             → rejected
 *
 * Inputs are the editor's wall-clock values ("YYYY-MM-DDTHH:MM" /
 * "YYYY-MM-DD"); instants are converted in the given timezone. */

import { DEFAULT_ADMIN_TIMEZONE, localDateTimeToIso } from "./admin/form-helpers";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

type Fail = { ok: false; error: string };

export function parseOccurrenceDateTimes(input: {
  date: string | null | undefined;
  startLocal: string | null | undefined;
  endLocal: string | null | undefined;
  timezone?: string | null;
}): { ok: true; date: string; startIso: string | null; endIso: string | null } | Fail {
  const tz = input.timezone || DEFAULT_ADMIN_TIMEZONE;
  const startLocal = (input.startLocal ?? "").trim();
  const endLocal = (input.endLocal ?? "").trim();
  // A known start decides the date (its own local day); otherwise the
  // submitted date is authoritative.
  const date = LOCAL.test(startLocal) ? startLocal.slice(0, 10) : (input.date ?? "").trim();
  if (!DATE.test(date)) return { ok: false, error: "Each date needs a day." };
  if (endLocal && !startLocal) return { ok: false, error: "An end time needs a start time. Add the start, or clear the end." };
  if (!startLocal) return { ok: true, date, startIso: null, endIso: null };
  const startIso = LOCAL.test(startLocal) ? localDateTimeToIso(startLocal, tz) : null;
  if (!startIso) return { ok: false, error: "A start time couldn't be read." };
  if (!endLocal) return { ok: true, date, startIso, endIso: null };
  const endIso = LOCAL.test(endLocal) ? localDateTimeToIso(endLocal, tz) : null;
  if (!endIso || Date.parse(endIso) <= Date.parse(startIso)) return { ok: false, error: "Each date's end time must be after its start time." };
  return { ok: true, date, startIso, endIso };
}

/** The parent Event's own dates: required start date, optional end date,
 * optional exact start / end (same rules). A known time decides its
 * calendar date; a cleared time leaves the submitted date as it was. */
export function parseEventDateTimes(input: {
  startLocal: string | null | undefined;
  endLocal: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  timezone?: string | null;
}): { ok: true; startIso: string | null; endIso: string | null; startDate: string; endDate: string | null } | Fail {
  const start = parseOccurrenceDateTimes({ date: input.startDate, startLocal: input.startLocal, endLocal: input.endLocal, timezone: input.timezone });
  if (!start.ok) return { ok: false, error: start.error === "Each date needs a day." ? "A start date is required." : start.error.replace("Each date's", "The") };
  const endLocal = (input.endLocal ?? "").trim();
  const submittedEnd = (input.endDate ?? "").trim();
  const endDate = start.endIso && LOCAL.test(endLocal) ? endLocal.slice(0, 10) : DATE.test(submittedEnd) ? submittedEnd : null;
  if (endDate && endDate < start.date) return { ok: false, error: "The end date can't be before the start date." };
  return { ok: true, startIso: start.startIso, endIso: start.endIso, startDate: start.date, endDate };
}
