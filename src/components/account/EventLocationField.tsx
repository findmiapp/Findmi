"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createInlinePlace } from "@/app/(public)/account/location/actions";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import PlaceFindOrCreate, { NotPublicBadge } from "@/components/places/PlaceFindOrCreate";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface SelectedLocationDetail {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Find-or-Create V1 — false when the place is known/linkable but not yet
   * public (is_demo). Optional: older callers never set it. */
  is_public?: boolean;
}

export interface ManualVenueValues {
  venue_name: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
}

const EMPTY_MANUAL: ManualVenueValues = { venue_name: "", address: "", city: "", state: "", postal_code: "" };

function fullAddress(parts: { address: string | null; city: string | null; state: string | null; postal_code: string | null }): string {
  const cityState = [parts.city, parts.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, parts.postal_code].filter(Boolean).join(" ");
  return [parts.address, cityStateZip].filter(Boolean).join(", ");
}

/** Event Manager's Location field — search an existing Findmi Location
 * (typeahead + A-Z browse via useAccountSearch("locations", …), same
 * /api/account/search route every other member-facing picker already
 * uses), show a compact selected-Location card once one is picked (name,
 * category, full address, View Location link), or fall back to manual
 * venue text entry. Used identically by the whole-event Location tab, the
 * per-occurrence Dates tab, and native Event creation — all three read
 * these same hidden field names (location_id, venue_name, address, city,
 * state, postal_code) from their own Server Action.
 *
 * Data Consistency — this component never claims to be the authority on a
 * selected Location's own address: it renders what the search result
 * already carries purely for immediate visual feedback, but every action
 * that receives a real location_id (updateMemberEventLocation,
 * addMemberEventDate, updateMemberEventDate, createMemberEvent)
 * re-fetches that Location's own columns server-side and overwrites
 * whatever this form submitted — these manual-field hidden inputs are the
 * true source of truth only on the no-Location fallback path.
 *
 * Inline Event Location Creation pass — adds a third path alongside
 * "search existing" and "enter venue manually": "Add New Location", an
 * inline panel (never a navigation away from the Event form) that collects
 * the minimum venue details, runs the same non-fuzzy duplicate check
 * createMemberLocation's own standalone page uses, and on confirmation
 * creates a genuine locations row (createInlineLocation, in
 * account/location/actions.ts) that's then selected here exactly as if it
 * had come back from search — same `selected` state, same hidden inputs,
 * same "Change Location"/"Remove Location" behavior. Manual venue entry is
 * untouched and remains fully available.
 *
 * Admin Event Location Relationship UX pass — `createLocationAction`
 * (optional, defaults to the member-facing createInlineLocation) lets
 * Admin's own Add/Edit Event form pass an admin-authorized counterpart
 * (createInlineAdminLocation, admin/locations/actions.ts) instead, since
 * createInlineLocation's Supabase-Auth-session + create_owned_location
 * ownership grant don't fit Admin's own ADMIN_PASSWORD session model. Every
 * existing caller (owner Create/Edit Event, the per-occurrence Dates
 * forms) omits this prop and is completely unaffected.
 *
 * Find-or-Create V1 — search and inline creation now come from the shared
 * PlaceFindOrCreate adapter (components/places), which searches LINKABLE
 * places (incl. not-yet-public ones, never archived/trashed) and, when a
 * place is missing, offers + Add "…" inline. The default create action is
 * createInlinePlace: it adds the place WITHOUT granting the creator
 * location membership (the old createInlineLocation made them its owner).
 * This field keeps its own selected card and manual-venue fallback. */
