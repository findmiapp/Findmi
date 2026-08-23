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
    return `${start} · ${startTime}–${formatTime(endIso)}`;
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
  if (sameDay) return `${startTime}–${formatTime(endIso)}`;
  return formatDateRange(startIso, endIso);
}

export function cityState(city?: string | null, state?: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

export function formatPrice(price: number | null, label: string | null): string {
  if (label) return label;
  if (price == null) return "";
  return `$${price.toFixed(2)}`;
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

export type DiscoveryWindow = "now" | "next" | "weekend" | "anytime";

/** Findmi's discovery time filter — NOW / NEXT / THIS WEEKEND / ANYTIME —
 * resolved to real UTC bounds in APP_TIMEZONE. null means "no filter." */
export function getDiscoveryWindowBounds(
  when: DiscoveryWindow
): { start: Date; end: Date } | null {
  if (when === "anytime") return null;
  if (when === "now") return getLocalDayBounds(0);
  if (when === "next") {
    return { start: getLocalDayBounds(1).start, end: getLocalDayBounds(7).end };
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
