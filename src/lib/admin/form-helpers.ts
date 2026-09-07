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

// Recurring Events V2 — admin occurrence timezone-correctness pass. Both
// functions below always took the wall-clock <-> UTC IANA zone as a
// parameter internally; only the DEFAULT was ever hardcoded to
// "America/New_York" (Findmi's original single-timezone assumption, still
// correct for every OTHER caller — the parent event's own legacy start_at/
// end_at, vendor_application_deadline, appearances — none of which carry a
// per-row timezone). Every existing call site keeps working identically
// (they don't pass the new argument, so they keep getting
// DEFAULT_ADMIN_TIMEZONE exactly as before). Only occurrence-aware code
// (event_occurrences.timezone — see EventOccurrencesEditor.tsx and
// events/actions.ts's occurrence upsert) passes a real timezone explicitly.
// Mirrors lib/format.ts's own APP_TIMEZONE-default vs *InZone split for the
// exact same reason.
export const DEFAULT_ADMIN_TIMEZONE = "America/New_York";

/** datetime-local inputs post "YYYY-MM-DDTHH:mm" with no timezone — that's
 * interpreted as the server's local time by `new Date()`, which is wrong
 * for a team that isn't all in one zone. Admin-entered times are treated
 * as being in `timezone` (default America/New_York — Findmi's original
 * single-timezone assumption, see lib/format.ts's APP_TIMEZONE). */
export function localDateTimeToIso(value: string | null, timezone: string = DEFAULT_ADMIN_TIMEZONE): string | null {
  if (!value) return null;
  // value: "2026-08-29T16:00". Get that wall-clock time's UTC instant as
  // if it were in `timezone`, by comparing against how the same instant
  // renders in that zone and correcting the offset.
  const naive = new Date(`${value}:00Z`); // treat as UTC first, as a base instant
  const asZone = new Date(naive.toLocaleString("en-US", { timeZone: timezone }));
  const asUTC = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asUTC.getTime() - asZone.getTime();
  return new Date(naive.getTime() + offsetMs).toISOString();
}

/** Inverse of localDateTimeToIso, for populating a datetime-local input's
 * defaultValue from a stored ISO string — same `timezone` default. */
export function isoToLocalDateTime(iso: string | null, timezone: string = DEFAULT_ADMIN_TIMEZONE): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
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

/** Event Creation + Pending Review UX pass — same idea as errorRedirectUrl,
 * but also round-trips the visitor's own already-submitted field values
 * through the query string, keyed by whatever field names the caller
 * passes. Fixes the "a validation error wipes the whole form" bug on
 * native create-from-scratch forms (createMemberBusiness/createMemberEvent/
 * createMemberLocation, addMemberEventDate), which — unlike an edit of an
 * already-existing row, which always has the stored row to fall back on
 * for its defaultValues — have no persisted row to render from at all
 * until creation actually succeeds; without this, a rejected submission
 * redirects back to a page with every input blank. Every value here is
 * exactly what the visitor already typed/chose, never anything computed or
 * partially validated, so it's always safe to render straight back into an
 * input's defaultValue.
 *
 * `base` may already carry its own query string (e.g. a tab-scoped
 * `?tab=dates` redirect path) — merged with "&" in that case, same
 * correctness rule account/business/actions.ts's own appendQuery already
 * documents, so this is safe to use from either a bare path or one that
 * already has a query. */
export function errorRedirectUrlWithFields(
  base: string,
  message: string,
  fields: Record<string, string | null | undefined>
): string {
  const params = new URLSearchParams({ error: message });
  for (const [key, value] of Object.entries(fields)) {
    if (value) params.set(key, value);
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}
