"use client";

import { useState } from "react";
import type { AdminEventOccurrence, AdminLocation, AdminOccurrenceVendor } from "@/lib/admin/queries";
import type { AdminMarketOption } from "@/lib/admin/business-markets";
import { DEFAULT_ADMIN_TIMEZONE, isoToLocalDateTime } from "@/lib/admin/form-helpers";
import { formatDateShortInZone, formatTimeInZone } from "@/lib/format";
import { resolveEffectiveEventMarket } from "@/lib/event-markets";
import OccurrenceVendorManager from "./OccurrenceVendorManager";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

// Admin Occurrence Timezone Correctness pass — a bounded set of common US
// IANA zones for the occurrence timezone <select> below, not an attempt at
// a full IANA picker. An occurrence's real stored timezone (any valid IANA
// string) always still round-trips correctly even if it isn't one of
// these — see the row's hidden `timezone_${id}` input, which always posts
// the real state value regardless of what this <select> can display.
const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern — America/New_York" },
  { value: "America/Chicago", label: "Central — America/Chicago" },
  { value: "America/Denver", label: "Mountain — America/Denver" },
  { value: "America/Phoenix", label: "Mountain, no DST — America/Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — America/Los_Angeles" },
  { value: "America/Anchorage", label: "Alaska — America/Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Pacific/Honolulu" },
];

interface Row {
  id: string;
  start_at: string; // datetime-local value, in this row's own timezone
  end_at: string; // datetime-local value, in this row's own timezone
  timezone: string; // IANA zone — event_occurrences.timezone
  location_id: string; // "" = none
  market_id: string; // "" = inherit automatically (DB stays NULL — see F)
  featured: boolean;
  cancelled: boolean;
  ticket_url_override: string;
  vendor_apply_url_override: string;
}

function toRow(o: AdminEventOccurrence): Row {
  return {
    id: o.id,
    start_at: isoToLocalDateTime(o.start_at, o.timezone),
    end_at: isoToLocalDateTime(o.end_at, o.timezone),
    timezone: o.timezone,
    location_id: o.location_id ?? "",
    // Critical admin semantics (item F) — a saved occurrence with no
    // explicit override reads market_id as null from the database; this
    // must map to "" (Inherit automatically) here, never to a computed
    // inherited value, so the DB's NULL-means-inherit meaning survives an
    // untouched save.
    market_id: o.market_id ?? "",
    featured: o.featured,
    cancelled: o.status === "cancelled",
    ticket_url_override: o.ticket_url_override ?? "",
    vendor_apply_url_override: o.vendor_apply_url_override ?? "",
  };
}

/** A brand-new occurrence has no timezone of its own yet — the safest
 * default is the most recently added occurrence's own timezone (a new
 * date on the same recurring event overwhelmingly belongs to the same
 * market/timezone), falling back to DEFAULT_ADMIN_TIMEZONE only when this
 * is the event's very first occurrence. There's no parent-event-level
 * timezone column to prefer over this — events carries no timezone field
 * at all today. */
function emptyRow(inheritTimezone?: string): Row {
  return {
    id: crypto.randomUUID(),
    start_at: "",
    end_at: "",
    timezone: inheritTimezone ?? DEFAULT_ADMIN_TIMEZONE,
    location_id: "",
    market_id: "",
    featured: false,
    cancelled: false,
    ticket_url_override: "",
    vendor_apply_url_override: "",
  };
}

/** Adds `days` to a datetime-local ("YYYY-MM-DDTHH:mm") value, purely by
 * local wall-clock date math — used only by the bounded weekly-repeat
 * generator below, never for real timezone conversion (see
 * localDateTimeToIso for that, applied server-side on submit exactly like
 * every other row here). */
