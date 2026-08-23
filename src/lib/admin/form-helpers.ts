// Small, shared FormData → typed-value parsers used by every admin
// Server Action, so each entity's action file only needs to define its
// own field list, not reimplement parsing.

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function num(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

/** datetime-local inputs post "YYYY-MM-DDTHH:mm" with no timezone — that's
 * interpreted as the server's local time by `new Date()`, which is wrong
 * for a team that isn't all in one zone. Findmi already renders every
 * date/time in America/New_York (see lib/format.ts), so admin-entered
 * times are treated as America/New_York too, for the same reason. */
export function localDateTimeToIso(value: string | null): string | null {
  if (!value) return null;
  // value: "2026-08-29T16:00". Get that wall-clock time's UTC instant as
  // if it were in America/New_York, by comparing against how the same
  // instant renders in that zone and correcting the offset.
  const naive = new Date(`${value}:00Z`); // treat as UTC first, as a base instant
  const asNY = new Date(
    naive.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const asUTC = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asUTC.getTime() - asNY.getTime();
  return new Date(naive.getTime() + offsetMs).toISOString();
}

/** Inverse of localDateTimeToIso, for populating a datetime-local input's
 * defaultValue from a stored ISO string. */
export function isoToLocalDateTime(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function errorRedirectUrl(base: string, message: string): string {
  return `${base}?error=${encodeURIComponent(message)}`;
}
