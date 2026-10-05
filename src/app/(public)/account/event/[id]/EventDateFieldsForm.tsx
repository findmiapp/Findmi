"use client";

import { useState } from "react";
import EventLocationField, {
  type ManualVenueValues,
  type SelectedLocationDetail,
} from "@/components/account/EventLocationField";
import { crossesMidnight } from "@/lib/schedule-dates";
import TimeSelect from "@/components/scheduling/TimeSelect";
import { addMinutesLocal, DEFAULT_DURATION_MINUTES, splitLocalDateTime } from "@/lib/schedule-time";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface EventDateFieldValues {
  date: string;
  start_time: string;
  end_time: string;
  location: SelectedLocationDetail | null;
  manualVenue: ManualVenueValues | null;
}

/** Shared fields for both "Add a date" and "Edit date" on Event Manager's
 * Dates tab.
 *
 * Cross-Midnight Fix (Schedule Authoring V4) — a closing time at or before
 * the opening time (e.g. 11:30 AM -> 12:00 AM) is no longer rejected as
 * "end before start": it means the session ends on the FOLLOWING calendar
 * date, exactly like a real venue's closing time would. Only a genuinely
 * ambiguous zero-duration submission (identical start/end time) is still
 * blocked. The server (../actions.ts) resolves the same next-day rule via
 * lib/schedule-dates.ts's resolveEndDateForTimes — this client check is a
 * fast, non-authoritative mirror of that same rule, not a second source of
 * truth. Deliberately never surfaces the word "occurrence" or a raw
 * occurrence id — the caller (the page) supplies which one this form edits
 * via `action`'s own bound argument, never a field in this form. */
export default function EventDateFieldsForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: EventDateFieldValues;
  submitLabel: string;
}) {
  const [timeError, setTimeError] = useState<string | null>(null);
  const [endTime, setEndTime] = useState(defaultValues.end_time);
  const [startTime, setStartTime] = useState(defaultValues.start_time);
  // Field QA UX Pass 1 — End follows Start until it's deliberately set
  // (an existing date's End counts as set, so loading changes nothing).
  const [endTouched, setEndTouched] = useState(Boolean(defaultValues.end_time));

  function changeStartTime(next: string) {
    setStartTime(next);
    if (next && (!endTouched || !endTime || endTime === next)) {
      setEndTime(splitLocalDateTime(addMinutesLocal(`2000-01-01T${next}`, DEFAULT_DURATION_MINUTES)).time);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const date = (form.elements.namedItem("date") as HTMLInputElement | null)?.value;
    const start = (form.elements.namedItem("start_time") as HTMLInputElement | null)?.value;
    const end = (form.elements.namedItem("end_time") as HTMLInputElement | null)?.value;
    if (date && start && end && start === end) {
      e.preventDefault();
      setTimeError("Start and end time can't be the same.");
      return;
    }
    setTimeError(null);
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input type="date" name="date" required defaultValue={defaultValues.date} aria-label="Date" className={`${inputClass} col-span-2 sm:col-span-1`} />
        <TimeSelect name="start_time" required value={startTime} onChange={changeStartTime} placeholder="Start" ariaLabel="Start time" className={inputClass} />
        <TimeSelect
          name="end_time"
          required
          value={endTime}
          onChange={(next) => {
            setEndTime(next);
            setEndTouched(true);
          }}
          placeholder="End"
          ariaLabel="End time"
          className={inputClass}
        />
      </div>
      {timeError ? (
        <p className="text-xs text-red-600">{timeError}</p>
      ) : (
        startTime && endTime && crossesMidnight(startTime, endTime) && (
          <p className="text-xs text-ink/45">Ends the following day, after midnight.</p>
        )
      )}
      <EventLocationField initialLocation={defaultValues.location} initialManual={defaultValues.manualVenue} />
      <button
        type="submit"
        className="mt-1 rounded-full bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {submitLabel}
      </button>
    </form>
  );
}
