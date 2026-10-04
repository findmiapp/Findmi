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

/** City/state for a picked place — prefers the search result's own
 * structured city/state, falling back to its "City, ST" sublabel (the
 * shape server-seeded `initial` values use). */
function locationCityState(location: AccountSearchResult): [string | null, string | null] {
  if (location.city !== undefined || location.state !== undefined) {
    return [location.city ?? null, location.state ?? null];
  }
  const [city, state] = (location.sublabel ?? "").split(",").map((s) => s.trim());
  return [city || null, state || null];
}

function clearIfEquals(input: HTMLInputElement | null, value: string | null) {
  if (input && value && input.value.trim() === value.trim()) input.value = "";
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
  const [imageUploading, setImageUploading] = useState(false);
  const venueNameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);

  // Physical Presence Pass 1 — the Findmi place picker is the primary
  // path; manual venue entry is a secondary disclosure. `linked` mirrors
  // the picker's own selection (the picker still owns the hidden
  // location_id input). The manual group starts open only for an
  // unlinked appearance that already has venue text (a legacy/manual
  // record must stay visible and editable — never silently linked).
  const [linked, setLinked] = useState<AccountSearchResult | null>(defaultValues.location);
  const hasManualText = Boolean(
    defaultValues.venue_name || defaultValues.address || defaultValues.city || defaultValues.state
  );
  const [manualOpen, setManualOpen] = useState(!defaultValues.location && hasManualText);

  // Picking an existing Findmi Location fills the plain text fields below
  // from its own real name/city/state/address — a convenience snapshot,
  // never the source of truth once location_id is set (see
  // getUpcomingAtLocation's FK-first matching). Launch Stability pass —
  // `address` IS returned by the account search endpoint (it was already
  // there in AccountSearchResult; the field just wasn't being read here),
  // so it's now hydrated the same as venue_name/city/state instead of
  // requiring the visitor to retype a canonical Location's own address.
  //
  // Physical Presence Pass 1 — un-linking ("Change") clears only the
  // snapshot values that still exactly match the place being removed, so
  // an unlinked save can never keep displaying that place's name while no
  // longer actually being connected to it. Anything the owner typed
  // themselves is left alone.
  function handleLocationSelect(location: AccountSearchResult | null) {
    if (!location) {
      if (linked) {
        const [prevCity, prevState] = locationCityState(linked);
        clearIfEquals(venueNameRef.current, linked.label);
        clearIfEquals(addressRef.current, linked.address ?? null);
        clearIfEquals(cityRef.current, prevCity);
        clearIfEquals(stateRef.current, prevState);
      }
      setLinked(null);
      return;
    }
    setLinked(location);
    setManualOpen(false);
    if (venueNameRef.current) venueNameRef.current.value = location.label;
    if (addressRef.current && location.address) addressRef.current.value = location.address;
    const [city, state] = locationCityState(location);
    if (cityRef.current && city) cityRef.current.value = city;
    if (stateRef.current && state) stateRef.current.value = state;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Launch Stability pass — Save-During-Upload race fix. MemberImageField
    // reports its own upload-pending state up via onPendingChange; blocking
    // submit here (not just disabling the button) also covers Enter-to-
    // submit and any other non-click submission path.
    if (imageUploading) {
      e.preventDefault();
      return;
    }
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
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/60">Name</span>
        <input
          type="text"
          name="title"
          required
          defaultValue={defaultValues.title}
          placeholder="e.g. Fall Candle Workshop"
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">Date</span>
          <input type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">Start</span>
          <input type="time" name="start_time" required defaultValue={defaultValues.start_time} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink/60">End</span>
          <input type="time" name="end_time" required defaultValue={defaultValues.end_time} className={inputClass} />
        </label>
      </div>
      {timeError && <p className="text-xs text-red-600">{timeError}</p>}
      {/* Physical Presence Pass 1 — the Findmi place picker is primary.
          Venue Name/Address/City/State stay MOUNTED at all times (the
          Server Action still reads them, and a selected place's snapshot
          is written into them); they're only visually hidden until the
          owner explicitly chooses manual entry, or when an unlinked
          record already has venue text to show. */}
      <AccountRelationField
        label="Where will you be?"
        name="location_id"
        entity="locations"
        initial={defaultValues.location}
        placeholder="Search Findmi places…"
        clearLabel={null}
        hint="Pick the place so this shows up on its Findmi page too."
        hideHintWhenSelected
        selectedBadge="Linked Findmi place"
        onSelect={handleLocationSelect}
      />
      {!linked && !manualOpen && (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="w-fit text-xs font-semibold text-findmi-700 hover:underline"
        >
          Can&rsquo;t find the place? Enter details manually
        </button>
      )}
      <div className={`mt-1 flex-col gap-2 ${!linked && manualOpen ? "flex" : "hidden"}`}>
        <span className="text-xs font-semibold uppercase tracking-wide text-ink/35">Venue details</span>
        <input
          ref={venueNameRef}
          type="text"
          name="venue_name"
          defaultValue={defaultValues.venue_name}
          placeholder="Venue Name"
          className={inputClass}
        />
        <input
          ref={addressRef}
          type="text"
          name="address"
          defaultValue={defaultValues.address}
          placeholder="Address"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-2">
          <input ref={cityRef} type="text" name="city" defaultValue={defaultValues.city} placeholder="City" className={inputClass} />
          <input ref={stateRef} type="text" name="state" defaultValue={defaultValues.state} placeholder="State" className={inputClass} />
        </div>
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
        onPendingChange={setImageUploading}
      />
      {imageUploading && <p className="text-xs text-ink/50">Waiting for your photo to finish uploading…</p>}
      <button
        type="submit"
        disabled={imageUploading}
        className="mt-1 w-fit rounded-2xl bg-findmi px-5 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
