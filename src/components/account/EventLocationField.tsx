"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useAccountSearch, type AccountSearchResult } from "./useAccountSearch";
import { createInlineLocation } from "@/app/(public)/account/location/actions";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";

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

function resultToSelected(r: AccountSearchResult): SelectedLocationDetail {
  return {
    id: r.value,
    name: r.label,
    slug: r.slug ?? "",
    category: r.category ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    postal_code: r.postal_code ?? null,
  };
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
 * forms) omits this prop and is completely unaffected. */
export default function EventLocationField({
  initialLocation,
  initialManual,
  onGeographyChange,
  onLocationChange,
  createLocationAction = createInlineLocation,
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useAccountSearch("locations", query, { browseEmpty: true });

  // Inline Event Location Creation pass — the "Add New Location" panel's
  // own, entirely separate draft state. Deliberately never shares state
  // with `manual` above: switching between "enter venue manually" and "add
  // a new Location" is a real choice between two different outcomes (no
  // Findmi entity vs. a genuine one), not the same fields relabeled.
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ManualVenueValues>(EMPTY_MANUAL);
  const [addError, setAddError] = useState<string | null>(null);
  const [addDuplicates, setAddDuplicates] = useState<SelectedLocationDetail[] | null>(null);
  const [isCreating, startCreating] = useTransition();

  function pick(r: AccountSearchResult) {
    setSelected(resultToSelected(r));
    setQuery("");
    setOpen(false);
  }

  function closeAddPanel() {
    setAddOpen(false);
    setAddError(null);
    setAddDuplicates(null);
  }

  function selectDuplicate(candidate: SelectedLocationDetail) {
    setSelected(candidate);
    setAddForm(EMPTY_MANUAL);
    closeAddPanel();
  }

  function submitNewLocation(force: boolean) {
    if (!addForm.venue_name.trim() || !addForm.address.trim() || !addForm.city.trim() || !addForm.state.trim() || !addForm.postal_code.trim()) {
      setAddError("Fill in all fields to add this venue.");
      return;
    }
    setAddError(null);
    const fd = new FormData();
    fd.set("name", addForm.venue_name);
    fd.set("address", addForm.address);
    fd.set("city", addForm.city);
    fd.set("state", addForm.state);
    fd.set("postal_code", addForm.postal_code);
    if (force) fd.set("force", "1");
    startCreating(async () => {
      const result = await createLocationAction(fd);
      if (result.status === "error") {
        setAddError(result.error);
        return;
      }
      if (result.status === "duplicates") {
        setAddDuplicates(result.duplicates);
        return;
      }
      setSelected(result.location);
      setAddForm(EMPTY_MANUAL);
      closeAddPanel();
    });
  }

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
          <p className="break-words text-sm font-semibold text-ink">{selected.name}</p>
          {selected.category && <p className="mt-0.5 text-xs font-medium text-findmi-700">{selected.category}</p>}
          {address && <p className="mt-1 break-words text-xs text-ink/55">{address}</p>}
          {selected.slug && (
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
              onClick={() => {
                setSelected(null);
                setOpen(true);
              }}
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
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              placeholder="Search Findmi Locations…"
              className={inputClass}
            />
            {open && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-black/10 bg-white shadow-lg">
                {loading ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink/40">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink/40">{query.trim() ? "No matches." : "No Locations yet."}</p>
                ) : (
                  results.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(r);
                      }}
                      className="flex w-full flex-col items-start px-3.5 py-2.5 text-left hover:bg-black/[0.03]"
                    >
                      <span className="text-sm text-ink">{r.label}</span>
                      {r.sublabel && <span className="text-xs text-ink/45">{r.sublabel}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {!manualOpen && !addOpen && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="w-fit text-xs font-semibold text-findmi-700 underline underline-offset-2 hover:text-findmi-800"
              >
                Can&rsquo;t find it? Add New Location
              </button>
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="w-fit text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink"
              >
                Enter venue manually
              </button>
            </div>
          )}

          {addOpen && (
            <div className="flex flex-col gap-2 rounded-xl border border-findmi/25 bg-findmi-50/40 p-3.5">
              <p className="text-xs font-medium text-ink/60">
                Add this venue to Findmi so it can be found here and reused for future events.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Location name</span>
                <input
                  type="text"
                  value={addForm.venue_name}
                  onChange={(e) => setAddForm((m) => ({ ...m, venue_name: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink/70">Street address</span>
                <input
                  type="text"
                  value={addForm.address}
                  onChange={(e) => setAddForm((m) => ({ ...m, address: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">City</span>
                  <input
                    type="text"
                    value={addForm.city}
                    onChange={(e) => setAddForm((m) => ({ ...m, city: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">State</span>
                  <input
                    type="text"
                    value={addForm.state}
                    onChange={(e) => setAddForm((m) => ({ ...m, state: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink/70">ZIP</span>
                  <input
                    type="text"
                    value={addForm.postal_code}
                    onChange={(e) => setAddForm((m) => ({ ...m, postal_code: e.target.value }))}
                    className={inputClass}
                  />
                </label>
              </div>

              {addError && <p className="text-xs text-red-600">{addError}</p>}

              {addDuplicates && addDuplicates.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-ink">This location may already be on Findmi</p>
                  {addDuplicates.map((d) => (
                    <div key={d.id} className="rounded-lg border border-black/10 bg-white p-2.5">
                      <p className="break-words text-sm font-semibold text-ink">{d.name}</p>
                      {(d.city || d.state) && (
                        <p className="text-xs text-ink/55">{[d.city, d.state].filter(Boolean).join(", ")}</p>
                      )}
                      {d.address && <p className="break-words text-xs text-ink/45">{d.address}</p>}
                      <button
                        type="button"
                        onClick={() => selectDuplicate(d)}
                        className="mt-1.5 text-xs font-semibold text-findmi-700 underline underline-offset-2"
                      >
                        Use This Location
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    <button
                      type="button"
                      onClick={() => submitNewLocation(true)}
                      disabled={isCreating}
                      className="text-xs font-semibold text-ink/60 underline underline-offset-2 hover:text-ink disabled:opacity-50"
                    >
                      {isCreating ? "Creating…" : "Create New Anyway"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddDuplicates(null)}
                      className="text-xs font-semibold text-ink/40 hover:text-ink"
                    >
                      Edit Details
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <button
                    type="button"
                    onClick={() => submitNewLocation(false)}
                    disabled={isCreating}
                    className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-50"
                  >
                    {isCreating ? "Adding…" : "Add This Location"}
                  </button>
                  <button type="button" onClick={closeAddPanel} className="text-xs font-semibold text-ink/50 hover:text-ink">
                    Cancel
                  </button>
                </div>
              )}
            </div>
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
