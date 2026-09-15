"use client";

import { useState, useTransition } from "react";
import EventLocationField, {
  type ManualVenueValues,
  type SelectedLocationDetail,
} from "@/components/account/EventLocationField";
import EventDateFieldsForm, { type EventDateFieldValues } from "./EventDateFieldsForm";
import {
  bulkRemoveEventDates,
  bulkUpdateEventDatesHours,
  bulkUpdateEventDatesLocation,
  removeMemberEventDate,
  updateMemberEventDate,
} from "../actions";

const secondaryButtonClass =
  "flex h-9 items-center justify-center rounded-full border border-black/10 px-3.5 text-xs font-semibold text-ink/70 transition hover:border-black/20 disabled:opacity-50";
const primaryButtonClass =
  "flex h-9 items-center justify-center rounded-full bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50";
const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface ScheduleOccurrence {
  id: string;
  location_id: string | null;
  location_name: string | null;
  location_slug: string | null;
  location_category: string | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  location_postal_code: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Every date/time value below is precomputed SERVER-SIDE (page.tsx),
   * via the exact same isoToLocalDateTime conversion the rest of Event
   * Manager already uses for this occurrence's own start_at/end_at — never
   * re-derived from raw ISO with a bare `new Date(iso)` in this client
   * component, which would read the VIEWER's own browser timezone instead
   * of Findmi's single-timezone convention and could silently shift a
   * date/time on save. */
  dateLabel: string;
  timeLabel: string;
  dateLocal: string; // "YYYY-MM-DD"
  startTimeLocal: string; // "HH:MM"
  endTimeLocal: string; // "HH:MM"
  /** 0=Sun..6=Sat, derived from dateLocal — used only for the Weekdays/
   * Weekends selection helpers. */
  weekday: number;
}

/** Schedule Authoring V4, Pass 1 — Additional Dates as compact, uniform
 * schedule rows (never a giant expanded edit form by default — progressive
 * disclosure per row, same pattern the rest of Event Manager V3 already
 * uses), with lightweight multi-select and the three high-value bulk
 * operations the audit identified: change Location, change hours, remove.
 * Individual per-row editing (date/start/end/Location) is completely
 * unchanged — same EventDateFieldsForm/updateMemberEventDate as before,
 * just now opened by a local toggle instead of a query-param round trip. */
