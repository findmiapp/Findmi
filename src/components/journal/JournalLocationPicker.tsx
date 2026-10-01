"use client";

import { useState } from "react";
import Image from "next/image";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";

/** Journal V1.1 — shared Location step for both Create (Step 2) and Edit:
 * search an existing FindMi Location, OR record a place that doesn't
 * exist on FindMi yet (manual name/address/city/state/ZIP, all optional),
 * with an optional "suggest this place to Findmi" signal. The two are
 * mutually exclusive by construction — selecting a canonical Location
 * always clears any manual text, and switching back to search clears it
 * too — so saveJournalLocation (actions.ts) never has to reconcile a row
 * carrying both. A manual Journal location is NEVER written into the
 * public `locations` table by this component or anything it calls; see
 * the migration's own comment on why `manual_location_suggested` is the
 * entire "suggest for consideration" signal for this pass. */
export interface JournalManualLocationState {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  suggest: boolean;
}

export const EMPTY_MANUAL_LOCATION: JournalManualLocationState = {
  name: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  suggest: false,
};

export function manualLocationHasText(m: JournalManualLocationState): boolean {
  return Boolean(m.name.trim() || m.address.trim() || m.city.trim() || m.state.trim() || m.zip.trim());
}

export default function JournalLocationPicker({
  location,
  onLocationChange,
  manual,
  onManualChange,
}: {
  location: JournalSearchResult | null;
  onLocationChange: (location: JournalSearchResult | null) => void;
  manual: JournalManualLocationState;
  onManualChange: (manual: JournalManualLocationState) => void;
}) {
  const [manualOpen, setManualOpen] = useState(() => manualLocationHasText(manual));

  function selectLocation(result: JournalSearchResult) {
    onManualChange(EMPTY_MANUAL_LOCATION);
    setManualOpen(false);
    onLocationChange(result);
  }

  function useSearchInstead() {
    onManualChange(EMPTY_MANUAL_LOCATION);
    setManualOpen(false);
  }

  function field(key: keyof Omit<JournalManualLocationState, "suggest">, label: string, placeholder: string) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-ink/50">{label}</label>
        <input
          type="text"
          value={manual[key]}
          onChange={(e) => onManualChange({ ...manual, [key]: e.target.value })}
          placeholder={placeholder}
          className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
        />
      </div>
    );
  }

  if (location) {
    return <SelectedLocationCard location={location} onRemove={() => onLocationChange(null)} />;
  }

  if (!manualOpen) {
    return (
      <div className="flex flex-col gap-2">
        <JournalSearchSelect entity="locations" placeholder="Search for a place…" onSelect={selectLocation} />
        <p className="text-xs text-ink/40">Search by name, city, or address — or skip this step.</p>
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="w-fit text-xs font-semibold text-findmi-700 transition hover:text-findmi-800"
        >
          Can&rsquo;t find this place? Enter location manually
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-black/10 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Enter location manually</p>
        <button type="button" onClick={useSearchInstead} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
          Use search instead
        </button>
      </div>
      {field("name", "Location name", "e.g. Friend's House")}
      {field("address", "Address", "477 Broadway")}
      {field("city", "City", "New York")}
      <div className="flex gap-2.5">
        <div className="flex-1">{field("state", "State", "NY")}</div>
        <div className="flex-1">{field("zip", "ZIP", "10013")}</div>
      </div>
      <label className="mt-1 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={manual.suggest}
          onChange={(e) => onManualChange({ ...manual, suggest: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-black/20 text-findmi focus:ring-findmi/40"
        />
        <span className="text-xs text-ink/60">
          <span className="block font-semibold text-ink/80">Suggest this place to Findmi</span>
          Submit this place for consideration as a FindMi location.
        </span>
      </label>
    </div>
  );
}

export function SelectedLocationCard({ location, onRemove }: { location: JournalSearchResult; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3">
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/5">
        {location.image_url && <Image src={location.image_url} alt="" fill unoptimized sizes="48px" className="object-cover" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{location.label}</p>
        {location.sublabel && <p className="truncate text-xs text-ink/55">{location.sublabel}</p>}
      </div>
      <button type="button" onClick={onRemove} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
        Remove
      </button>
    </div>
  );
}