function addDaysToLocalDateTime(value: string, days: number): string {
  if (!value) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MAX_REPEAT_WEEKS = 26;

/** Compact label for one saved occurrence in the Copy Vendors source
 * picker — reuses the existing formatters purely for display, doesn't
 * touch date/time formatting logic itself. */
function occurrenceLabel(o: AdminEventOccurrence): string {
  return `${formatDateShortInZone(o.start_at, o.timezone)} · ${formatTimeInZone(o.start_at, o.timezone)}`;
}

/** Occurrence (concrete date/time/location) editor for one event, nested
 * inside the event's own big <form action={saveEvent}> — same
 * hidden-input-rows pattern as ParticipationRoster/EventProductsRoster:
 * "occurrence_id" carries the current roster, "removed_occurrence_id"
 * carries anything explicitly removed this submit, and each row's own
 * fields post under `${field}_${occurrence.id}`. Concrete rows only — the
 * "repeat weekly" control below just clones the last row N times client-
 * side; nothing here stores a recurrence rule.
 *
 * Recurring Events V2 — "Manage Vendors" (per-occurrence roster, see
 * OccurrenceVendorManager) is the one exception to the hidden-input-rows
 * pattern above: it's only offered for an already-saved occurrence (one
 * present in initialOccurrences/existingIds — a freshly added row's id is
 * client-only and doesn't exist in event_occurrences yet), and its
 * mutations are immediate direct Server Action calls rather than more
 * hidden inputs on this form, since that roster is independent of
 * anything saveEvent itself writes. */
export default function EventOccurrencesEditor({
  eventId,
  initialOccurrences,
  locations,
  markets,
  eventMarketId,
  vendorRostersByOccurrence,
}: {
  eventId: string | null;
  initialOccurrences: AdminEventOccurrence[];
  locations: AdminLocation[];
  markets: AdminMarketOption[];
  eventMarketId: string | null;
  vendorRostersByOccurrence: Record<string, AdminOccurrenceVendor[]>;
}) {
  const [rows, setRows] = useState<Row[]>(initialOccurrences.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [repeatWeeks, setRepeatWeeks] = useState("4");
  // Manage Vendors panel — plain client state, not tied to a navigation:
  // OccurrenceVendorManager's mutations only ever revalidatePath (no
  // redirect), so this stays open across an add/status/feature/remove.
  const [openVendorsFor, setOpenVendorsFor] = useState<string | null>(null);

  const addOccurrence = () =>
    setRows((prev) => [...prev, emptyRow(prev.length > 0 ? prev[prev.length - 1].timezone : undefined)]);

  const removeOccurrence = (id: string, isExisting: boolean) => {
    // Occurrence delete warning — an unsaved row (isExisting false) has no
    // real event_occurrence_businesses rows to lose (its id doesn't exist
    // in the database yet), so it keeps the original one-click removal.
    // An existing/saved occurrence with vendors on it gets a hard stop:
    // deleting it (once the event form is actually saved — this button
    // only marks it for removal here) cascades to that date's whole
    // vendor roster via the table's own FK, and that's not reversible.
    if (isExisting) {
      const vendorCount = vendorRostersByOccurrence[id]?.length ?? 0;
      if (vendorCount > 0) {
        const ok = window.confirm(
          `This date has ${vendorCount} vendor${vendorCount === 1 ? "" : "s"} on its roster. Removing this date will also remove that date's entire vendor roster once you save this event — this can't be undone. Remove anyway?`
        );
        if (!ok) return;
      }
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (isExisting) setRemovedIds((prev) => [...prev, id]);
    setOpenVendorsFor((prev) => (prev === id ? null : prev));
  };

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const existingIds = new Set(initialOccurrences.map((o) => o.id));

  // Compact inherited-Market preview shown under "Inherit automatically" —
  // always computed with occurrenceMarketId omitted (this is "what would
  // this occurrence inherit", never the saved override itself), reusing
  // the one locked resolver rather than re-deriving the precedence here.
  const inheritedMarketLabel = (row: Row): string => {
    const locationMarketId = row.location_id
      ? (locations.find((l) => l.id === row.location_id)?.market_id ?? null)
      : null;
    const effective = resolveEffectiveEventMarket({ eventMarketId, locationMarketId });
    if (!effective.marketId) return "No Market inherited.";
    const marketName = markets.find((m) => m.id === effective.marketId)?.name ?? "Unknown Market";
    return effective.source === "location" ? `Inherited from location: ${marketName}` : `Inherited: ${marketName}`;
  };

  const repeatFromLast = () => {
    const template = rows[rows.length - 1];
    if (!template || !template.start_at || !template.end_at) return;
    const weeks = Math.max(1, Math.min(MAX_REPEAT_WEEKS, Number(repeatWeeks) || 0));
    const generated: Row[] = [];
    for (let i = 1; i <= weeks; i++) {
      generated.push({
        // `...template` already carries the template row's own timezone
        // through to every generated row — the intended fix here:
        // generated dates belong to the same event/timezone as the date
        // they were generated from, never a silent DB-default timezone.
        ...template,
        id: crypto.randomUUID(),
        start_at: addDaysToLocalDateTime(template.start_at, 7 * i),
        end_at: addDaysToLocalDateTime(template.end_at, 7 * i),
      });
    }
    setRows((prev) => [...prev, ...generated]);
  };

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">Occurrences (Dates)</span>
      <p className="mb-3 text-xs text-ink/45">
        For a recurring or multi-date event — each is a real, independently editable date/time/location. Leave
        empty for a simple one-time event; the fields above (Start/End Date &amp; Time) keep working as-is.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/45">No occurrences added yet — this event uses its single date above.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={row.id} className="rounded-xl border border-black/10 bg-white p-3">
              <input type="hidden" name="occurrence_id" value={row.id} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink/50">
                  Date {i + 1}
                  {row.cancelled && <span className="ml-2 text-red-600">Cancelled</span>}
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  {existingIds.has(row.id) && eventId && (
                    <button
                      type="button"
                      onClick={() => setOpenVendorsFor((prev) => (prev === row.id ? null : row.id))}
                      className="text-xs font-semibold text-findmi-700 hover:underline"
                    >
                      {openVendorsFor === row.id ? "Hide Vendors" : "Manage Vendors"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeOccurrence(row.id, existingIds.has(row.id))}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {!existingIds.has(row.id) && (
                <p className="mt-1 text-[11px] text-ink/40">Save this event before managing vendors for this date.</p>
              )}

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Start</span>
                  <input
                    type="datetime-local"
                    name={`start_at_${row.id}`}
                    value={row.start_at}
                    onChange={(e) => updateRow(row.id, { start_at: e.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">End</span>
                  <input
                    type="datetime-local"
                    name={`end_at_${row.id}`}
                    value={row.end_at}
                    onChange={(e) => updateRow(row.id, { end_at: e.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </label>
              </div>

              <div className="mt-2">
                <label className="block sm:max-w-xs">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Timezone</span>
                  <input type="hidden" name={`timezone_${row.id}`} value={row.timezone} />
                  <select
                    value={row.timezone}
                    onChange={(e) => updateRow(row.id, { timezone: e.target.value })}
                    className={`${inputClass} w-full`}
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                    {!TIMEZONE_OPTIONS.some((tz) => tz.value === row.timezone) && (
                      <option value={row.timezone}>{row.timezone}</option>
                    )}
                  </select>
                </label>
                <p className="mt-1 text-[11px] text-ink/40">
                  Start/End above are shown and saved in this date&rsquo;s own timezone. Changing this alone (without
                  touching Start/End) re-interprets the same numbers in the new zone — an explicit correction, not a
                  no-op.
                </p>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Location</span>
                  <select
                    name={`location_id_${row.id}`}
                    value={row.location_id}
                    onChange={(e) => updateRow(row.id, { location_id: e.target.value })}
                    className={`${inputClass} w-full`}
                  >
                    <option value="">No FindMi Location</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                        {loc.city ? ` — ${loc.city}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`featured_${row.id}`}
                    checked={row.featured}
                    onChange={(e) => updateRow(row.id, { featured: e.target.checked })}
                    className="h-4 w-4 accent-findmi"
                  />
                  Featured
                </label>
                <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    name={`cancelled_${row.id}`}
                    checked={row.cancelled}
                    onChange={(e) => updateRow(row.id, { cancelled: e.target.checked })}
                    className="h-4 w-4 accent-red-600"
                  />
                  Cancelled
                </label>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">
                    Ticket Link Override (optional)
                  </span>
                  <input
                    type="url"
                    name={`ticket_url_override_${row.id}`}
                    value={row.ticket_url_override}
                    onChange={(e) => updateRow(row.id, { ticket_url_override: e.target.value })}
                    placeholder="Falls back to the event's Ticket Link"
                    className={`${inputClass} w-full`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink/60">
                    Vendor Application Link Override (optional)
                  </span>
                  <input
                    type="url"
                    name={`vendor_apply_url_override_${row.id}`}
                    value={row.vendor_apply_url_override}
                    onChange={(e) => updateRow(row.id, { vendor_apply_url_override: e.target.value })}
                    placeholder="Falls back to the event's Application Link"
                    className={`${inputClass} w-full`}
                  />
                </label>
              </div>

              <div className="mt-2">
                <label className="block sm:max-w-xs">
                  <span className="mb-1 block text-xs font-medium text-ink/60">Market Override</span>
                  <select
                    name={`market_id_${row.id}`}
                    value={row.market_id}
                    onChange={(e) => updateRow(row.id, { market_id: e.target.value })}
                    className={`${inputClass} w-full`}
                  >
                    <option value="">Inherit automatically</option>
                    {markets
                      .filter((m) => m.active || m.id === row.market_id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                {row.market_id === "" && (
                  <p className="mt-1 text-[11px] text-ink/40">{inheritedMarketLabel(row)}</p>
                )}
              </div>

              {eventId && existingIds.has(row.id) && openVendorsFor === row.id && (
                <OccurrenceVendorManager
                  eventId={eventId}
                  occurrenceId={row.id}
                  vendors={vendorRostersByOccurrence[row.id] ?? []}
                  copySources={initialOccurrences
                    .filter((o) => o.id !== row.id)
                    .map((o) => ({ id: o.id, label: occurrenceLabel(o) }))}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {removedIds.map((id) => (
        <input key={id} type="hidden" name="removed_occurrence_id" value={id} />
      ))}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addOccurrence}
          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-black/[0.02]"
        >
          + Add Occurrence
        </button>

        {rows.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink/45">Repeat last date weekly ×</span>
            <input
              type="number"
              min={1}
              max={MAX_REPEAT_WEEKS}
              value={repeatWeeks}
              onChange={(e) => setRepeatWeeks(e.target.value)}
              className={`${inputClass} w-16`}
            />
            <button
              type="button"
              onClick={repeatFromLast}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-black/[0.02]"
            >
              Generate
            </button>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-ink/45">
        Generates real, independent rows from the last date&rsquo;s time/location — not a saved repeating rule.
        Review each one before saving.
      </p>
    </div>
  );
}