export default function EventScheduleList({ eventId, occurrences }: { eventId: string; occurrences: ScheduleOccurrence[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPanel, setBulkPanel] = useState<"none" | "location" | "hours">("none");
  const [bulkLocation, setBulkLocation] = useState<SelectedLocationDetail | null>(null);
  const [bulkManualVenue, setBulkManualVenue] = useState<ManualVenueValues | null>(null);
  const [bulkStartTime, setBulkStartTime] = useState("");
  const [bulkEndTime, setBulkEndTime] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedIds(new Set(occurrences.map((o) => o.id)));
  }
  function selectWeekdays() {
    setSelectedIds(new Set(occurrences.filter((o) => o.weekday !== 0 && o.weekday !== 6).map((o) => o.id)));
  }
  function selectWeekends() {
    setSelectedIds(new Set(occurrences.filter((o) => o.weekday === 0 || o.weekday === 6).map((o) => o.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
    setBulkPanel("none");
  }

  function applyBulkLocation() {
    setError(null);
    startTransition(async () => {
      const result = await bulkUpdateEventDatesLocation(eventId, Array.from(selectedIds), bulkLocation?.id ?? null, {
        venue_name: bulkLocation ? bulkLocation.name : emptyToNull(bulkManualVenue?.venue_name),
        address: bulkLocation ? bulkLocation.address : emptyToNull(bulkManualVenue?.address),
        city: bulkLocation ? bulkLocation.city : emptyToNull(bulkManualVenue?.city),
        state: bulkLocation ? bulkLocation.state : emptyToNull(bulkManualVenue?.state),
        postal_code: bulkLocation ? bulkLocation.postal_code : emptyToNull(bulkManualVenue?.postal_code),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(`Updated Location for ${result.updated ?? 0} date${(result.updated ?? 0) === 1 ? "" : "s"}.`);
      clearSelection();
    });
  }

  function applyBulkHours() {
    if (!bulkStartTime || !bulkEndTime) {
      setError("Start and end time are required.");
      return;
    }
    if (bulkStartTime === bulkEndTime) {
      setError("Start and end time can't be the same.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bulkUpdateEventDatesHours(eventId, Array.from(selectedIds), bulkStartTime, bulkEndTime);
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(`Updated hours for ${result.updated ?? 0} date${(result.updated ?? 0) === 1 ? "" : "s"}.`);
      clearSelection();
    });
  }

  function removeSelected() {
    if (!window.confirm(`Remove ${selectedIds.size} date${selectedIds.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkRemoveEventDates(eventId, Array.from(selectedIds));
      if (result.error) {
        setError(result.error);
        return;
      }
      setNotice(`Removed ${result.removed ?? 0} date${(result.removed ?? 0) === 1 ? "" : "s"}.`);
      clearSelection();
    });
  }

  if (occurrences.length === 0) {
    return <p className="mt-2 text-sm text-ink/50">No additional dates yet.</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={selectAll} className={secondaryButtonClass}>
          Select all
        </button>
        <button type="button" onClick={selectWeekdays} className={secondaryButtonClass}>
          Weekdays
        </button>
        <button type="button" onClick={selectWeekends} className={secondaryButtonClass}>
          Weekends
        </button>
        {selectedIds.size > 0 && (
          <button type="button" onClick={clearSelection} className="text-xs font-semibold text-ink/50 hover:text-ink">
            Clear ({selectedIds.size})
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-mist/30 p-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setBulkPanel(bulkPanel === "location" ? "none" : "location")} className={secondaryButtonClass}>
              Change Location
            </button>
            <button type="button" onClick={() => setBulkPanel(bulkPanel === "hours" ? "none" : "hours")} className={secondaryButtonClass}>
              Change Hours
            </button>
            <button type="button" disabled={pending} onClick={removeSelected} className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
              Remove {selectedIds.size} date{selectedIds.size === 1 ? "" : "s"}
            </button>
          </div>

          {bulkPanel === "location" && (
            <div className="flex flex-col gap-2 border-t border-black/10 pt-3">
              <EventLocationField
                initialLocation={bulkLocation}
                initialManual={bulkManualVenue}
                onLocationChange={({ location, manualVenue }) => {
                  setBulkLocation(location);
                  setBulkManualVenue(manualVenue);
                }}
              />
              <button type="button" disabled={pending} onClick={applyBulkLocation} className={`w-fit ${primaryButtonClass}`}>
                Apply to {selectedIds.size} date{selectedIds.size === 1 ? "" : "s"}
              </button>
            </div>
          )}

          {bulkPanel === "hours" && (
            <div className="flex flex-wrap items-end gap-2 border-t border-black/10 pt-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink/60">Start</span>
                <input type="time" value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)} className={`${inputClass} w-32`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink/60">End</span>
                <input type="time" value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)} className={`${inputClass} w-32`} />
              </label>
              <button type="button" disabled={pending} onClick={applyBulkHours} className={primaryButtonClass}>
                Apply to {selectedIds.size} date{selectedIds.size === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && !error && <p className="text-xs font-semibold text-findmi-700">{notice}</p>}

      <ul className="flex flex-col divide-y divide-black/[0.06]">
        {occurrences.map((occ) => {
          const isEditing = editingId === occ.id;
          return (
            <li key={occ.id} className="py-3 first:pt-0 last:pb-0">
              {isEditing ? (
                <div>
                  <EventDateFieldsForm
                    action={updateMemberEventDate.bind(null, eventId, occ.id)}
                    defaultValues={dateFieldValuesFromOccurrence(occ)}
                    submitLabel="Save Date"
                  />
                  <button type="button" onClick={() => setEditingId(null)} className="mt-2 text-xs font-semibold text-ink/50 hover:text-ink">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(occ.id)}
                    onChange={() => toggle(occ.id)}
                    className="h-4 w-4 shrink-0 accent-findmi"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{occ.dateLabel}</p>
                    <p className="truncate text-xs text-ink/50">
                      {occ.timeLabel}
                      {occ.location_name ? ` · ${occ.location_name}` : occ.venue_name ? ` · ${occ.venue_name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button type="button" onClick={() => setEditingId(occ.id)} className="text-xs font-semibold text-ink/50 hover:text-ink">
                      Edit
                    </button>
                    <form action={removeMemberEventDate.bind(null, eventId, occ.id)}>
                      <button type="submit" className="text-xs font-semibold text-red-600 hover:text-red-700">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Same reasoning as BulkDatesComposer's own emptyToNull — EventLocationField's
 * manual-venue state defaults every field to "" rather than null, unlike
 * lib/admin/form-helpers.ts's str() (used by every existing FormData-based
 * caller), which already trims-and-nullifies an empty field. */
function emptyToNull(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function dateFieldValuesFromOccurrence(occ: ScheduleOccurrence): EventDateFieldValues {
  return {
    date: occ.dateLocal,
    start_time: occ.startTimeLocal,
    end_time: occ.endTimeLocal,
    location:
      occ.location_id && occ.location_name
        ? {
            id: occ.location_id,
            name: occ.location_name,
            slug: occ.location_slug ?? "",
            category: occ.location_category,
            address: occ.location_address,
            city: occ.location_city,
            state: occ.location_state,
            postal_code: occ.location_postal_code,
          }
        : null,
    manualVenue: occ.location_id
      ? null
      : {
          venue_name: occ.venue_name ?? "",
          address: occ.address ?? "",
          city: occ.city ?? "",
          state: occ.state ?? "",
          postal_code: occ.postal_code ?? "",
        },
  };
}
