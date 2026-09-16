"use client";

import { useMemo, useState, useTransition } from "react";
import EventLocationField, {
  type ManualVenueValues,
  type SelectedLocationDetail,
} from "@/components/account/EventLocationField";
import EventDateFieldsForm, { type EventDateFieldValues } from "./EventDateFieldsForm";
import {
  bulkGenerateEventDates,
  addMemberEventDate,
  type BulkGenerateDateInput,
} from "../actions";
import {
  BULK_GENERATION_CONFIRM_THRESHOLD,
  BULK_GENERATION_STRONG_CONFIRM_THRESHOLD,
  MAX_BULK_GENERATED_DATES,
  WEEKDAY_LABELS,
  crossesMidnight,
  enumerateCalendarDates,
} from "@/lib/schedule-dates";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-10 items-center justify-center rounded-full bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50";
const secondaryButtonClass =
  "flex h-9 items-center justify-center rounded-full border border-black/10 px-3.5 text-xs font-semibold text-ink/70 transition hover:border-black/20 disabled:opacity-50";

type Mode = "closed" | "one" | "range" | "recurring";

interface DraftRow {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Already covered by the Primary Date or an existing occurrence — never
   * submitted, shown only for the organizer's own confidence that the
   * effective schedule already includes this day. */
  alreadyScheduled: boolean;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTimeLabel(time: string): string {
  if (!time) return time;
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** EventLocationField's own manual-venue state defaults every field to ""
 * (never null) even before the organizer has typed anything — matches
 * lib/admin/form-helpers.ts's str() (used by every existing FormData-based
 * caller), which already trims-and-nullifies an empty submitted field, so
 * a batch generated without ever touching the Location field persists
 * real NULLs, not empty-string venue text. */
function emptyToNull(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

/** Schedule Authoring V4, Pass 1 — the organizer-facing "+ Add Dates"
 * composer. One day reuses the existing, already-correct addMemberEventDate
 * single-add path unchanged (EventDateFieldsForm). Date range/Recurring
 * generate a concrete list of local calendar dates client-side (never a
 * stored recurrence rule — lib/schedule-dates.ts), show a compact editable
 * preview with lightweight bulk selection (Select all / Weekdays /
 * Weekends) and an in-memory bulk hours adjustment (exactly what San
 * Gennaro's own Friday/Saturday-until-midnight exception needs, applied
 * before ever hitting the server), then one "Save" calls
 * bulkGenerateEventDates once for the whole batch — never one Server
 * Action call per generated date. The server independently re-derives
 * which days are already covered (Primary Date or an existing occurrence)
 * before inserting anything; the "already scheduled" marking here is a
 * preview convenience only, not the authoritative check. */
export default function BulkDatesComposer({
  eventId,
  existingLocalDates,
  addDateDefaults,
  initialOpen,
  hasParticipants,
}: {
  eventId: string;
  /** Every "YYYY-MM-DD" local calendar date already covered by the Primary
   * Date or an existing Additional Date — precomputed server-side (same
   * timezone convention isoToLocalDateTime already uses everywhere else in
   * this file) so this component never has to reason about timezones
   * itself. */
  existingLocalDates: string[];
  /** Draft values to reopen "One day" with after a validation error sent
   * the owner back here — same shape addMemberEventDate's own
   * errorRedirectUrlWithFields round-trip already produces. */
  addDateDefaults: EventDateFieldValues;
  /** Opens the composer (in "One day" mode) on first render — mirrors the
   * old "+ Add a Date" details' own `open={addDateHasDraft}` behavior. */
  initialOpen?: boolean;
  /** Range Extension nudge — this Event already has at least one
   * participating Business, so a successful generation's own success
   * message gets one quiet extra sentence pointing at the Businesses tab.
   * No participation is read/written here; purely informational copy. */
  hasParticipants?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(initialOpen));
  const [mode, setMode] = useState<Mode>("one");

  // Date range fields
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeStartTime, setRangeStartTime] = useState("");
  const [rangeEndTime, setRangeEndTime] = useState("");

  // Recurring fields
  const [recurStart, setRecurStart] = useState("");
  const [recurEnd, setRecurEnd] = useState("");
  const [recurWeekdays, setRecurWeekdays] = useState<Set<number>>(new Set());
  const [recurStartTime, setRecurStartTime] = useState("");
  const [recurEndTime, setRecurEndTime] = useState("");

  // Shared default Location for whichever generation mode last ran.
  const [location, setLocation] = useState<SelectedLocationDetail | null>(null);
  const [manualVenue, setManualVenue] = useState<ManualVenueValues | null>(null);

  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStartTime, setBulkStartTime] = useState("");
  const [bulkEndTime, setBulkEndTime] = useState("");

  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => new Set(existingLocalDates), [existingLocalDates]);
  const selectableRows = draftRows.filter((r) => !r.alreadyScheduled);
  const newCount = selectableRows.length;
  const skippedCount = draftRows.length - newCount;

  function toggleWeekday(i: number) {
    setRecurWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function confirmGenerationSize(count: number): boolean {
    if (count > MAX_BULK_GENERATED_DATES) {
      setError(`That range is ${count} dates — the most Findmi can generate in one batch is ${MAX_BULK_GENERATED_DATES}. Try a shorter range.`);
      return false;
    }
    if (count >= BULK_GENERATION_STRONG_CONFIRM_THRESHOLD) {
      return window.confirm(
        `This will generate ${count} dates — a very large schedule. Are you sure you want to continue?`
      );
    }
    if (count >= BULK_GENERATION_CONFIRM_THRESHOLD) {
      return window.confirm(`This will generate ${count} dates. Continue?`);
    }
    return true;
  }

  function buildDraftRows(dates: string[], startTime: string, endTime: string) {
    const rows: DraftRow[] = dates.map((date) => ({
      id: crypto.randomUUID(),
      date,
      startTime,
      endTime,
      alreadyScheduled: existing.has(date),
    }));
    setDraftRows(rows);
    setSelectedIds(new Set());
    setBulkStartTime(startTime);
    setBulkEndTime(endTime);
    setMessage(null);
    setError(null);
  }

  function handleGenerateRange() {
    setError(null);
    if (!rangeStart || !rangeEnd || !rangeStartTime || !rangeEndTime) {
      setError("Start date, end date, start time, and end time are all required.");
      return;
    }
    if (rangeStartTime === rangeEndTime) {
      setError("Start and end time can't be the same.");
      return;
    }
    const dates = enumerateCalendarDates(rangeStart, rangeEnd);
    if (dates.length === 0) {
      setError("End date must be on or after the start date.");
      return;
    }
    if (!confirmGenerationSize(dates.length)) return;
    buildDraftRows(dates, rangeStartTime, rangeEndTime);
  }

  function handleGenerateRecurring() {
    setError(null);
    if (!recurStart || !recurEnd || !recurStartTime || !recurEndTime) {
      setError("Start date, end date, start time, and end time are all required.");
      return;
    }
    if (recurWeekdays.size === 0) {
      setError("Choose at least one day of the week.");
      return;
    }
    if (recurStartTime === recurEndTime) {
      setError("Start and end time can't be the same.");
      return;
    }
    const dates = enumerateCalendarDates(recurStart, recurEnd, Array.from(recurWeekdays));
    if (dates.length === 0) {
      setError("No matching dates in that range.");
      return;
    }
    if (!confirmGenerationSize(dates.length)) return;
    buildDraftRows(dates, recurStartTime, recurEndTime);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(selectableRows.map((r) => r.id)));
  }
  function selectWeekdays() {
    setSelectedIds(new Set(selectableRows.filter((r) => !isWeekend(r.date)).map((r) => r.id)));
  }
  function selectWeekends() {
    setSelectedIds(new Set(selectableRows.filter((r) => isWeekend(r.date)).map((r) => r.id)));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  function isWeekend(dateStr: string): boolean {
    const [y, m, d] = dateStr.split("-").map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return day === 0 || day === 6;
  }

  function applyBulkHoursToDraft() {
    if (!bulkStartTime || !bulkEndTime) {
      setError("Start and end time are required.");
      return;
    }
    if (bulkStartTime === bulkEndTime) {
      setError("Start and end time can't be the same.");
      return;
    }
    setError(null);
    setDraftRows((prev) =>
      prev.map((r) => (selectedIds.has(r.id) ? { ...r, startTime: bulkStartTime, endTime: bulkEndTime } : r))
    );
  }

  function removeSelectedFromDraft() {
    setDraftRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  }

  function handleSave() {
    if (newCount === 0) {
      setError("Nothing new to save — every generated date is already on the schedule.");
      return;
    }
    const rows: BulkGenerateDateInput[] = selectableRows.map((r) => ({
      date: r.date,
      start_time: r.startTime,
      end_time: r.endTime,
    }));
    setError(null);
    startTransition(async () => {
      // Production Bugfix — Schedule Authoring V4 "Save 10 Dates" crash.
      // bulkGenerateEventDates' own contract is to always return a plain
      // result object, never throw/redirect — but this call crosses a
      // Server Action network boundary, which can still fail for reasons
      // outside that contract (a dropped connection, a session that
      // expired mid-request, an unexpected server error). Previously an
      // unhandled rejection here propagated as an uncaught exception,
      // crashing the whole page with a generic "Application error"
      // instead of the recoverable inline message every other failure
      // path already shows.
      try {
        const result = await bulkGenerateEventDates(eventId, rows, location?.id ?? null, {
          venue_name: location ? location.name : emptyToNull(manualVenue?.venue_name),
          address: location ? location.address : emptyToNull(manualVenue?.address),
          city: location ? location.city : emptyToNull(manualVenue?.city),
          state: location ? location.state : emptyToNull(manualVenue?.state),
          postal_code: location ? location.postal_code : emptyToNull(manualVenue?.postal_code),
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        const created = result.created ?? 0;
        const skipped = result.skippedExisting ?? 0;
        const base =
          skipped > 0
            ? `Added ${created} date${created === 1 ? "" : "s"} — ${skipped} day${skipped === 1 ? "" : "s"} in that range ${skipped === 1 ? "was" : "were"} already on the schedule.`
            : `Added ${created} date${created === 1 ? "" : "s"}.`;
        // Range Extension nudge — quiet, informational only. No participation
        // is read or changed here; this pass never propagates existing
        // Businesses onto newly generated dates (that's Pass 2's job).
        setMessage(
          created > 0 && hasParticipants ? `${base} Review participating businesses for these dates.` : base
        );
        setDraftRows([]);
        setSelectedIds(new Set());
        setRangeStart("");
        setRangeEnd("");
        setRecurStart("");
        setRecurEnd("");
      } catch {
        setError("Couldn't save those dates — please try again.");
      }
    });
  }

  return (
    <details className="group border-t border-black/5 pt-6" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Add Dates</p>
        <span className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition group-hover:bg-findmi-600">
          <span className="group-open:hidden">+ Add Dates</span>
          <span className="hidden group-open:inline">Close</span>
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-black/10 p-4">
        <div className="flex gap-2">
          {(["one", "range", "recurring"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                mode === m ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {m === "one" ? "One Day" : m === "range" ? "Date Range" : "Recurring"}
            </button>
          ))}
        </div>

        {mode === "one" && (
          <EventDateFieldsForm action={addMemberEventDate.bind(null, eventId)} defaultValues={addDateDefaults} submitLabel="Add Date" />
        )}

        {mode === "range" && draftRows.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Starts</span>
                <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Ends</span>
                <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className={inputClass} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Start time</span>
                <input type="time" value={rangeStartTime} onChange={(e) => setRangeStartTime(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">End time</span>
                <input type="time" value={rangeEndTime} onChange={(e) => setRangeEndTime(e.target.value)} className={inputClass} />
              </label>
            </div>
            {rangeStartTime && rangeEndTime && crossesMidnight(rangeStartTime, rangeEndTime) && (
              <p className="text-xs text-ink/45">Each date ends the following day, after midnight.</p>
            )}
            <EventLocationField
              initialLocation={location}
              initialManual={manualVenue}
              onLocationChange={({ location: loc, manualVenue: manual }) => {
                setLocation(loc);
                setManualVenue(manual);
              }}
            />
            <button type="button" onClick={handleGenerateRange} className={`w-fit ${primaryButtonClass}`}>
              Generate
            </button>
          </div>
        )}

        {mode === "recurring" && draftRows.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Starts</span>
                <input type="date" value={recurStart} onChange={(e) => setRecurStart(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Ends</span>
                <input type="date" value={recurEnd} onChange={(e) => setRecurEnd(e.target.value)} className={inputClass} />
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink/70">Repeats on</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleWeekday(i)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                      recurWeekdays.has(i) ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Start time</span>
                <input type="time" value={recurStartTime} onChange={(e) => setRecurStartTime(e.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">End time</span>
                <input type="time" value={recurEndTime} onChange={(e) => setRecurEndTime(e.target.value)} className={inputClass} />
              </label>
            </div>
            {recurStartTime && recurEndTime && crossesMidnight(recurStartTime, recurEndTime) && (
              <p className="text-xs text-ink/45">Each date ends the following day, after midnight.</p>
            )}
            <EventLocationField
              initialLocation={location}
              initialManual={manualVenue}
              onLocationChange={({ location: loc, manualVenue: manual }) => {
                setLocation(loc);
                setManualVenue(manual);
              }}
            />
            <button type="button" onClick={handleGenerateRecurring} className={`w-fit ${primaryButtonClass}`}>
              Generate
            </button>
          </div>
        )}

        {(mode === "range" || mode === "recurring") && draftRows.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink">
              {draftRows.length} date{draftRows.length === 1 ? "" : "s"}
              {skippedCount > 0 && (
                <span className="font-normal text-ink/50">
                  {" "}
                  — {skippedCount} already on the schedule, {newCount} new
                </span>
              )}
            </p>

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
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-black/10 bg-mist/30 p-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-ink/60">Start</span>
                  <input type="time" value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)} className={`${inputClass} w-32`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-ink/60">End</span>
                  <input type="time" value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)} className={`${inputClass} w-32`} />
                </label>
                <button type="button" onClick={applyBulkHoursToDraft} className={secondaryButtonClass}>
                  Apply hours to {selectedIds.size}
                </button>
                <button type="button" onClick={removeSelectedFromDraft} className="text-xs font-semibold text-red-600 hover:text-red-700">
                  Remove {selectedIds.size} from batch
                </button>
              </div>
            )}

            <ul className="flex max-h-72 flex-col divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-black/10">
              {draftRows.map((row) => (
                <li key={row.id} className={`flex items-center gap-3 px-3 py-2 ${row.alreadyScheduled ? "opacity-50" : ""}`}>
                  {!row.alreadyScheduled && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      className="h-4 w-4 shrink-0 accent-findmi"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{formatDateLabel(row.date)}</p>
                    <p className="truncate text-xs text-ink/50">
                      {formatTimeLabel(row.startTime)}–{formatTimeLabel(row.endTime)}
                      {row.alreadyScheduled && " · Already scheduled"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3">
              <button type="button" disabled={pending || newCount === 0} onClick={handleSave} className={primaryButtonClass}>
                {pending ? "Saving…" : `Save ${newCount} Date${newCount === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftRows([]);
                  setSelectedIds(new Set());
                }}
                className="text-xs font-semibold text-ink/50 hover:text-ink"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        {message && !error && <p className="text-xs font-semibold text-findmi-700">{message}</p>}
      </div>
    </details>
  );
}
