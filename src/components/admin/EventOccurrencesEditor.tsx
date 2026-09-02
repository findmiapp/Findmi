"use client";

import { useState } from "react";
import type { AdminEventOccurrence, AdminLocation, AdminOccurrenceVendor } from "@/lib/admin/queries";
import { isoToLocalDateTime } from "@/lib/admin/form-helpers";
import OccurrenceVendorManager from "./OccurrenceVendorManager";

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-2 text-sm text-ink focus:border-ink/30 focus:outline-none";

interface Row {
  id: string;
  start_at: string; // datetime-local value
  end_at: string; // datetime-local value
  location_id: string; // "" = none
  featured: boolean;
  cancelled: boolean;
  ticket_url_override: string;
  vendor_apply_url_override: string;
}

function toRow(o: AdminEventOccurrence): Row {
  return {
    id: o.id,
    start_at: isoToLocalDateTime(o.start_at),
    end_at: isoToLocalDateTime(o.end_at),
    location_id: o.location_id ?? "",
    featured: o.featured,
    cancelled: o.status === "cancelled",
    ticket_url_override: o.ticket_url_override ?? "",
    vendor_apply_url_override: o.vendor_apply_url_override ?? "",
  };
}

function emptyRow(): Row {
  return {
    id: crypto.randomUUID(),
    start_at: "",
    end_at: "",
    location_id: "",
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
  vendorRostersByOccurrence,
}: {
  eventId: string | null;
  initialOccurrences: AdminEventOccurrence[];
  locations: AdminLocation[];
  vendorRostersByOccurrence: Record<string, AdminOccurrenceVendor[]>;
}) {
  const [rows, setRows] = useState<Row[]>(initialOccurrences.map(toRow));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [repeatWeeks, setRepeatWeeks] = useState("4");
  // Manage Vendors panel — plain client state, not tied to a navigation:
  // OccurrenceVendorManager's mutations only ever revalidatePath (no
  // redirect), so this stays open across an add/status/feature/remove.
  const [openVendorsFor, setOpenVendorsFor] = useState<string | null>(null);

  const addOccurrence = () => setRows((prev) => [...prev, emptyRow()]);

  const removeOccurrence = (id: string, isExisting: boolean) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (isExisting) setRemovedIds((prev) => [...prev, id]);
    setOpenVendorsFor((prev) => (prev === id ? null : prev));
  };

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const existingIds = new Set(initialOccurrences.map((o) => o.id));

  const repeatFromLast = () => {
    const template = rows[rows.length - 1];
    if (!template || !template.start_at || !template.end_at) return;
    const weeks = Math.max(1, Math.min(MAX_REPEAT_WEEKS, Number(repeatWeeks) || 0));
    const generated: Row[] = [];
    for (let i = 1; i <= weeks; i++) {
      generated.push({
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

              {eventId && existingIds.has(row.id) && openVendorsFor === row.id && (
                <OccurrenceVendorManager
                  eventId={eventId}
                  occurrenceId={row.id}
                  vendors={vendorRostersByOccurrence[row.id] ?? []}
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
