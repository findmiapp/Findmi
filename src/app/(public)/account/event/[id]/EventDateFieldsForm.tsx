"use client";

import { useState } from "react";
import EventLocationField, {
  type ManualVenueValues,
  type SelectedLocationDetail,
} from "@/components/account/EventLocationField";

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
 * Dates tab — same client-side end-after-start check as Business
 * Manager's AppearanceFieldsForm (a fast common-mistake catch; server-side
 * validation in ../actions.ts remains the real authority). Deliberately
 * never surfaces the word "occurrence" or a raw occurrence id — the
 * caller (the page) supplies which one this form edits via `action`'s own
 * bound argument, never a field in this form. */
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const date = (form.elements.namedItem("date") as HTMLInputElement | null)?.value;
    const startTime = (form.elements.namedItem("start_time") as HTMLInputElement | null)?.value;
    const endTime = (form.elements.namedItem("end_time") as HTMLInputElement | null)?.value;
    if (date && startTime && endTime && `${date}T${endTime}` <= `${date}T${startTime}`) {
      e.preventDefault();
      setTimeError("End time must be after the start time.");
      return;
    }
    setTimeError(null);
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <input type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        <input type="time" name="start_time" required defaultValue={defaultValues.start_time} className={inputClass} />
        <input type="time" name="end_time" required defaultValue={defaultValues.end_time} className={inputClass} />
      </div>
      {timeError && <p className="text-xs text-red-600">{timeError}</p>}
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
