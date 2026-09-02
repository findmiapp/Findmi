// V1 renders every date/time in a single fixed timezone rather than the
// visitor's own — Findmi's real listings are all NYC-area today, and this
// avoids showing UTC (the server's default) to consumers. Revisit once
// appearances carry their own timezone (derived from city/state) instead of
// relying on one global default.
const APP_TIMEZONE = "America/New_York";

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateKey(date: Date): string {
  // YYYY-MM-DD in APP_TIMEZONE — for same-day comparisons that don't break
  // near midnight just because the server itself runs in UTC.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatDateRange(startIso: string, endIso?: string | null): string {
  const start = formatDateShort(startIso);
  const startTime = formatTime(startIso);
  if (!endIso) return `${start} · ${startTime}`;

  const sameDay = dateKey(new Date(startIso)) === dateKey(new Date(endIso));
  if (sameDay) {
    return `${start} · ${startTime} – ${formatTime(endIso)}`;
  }
  return `${start} – ${formatDateShort(endIso)}`;
}

/** Time only, no date — for rows that already show the date on a separate
 * date tile and shouldn't repeat it a second (or third) time. Falls back to
 * the full date range when the appearance spans more than one day, so a
 * multi-day span never silently loses its end date. */
export function formatTimeRange(startIso: string, endIso?: string | null): string {
  const startTime = formatTime(startIso);
  if (!endIso) return startTime;

  const sameDay = dateKey(new Date(startIso)) === dateKey(new Date(endIso));
  if (sameDay) return `${startTime} – ${formatTime(endIso)}`;
  return formatDateRange(startIso, endIso);
}

// ── Occurrence-timezone-aware variants (Recurring Events V2) ────────────
// Every function above renders in the single global APP_TIMEZONE — correct
// for events/appearances, which have no timezone of their own, but wrong
// for an event_occurrence, which now carries its own IANA timezone (one
// recurring series can span multiple real-world timezones, e.g. an Austin
// date and a New York date). These *InZone siblings are the exact same
// logic, parameterized by an explicit `timezone` argument instead of the
// hardcoded constant — deliberately NOT a change to the functions above,
// which stay exactly as they are for every other caller (appearances,
// legacy one-time events, businesses, products — none of which have a
// per-row timezone to pass). Only occurrence-aware code should use these.

export function formatDateShortInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTimeInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Month abbreviation only (e.g. "Sep") — for a compact date tile's top
 * line, in the occurrence's own timezone rather than the browser's/
 * server's implicit local time (new Date().toLocaleDateString() with no
 * timeZone option uses whichever runtime rendered it — wrong on both a
 * UTC server and a differently-zoned visitor). */
export function formatMonthAbbrevInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, month: "short" });
}

/** Day-of-month only (e.g. "10") — a date tile's number line, in the
 * occurrence's own timezone. Deliberately NOT Date.getDate(), which
 * always reads the runtime's local calendar day, not the intended one. */
export function formatDayOfMonthInZone(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === "day")?.value ?? "";
}

function dateKeyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatDateRangeInZone(startIso: string, endIso: string | null | undefined, timezone: string): string {
  const start = formatDateShortInZone(startIso, timezone);
  const startTime = formatTimeInZone(startIso, timezone);
  if (!endIso) return `${start} · ${startTime}`;

  const sameDay = dateKeyInZone(new Date(startIso), timezone) === dateKeyInZone(new Date(endIso), timezone);
  if (sameDay) return `${start} · ${startTime} – ${formatTimeInZone(endIso, timezone)}`;
  return `${start} – ${formatDateShortInZone(endIso, timezone)}`;
}

/** Time-only range in the occurrence's own timezone — mirrors
 * formatTimeRange above for a date tile that already shows the date
 * separately. */
export function formatTimeRangeInZone(startIso: string, endIso: string | null | undefined, timezone: string): string {
  const startTime = formatTimeInZone(startIso, timezone);
  if (!endIso) return startTime;

  const sameDay = dateKeyInZone(new Date(startIso), timezone) === dateKeyInZone(new Date(endIso), timezone);
  if (sameDay) return `${startTime} – ${formatTimeInZone(endIso, timezone)}`;
  return formatDateRangeInZone(startIso, endIso, timezone);
}

