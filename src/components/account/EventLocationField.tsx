"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createInlinePlace } from "@/app/(public)/account/location/actions";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import PlaceFindOrCreate, { NotPublicBadge, placeResultToDetail } from "@/components/places/PlaceFindOrCreate";
import { useAccountSearch } from "@/components/account/useAccountSearch";
import {
  cancelManualVenue,
  clearPlace,
  initialWhereState,
  openManualVenue,
  selectPlace,
  whereSubmission,
  type WhereFieldState,
} from "@/lib/event-location-field";

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
  // Findmi Place first, manual venue second — every transition goes
  // through lib/event-location-field so the submitted values can never
  // carry a stale Location id or stale venue text.
  const [where, setWhere] = useState<WhereFieldState<SelectedLocationDetail>>(() => initialWhereState(initialLocation, initialManual));
  const { selected, manual, manualOpen } = where;
  const setManual = (update: (m: ManualVenueValues) => ManualVenueValues) => setWhere((w) => ({ ...w, manual: update(w.manual) }));
  const submitted = whereSubmission(where);
  const address = selected ? fullAddress(selected) : "";
  const effectiveCity = submitted.city;
  const effectiveState = submitted.state;

  useEffect(() => {
    onGeographyChange?.({ city: effectiveCity, state: effectiveState, locationName: selected?.name ?? null });
    // onGeographyChange is expected to be a stable identity (or omitted)
    // from the one caller that passes it — only the effective city/state/
    // selected-Location values should retrigger this, same as every other
    // derived-value effect in this codebase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCity, effectiveState, selected]);

  useEffect(() => {
    onLocationChange?.({
      location: selected,
      manualVenue: selected
        ? null
        : { venue_name: submitted.venue_name, address: submitted.address, city: submitted.city, state: submitted.state, postal_code: submitted.postal_code },
    });
    // Same stable-identity expectation as onGeographyChange above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, manual, manualOpen]);

  return (
    <div className="flex flex-col gap-2">
      <span className="block text-sm font-medium text-ink">Where</span>
      <input type="hidden" name="location_id" value={submitted.location_id} />
      <input type="hidden" name="venue_name" value={submitted.venue_name} />
      <input type="hidden" name="address" value={submitted.address} />
      <input type="hidden" name="city" value={submitted.city} />
      <input type="hidden" name="state" value={submitted.state} />
      <input type="hidden" name="postal_code" value={submitted.postal_code} />

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
              onClick={() => setWhere(clearPlace)}
              className="text-xs font-semibold text-ink/60 hover:text-ink"
            >
              Change Place
            </button>
            <button
              type="button"
              onClick={() => setWhere(openManualVenue)}
              className="text-xs font-semibold text-ink/60 hover:text-ink"
            >
              Add Venue Details Manually
            </button>
          </div>
        </div>
      ) : (
        <>
          {!manualOpen && <p className="text-xs text-ink/50">Search Findmi Places first. If the venue is already on Findmi, select it.</p>}
          <PlaceFindOrCreate onSelect={(place) => setWhere((w) => selectPlace(w, place))} createAction={createLocationAction} />

          {!manualOpen && (
            <button
              type="button"
              onClick={() => setWhere(openManualVenue)}
              className="w-fit text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink"
            >
              Add Venue Details Manually
            </button>
          )}

          {manualOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-black/10 bg-mist/30 p-3.5">
              {/* Consolidation pass — never silently disconnected: say what
                  these details become, and keep matching them against
                  Findmi Locations while they're typed. */}
              <p className="text-xs text-ink/60">
                These venue details stay on this Event only — they don&rsquo;t create a Findmi Location. To add the place to Findmi (pending review), use{" "}
                <span className="font-semibold">Add New Location</span> above.
              </p>
              <ManualVenueMatches query={manual.address.trim().length >= 4 ? manual.address : manual.venue_name} onUse={(place) => setWhere((w) => selectPlace(w, place))} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink/70">Venue Details</span>
                <button
                  type="button"
                  onClick={() => setWhere(cancelManualVenue)}
                  className="text-xs font-semibold text-ink/50 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Venue Name</span>
                <input autoCapitalize="words"
                  type="text"
                  value={manual.venue_name}
                  onChange={(e) => setManual((m) => ({ ...m, venue_name: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Address</span>
                <input autoCapitalize="words"
                  type="text"
                  value={manual.address}
                  onChange={(e) => setManual((m) => ({ ...m, address: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">City</span>
                  <input autoCapitalize="words"
                    type="text"
                    value={manual.city}
                    onChange={(e) => setManual((m) => ({ ...m, city: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">State</span>
                  <input autoCapitalize="words"
                    type="text"
                    value={manual.state}
                    onChange={(e) => setManual((m) => ({ ...m, state: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">Postal Code</span>
                  <input autoCapitalize="none"
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

/** Manual venue entry still searches Findmi (debounced, bounded) so an
 * existing Location is offered instead of a disconnected duplicate. */
function ManualVenueMatches({ query, onUse }: { query: string; onUse: (place: SelectedLocationDetail) => void }) {
  const q = query.trim();
  const { results } = useAccountSearch("locations", q.length >= 3 ? q : "", { scope: "place" });
  const matches = q.length >= 3 ? results.slice(0, 3).map(placeResultToDetail) : [];
  if (matches.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5" aria-live="polite">
      <p className="text-xs font-semibold text-amber-900">Is it one of these Findmi Locations?</p>
      {matches.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{m.name}</span>
            <span className="block truncate text-xs text-ink/55">{[m.address, [m.city, m.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
          </span>
          <button type="button" onClick={() => onUse(m)} className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-black/20">
            Use This Location
          </button>
        </div>
      ))}
    </div>
  );
}
