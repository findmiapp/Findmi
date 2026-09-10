"use client";

import { useRef, useState } from "react";
import MemberImageField from "./MemberImageField";
import { AccountRelationField, type AccountSearchResult } from "@/components/account/AccountRelationPicker";

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
  /** Location Connections pass — an existing Findmi Location this
   * standalone appearance is at, if any. Picking one here auto-fills
   * venue_name/address/city/state below from that Location's own real
   * data, same "location is authoritative, text is a snapshot" pattern
   * Event Manager's own occurrence Location picker already uses. */
  location: AccountSearchResult | null;
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
  const venueNameRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  // Picking an existing Findmi Location fills the plain text fields below
  // from its own real name/city/state — a convenience snapshot, never the
  // source of truth once location_id is set (see getUpcomingAtLocation's
  // FK-first matching). Address isn't returned by the account search
  // endpoint (only name/city/state), so it's left for the visitor to add
  // if they want it; the Location link itself is what makes this
  // appearance findable from that Location's own page either way.
  function handleLocationSelect(location: AccountSearchResult | null) {
    if (!location) return;
    if (venueNameRef.current) venueNameRef.current.value = location.label;
    const [city, state] = (location.sublabel ?? "").split(",").map((s) => s.trim());
    if (cityRef.current && city) cityRef.current.value = city;
    if (stateRef.current && state) stateRef.current.value = state;
  }

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
        placeholder="Event/Place Name"
        className={inputClass}
      />
      <div className="grid grid-cols-3 gap-2">
        <input type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        <input type="time" name="start_time" required defaultValue={defaultValues.start_time} className={inputClass} />
        <input type="time" name="end_time" required defaultValue={defaultValues.end_time} className={inputClass} />
      </div>
      {timeError && <p className="text-xs text-red-600">{timeError}</p>}
      <AccountRelationField
        label="Findmi Location (optional)"
        name="location_id"
        entity="locations"
        initial={defaultValues.location}
        placeholder="Search Findmi Locations…"
        clearLabel="Not a Findmi Location"
        onSelect={handleLocationSelect}
      />
      <input
        ref={venueNameRef}
        type="text"
        name="venue_name"
        defaultValue={defaultValues.venue_name}
        placeholder="Venue Name"
        className={inputClass}
      />
      <input type="text" name="address" defaultValue={defaultValues.address} placeholder="Address" className={inputClass} />
      <div className="grid grid-cols-2 gap-2">
        <input ref={cityRef} type="text" name="city" defaultValue={defaultValues.city} placeholder="City" className={inputClass} />
        <input ref={stateRef} type="text" name="state" defaultValue={defaultValues.state} placeholder="State" className={inputClass} />
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
        label="Photo (optional)"
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