// Appearance Import hardening pass, item 1 — appearances.start_at is
// NOT NULL, so a "time TBD" appearance from the importer still needs some
// real timestamp to satisfy the schema (see appearances/import/actions.ts,
// which defaults it to noon on the correct date rather than leaving the
// row uncreatable). That placeholder must never be displayed as if it
// were a real confirmed time.
//
// This pass was explicitly told not to add a schema column for it, so
// instead of a new field, the importer writes this exact, deliberately
// non-natural-language marker into the appearance's own `description`
// (an admin-only field, never rendered publicly on its own) for TBD rows
// only. This is a real, symmetric, single-writer/single-reader protocol —
// not a heuristic guessing from the time value itself, which a genuine
// noon appearance could legitimately also have. isTimeUnknown() is the
// one place that checks for it; every appearance time display in the app
// should go through formatAppearanceTime/formatAppearanceDateRange below
// rather than calling formatTime/formatDateRange directly on an
// Appearance's own start_at/end_at.
export const TIME_UNKNOWN_MARKER = "[findmi:time-tbd]";

export function isTimeUnknown(description: string | null | undefined): boolean {
  return typeof description === "string" && description.includes(TIME_UNKNOWN_MARKER);
}

/** Time-only display for an Appearance — use this instead of
 * formatTimeRange wherever the date is already shown separately (a date
 * tile, etc.). Only ever known to be an Appearance (not an Event, which
 * has no such placeholder-time concept) via the description param. */
export function formatAppearanceTime(
  startIso: string,
  endIso: string | null | undefined,
  description: string | null | undefined
): string {
  if (isTimeUnknown(description)) return "Time TBD";
  return formatTimeRange(startIso, endIso);
}

/** Date+time display for an Appearance — use this instead of
 * formatDateRange directly on an Appearance's start_at/end_at. */
export function formatAppearanceDateRange(
  startIso: string,
  endIso: string | null | undefined,
  description: string | null | undefined
): string {
  if (isTimeUnknown(description)) return `${formatDateShort(startIso)} · Time TBD`;
  return formatDateRange(startIso, endIso);
}

export function cityState(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Canonical consumer-facing money formatter — always exactly two decimal
 * places (55 -> $55.00, 39.5 -> $39.50), with thousands separators. Every
 * shopper-facing price/amount should go through this (directly, or via
 * formatPrice below, which layers a product's own price_label on top of
 * it) rather than a manual `$${n.toFixed(2)}`. */
export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatPrice(price: number | null, label: string | null): string {
  if (label) return label;
  if (price == null) return "";
  return formatCurrency(price);
}

function tzOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUTC - date.getTime()) / 60_000;
}

/** Midnight-to-midnight bounds, in APP_TIMEZONE, for "today + dayOffset". */
function getLocalDayBounds(dayOffset = 0): { start: Date; end: Date } {
  const now = new Date();
  const offsetMin = tzOffsetMinutes(now);
  const localNow = new Date(now.getTime() + offsetMin * 60_000);
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate() + dayOffset;
  const startUTC = Date.UTC(y, m, d, 0, 0, 0) - offsetMin * 60_000;
  const endUTC = Date.UTC(y, m, d + 1, 0, 0, 0) - offsetMin * 60_000;
  return { start: new Date(startUTC), end: new Date(endUTC) };
}

export type DiscoveryWindow = "now" | "next" | "weekend" | "month" | "anytime";

/** The four primary time tabs shared by the homepage's event discovery
 * (HomeEventDiscovery.tsx, untouched — excluded system) and the /events
 * archive (Discovery/Archive V2 Part 8) — "Up Next" maps to the exact
 * same real, unfiltered chronological query "All Events" already uses
 * (see HomeEventDiscovery's own note on that intentional overlap), not a
 * second interpretation of it. Extracted here (was a private const
 * inside /api/homepage-events/route.ts) so both callers import the same
 * mapping instead of each defining their own copy. */
