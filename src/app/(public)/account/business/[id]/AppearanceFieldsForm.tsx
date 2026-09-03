"use client";

import { useState } from "react";
import MemberImageField from "./MemberImageField";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface AppearanceFieldValues {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  venue_name: string;
  address: string;
  city: string;
  state: string;
  external_url: string;
  flyer_image_url: string | null;
}

/** Shared fields for both "Add an appearance manually" and "Edit
 * appearance" — a Client Component only so it can catch the single most
 * common mistake (an end time at/before the start time — e.g. AM instead
 * of PM) BEFORE ever submitting: no page refresh, no round trip, nothing
 * entered is at risk. Server-side validation in ../actions.ts is
 * unchanged and remains the real authority (native form fields can still
 * reach the server with JS disabled, or via a crafted request) — this is
 * purely a fast client-side check for the common case; a genuine
 * server-side rejection still preserves every submitted value via the
 * add_* / edit_* query params the page reads back into `defaultValues`,
 * same principle, just the other half of it. */
export default function AppearanceFieldsForm({
  businessId,
  action,
  defaultValues,
  submitLabel,
}: {
  businessId: string;
  action: (formData: FormData) => void | Promise<void>;
  defaultValues: AppearanceFieldValues;
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
      <input
        type="text"
        name="title"
        required
        defaultValue={defaultValues.title}
        placeholder="Appearance/Event Name"
        className={inputClass}
      />
      <div className="grid grid-cols-3 gap-2">
        <input type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        <input type="time" name="start_time" required defaultValue={defaultValues.start_time} className={inputClass} />
        <input type="time" name="end_time" required defaultValue={defaultValues.end_time} className={inputClass} />
      </div>
      {timeError && <p className="text-xs text-red-600">{timeError}</p>}
      <input
        type="text"
        name="venue_name"
        defaultValue={defaultValues.venue_name}
        placeholder="Venue Name"
        className={inputClass}
      />
      <input type="text" name="address" defaultValue={defaultValues.address} placeholder="Address" className={inputClass} />
      <div className="grid grid-cols-2 gap-2">
        <input type="text" name="city" defaultValue={defaultValues.city} placeholder="City" className={inputClass} />
        <input type="text" name="state" defaultValue={defaultValues.state} placeholder="State" className={inputClass} />
      </div>
      <input
        type="url"
        name="external_url"
        defaultValue={defaultValues.external_url}
        placeholder="Link (optional)"
        className={inputClass}
      />
      <MemberImageField
        businessId={businessId}
        label="Appearance Image (optional)"
        name="flyer_image_url"
        defaultValue={defaultValues.flyer_image_url}
      />
      <button
        type="submit"
        className="mt-1 rounded-full bg-findmi px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {submitLabel}
      </button>
    </form>
  );
}