export default function EventLocationField({
  initialLocation,
  initialManual,
  onGeographyChange,
  onLocationChange,
  createLocationAction = createInlinePlace,
}: {
  initialLocation: SelectedLocationDetail | null;
  initialManual: ManualVenueValues | null;
  /** Geography Foundation Pass 2 — purely additive, optional hook so a
   * parent (native Event creation's own geography suggestion) can react
   * to this field's EFFECTIVE city/state, whichever source (a selected
   * real Location, or manual venue text) they currently come from,
   * without this component needing to know anything about Market/Area
   * suggestion itself. Every other existing caller (Event Manager's
   * Location tab, the per-occurrence Dates tab) omits this prop and is
   * completely unaffected. `locationName` (Geography Foundation Pass 3) is
   * non-null only when the effective geography came from a real selected
   * Location — so the parent can say "based on {name}" instead of leaving
   * the owner to wonder whether they still need to separately resolve
   * geography for a venue they already picked. */
  onGeographyChange?: (geography: { city: string; state: string; locationName: string | null }) => void;
  /** Schedule Authoring V4 — purely additive, optional hook so a parent
   * that has no <form> of its own to read hidden inputs from (the bulk
   * date generation composer, which builds its own in-memory draft rows
   * instead of submitting a form) can capture this field's full current
   * selection — either a real Location or manual venue text, never both —
   * as plain data. Every existing caller (Location tab, per-occurrence
   * Dates forms) omits this and is completely unaffected; this never
   * changes what the field itself renders or how its own hidden inputs
   * post for a real <form> caller. */
  onLocationChange?: (value: { location: SelectedLocationDetail | null; manualVenue: ManualVenueValues | null }) => void;
  createLocationAction?: (formData: FormData) => Promise<CreateInlineLocationResult>;
}) {
  const hasManualSeed = Boolean(
    initialManual && (initialManual.venue_name || initialManual.address || initialManual.city || initialManual.state || initialManual.postal_code)
  );
  const [selected, setSelected] = useState<SelectedLocationDetail | null>(initialLocation);
  const [manualOpen, setManualOpen] = useState(!initialLocation && hasManualSeed);
  const [manual, setManual] = useState<ManualVenueValues>(initialManual ?? EMPTY_MANUAL);
  const address = selected ? fullAddress(selected) : "";
  const effectiveCity = selected ? (selected.city ?? "") : manual.city;
  const effectiveState = selected ? (selected.state ?? "") : manual.state;

  useEffect(() => {
    onGeographyChange?.({ city: effectiveCity, state: effectiveState, locationName: selected?.name ?? null });
    // onGeographyChange is expected to be a stable identity (or omitted)
    // from the one caller that passes it — only the effective city/state/
    // selected-Location values should retrigger this, same as every other
    // derived-value effect in this codebase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCity, effectiveState, selected]);

  useEffect(() => {
    onLocationChange?.({ location: selected, manualVenue: selected ? null : manual });
    // Same stable-identity expectation as onGeographyChange above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, manual]);

  return (
    <div className="flex flex-col gap-2">
      <span className="block text-sm font-medium text-ink">Location</span>
      <input type="hidden" name="location_id" value={selected?.id ?? ""} />
      <input type="hidden" name="venue_name" value={selected ? selected.name : manual.venue_name} />
      <input type="hidden" name="address" value={selected ? (selected.address ?? "") : manual.address} />
      <input type="hidden" name="city" value={effectiveCity} />
      <input type="hidden" name="state" value={effectiveState} />
      <input type="hidden" name="postal_code" value={selected ? (selected.postal_code ?? "") : manual.postal_code} />

      {selected ? (
        <div className="rounded-xl border border-black/10 bg-white p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-semibold text-ink">{selected.name}</p>
            {selected.is_public === false && <NotPublicBadge />}
          </div>
          {selected.category && <p className="mt-0.5 text-xs font-medium text-findmi-700">{selected.category}</p>}
          {address && <p className="mt-1 break-words text-xs text-ink/55">{address}</p>}
          {selected.slug && selected.is_public !== false && (
            <Link
              href={`/location/${selected.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-xs font-semibold text-findmi-700 underline underline-offset-2"
            >
              View Location ↗
            </Link>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs font-semibold text-ink/60 hover:text-ink"
            >
              Change Location
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setManualOpen(true);
              }}
              className="text-xs font-semibold text-ink/60 hover:text-ink"
            >
              Remove Location / Use manual venue
            </button>
          </div>
        </div>
      ) : (
        <>
          <PlaceFindOrCreate onSelect={setSelected} createAction={createLocationAction} />

          {!manualOpen && (
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="w-fit text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink"
            >
              Enter venue text only (no Findmi place)
            </button>
          )}

          {manualOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Venue / location name</span>
                <input
                  type="text"
                  value={manual.venue_name}
                  onChange={(e) => setManual((m) => ({ ...m, venue_name: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Address</span>
                <input
                  type="text"
                  value={manual.address}
                  onChange={(e) => setManual((m) => ({ ...m, address: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">City</span>
                  <input
                    type="text"
                    value={manual.city}
                    onChange={(e) => setManual((m) => ({ ...m, city: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">State</span>
                  <input
                    type="text"
                    value={manual.state}
                    onChange={(e) => setManual((m) => ({ ...m, state: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">ZIP</span>
                  <input
                    type="text"
                    value={manual.postal_code}
                    onChange={(e) => setManual((m) => ({ ...m, postal_code: e.target.value }))}
                    className={inputClass}
                  />
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