export type DiscoveryTimeKey = "upNext" | "today" | "weekend" | "anytime";
export const WINDOW_BY_TIME_KEY: Record<DiscoveryTimeKey, DiscoveryWindow> = {
  upNext: "anytime",
  today: "now",
  weekend: "weekend",
  anytime: "anytime",
};

/** Findmi's discovery time filter — TODAY (now) / NEXT WEEK (next) / THIS
 * WEEKEND / THIS MONTH / ALL EVENTS (anytime) — resolved to real UTC
 * bounds in APP_TIMEZONE. null means "no filter." */
export function getDiscoveryWindowBounds(
  when: DiscoveryWindow
): { start: Date; end: Date } | null {
  if (when === "anytime") return null;
  if (when === "now") return getLocalDayBounds(0);
  if (when === "next") {
    return { start: getLocalDayBounds(1).start, end: getLocalDayBounds(7).end };
  }
  if (when === "month") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    // First-of-next-month, in local time — computed via the same
    // day-bounds machinery so DST/offset edge cases stay handled in one
    // place rather than duplicated here.
    const start = getLocalDayBounds(0).start;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const now = new Date();
    const nowDay = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, day: "2-digit" }).format(now)
    );
    // The exclusive upper bound is midnight on the 1st of next month —
    // that offset's *start*, not the last day of this month's *end*
    // (which would be one day too far).
    const end = getLocalDayBounds(daysInMonth - nowDay + 1).start;
    return { start, end };
  }
  // weekend: the upcoming (or current) Saturday through end of Sunday
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
  }).format(new Date());
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort); // 0=Sun..6=Sat
  const satOffset = (6 - dow + 7) % 7;
  return { start: getLocalDayBounds(satOffset).start, end: getLocalDayBounds(satOffset + 1).end };
}

/** Bounds for one specific calendar date (YYYY-MM-DD, interpreted in
 * APP_TIMEZONE) — backs the exact-date picker on /events. Returns null for
 * an unparseable string rather than throwing. Computed as a whole-day
 * offset from "today" (both taken as plain calendar dates, not instants)
 * so it reuses the same DST-safe getLocalDayBounds machinery. */
export function getExactDateBounds(dateStr: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);

  const todayKey = dateKey(new Date());
  const [ty, tm, td] = todayKey.split("-").map(Number);

  const targetUTC = Date.UTC(y, m - 1, d);
  const todayUTC = Date.UTC(ty, tm - 1, td);
  const dayOffset = Math.round((targetUTC - todayUTC) / 86_400_000);
  return getLocalDayBounds(dayOffset);
}

export interface TemporalLabel {
  label: string;
  live: boolean;
}

/**
 * Findmi's signature "when" label — HERE NOW / TODAY / TOMORROW / SAT · AUG 29
 * / SEP 12 — used everywhere an appearance or event's timing needs to read
 * in under a second. HERE NOW is only ever returned when both a start and
 * end time are known and now genuinely falls between them — never guessed.
 */
export function getTemporalLabel(startIso: string, endIso?: string | null): TemporalLabel {
  const now = new Date();
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;

  if (end && now >= start && now <= end) {
    return { label: "HERE NOW", live: true };
  }

  const todayKey = dateKey(now);
  const startKey = dateKey(start);
  if (startKey === todayKey) return { label: "TODAY", live: false };

  const tomorrowKey = dateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (startKey === tomorrowKey) return { label: "TOMORROW", live: false };

  const daysOut = Math.round((start.getTime() - now.getTime()) / 86_400_000);
  const monthDay = start
    .toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" })
    .toUpperCase();

  if (daysOut >= 0 && daysOut <= 6) {
    const weekday = start
      .toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, weekday: "short" })
      .toUpperCase();
    return { label: `${weekday} · ${monthDay}`, live: false };
  }

  return { label: monthDay, live: false };
}
