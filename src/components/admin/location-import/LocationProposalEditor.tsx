"use client";

import { LOCATION_WEEKDAYS, formatDayHoursCompact, hasAnyHours } from "@/lib/locationHours";
import type { Category } from "@/lib/types";
import type { LocationCreateInput, LocationField, LocationProposal } from "@/lib/location-import/types";

/** Location Import V1 — the ONE review editor for a proposed new Location,
 * shared by Admin → Locations → Import Locations and Admin Event Import's
 * missing-Location step. Shows what Findmi knows (and where it came from),
 * lets the operator correct every supported field, and chooses whether to
 * use each verified website image. Nothing here writes. */

export interface LocationDraft extends LocationProposal {
  useHours: boolean;
  useCoordinates: boolean;
  useLogo: boolean;
  useCover: boolean;
}

export function draftFromProposal(p: LocationProposal, previous?: LocationDraft | null): LocationDraft {
  return {
    ...p,
    useHours: previous?.useHours ?? true,
    useCoordinates: previous?.useCoordinates ?? true,
    useLogo: previous?.useLogo ?? true,
    useCover: previous?.useCover ?? true,
  };
}

/** A website read fills ONLY what the operator hasn't typed (their edits
 * always win over a later read). */
export function mergeWebsiteProposal(current: LocationDraft, fresh: LocationProposal): LocationDraft {
  const keep = (field: keyof LocationProposal) => current[field] !== "" && current[field] !== null;
  const next: LocationDraft = { ...current, conflicts: fresh.conflicts, notes: fresh.notes, logo: fresh.logo, cover: fresh.cover, sources: { ...fresh.sources, ...current.sources } };
  for (const f of ["name", "address", "city", "state", "postalCode", "phone", "description"] as const) {
    if (!keep(f)) next[f] = fresh[f];
  }
  if (!current.categoryId) next.categoryId = fresh.categoryId;
  if (!current.hours) next.hours = fresh.hours;
  if (current.latitude == null || current.longitude == null) {
    next.latitude = fresh.latitude;
    next.longitude = fresh.longitude;
  }
  return next;
}

export function createInputFromDraft(d: LocationDraft): LocationCreateInput {
  return {
    name: d.name,
    address: d.address,
    city: d.city,
    state: d.state,
    postalCode: d.postalCode || null,
    website: d.website || null,
    phone: d.phone || null,
    description: d.description || null,
    categoryId: d.categoryId,
    hours: d.useHours ? d.hours : null,
    latitude: d.useCoordinates ? d.latitude : null,
    longitude: d.useCoordinates ? d.longitude : null,
    logoSourceUrl: d.useLogo ? d.logo?.sourceUrl ?? null : null,
    coverSourceUrl: d.useCover ? d.cover?.sourceUrl ?? null : null,
  };
}

const inputClass = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-body text-primary outline-none focus:border-findmi";
const labelClass = "mb-1 block text-metadata font-semibold text-secondary";

const FIELD_LABEL: Record<LocationField, string> = {
  name: "Name",
  address: "Street Address",
  city: "City",
  state: "State",
  postalCode: "ZIP",
  phone: "Phone",
  description: "Description",
  hours: "Hours",
  coordinates: "Map Position",
  category: "Category",
  website: "Website",
};

function Source({ draft, field }: { draft: LocationDraft; field: LocationField }) {
  return draft.sources[field] === "website" ? <span className="ml-1 text-[11px] font-semibold text-findmi-700">From Website</span> : null;
}

export default function LocationProposalEditor({
  draft,
  onChange,
  categories,
  idPrefix,
}: {
  draft: LocationDraft;
  onChange: (patch: Partial<LocationDraft>) => void;
  /** Location categories (kind = location). */
  categories: Category[];
  idPrefix: string;
}) {
  const text = (field: "name" | "address" | "city" | "state" | "postalCode" | "website" | "phone", label: string, span = "col-span-2") => (
    <div className={span}>
      <label htmlFor={`${idPrefix}-${field}`} className={labelClass}>
        {label}
        {field !== "website" && <Source draft={draft} field={field} />}
      </label>
      <input
        id={`${idPrefix}-${field}`}
        value={draft[field]}
        onChange={(e) => onChange({ [field]: e.target.value } as Partial<LocationDraft>)}
        className={inputClass}
        autoCapitalize={field === "website" || field === "postalCode" || field === "phone" ? "none" : "words"}
        inputMode={field === "phone" ? "tel" : field === "website" ? "url" : undefined}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {draft.conflicts.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          {draft.conflicts.map((c) => (
            <li key={c.field} className="text-metadata text-amber-900">
              <span className="font-semibold">{FIELD_LABEL[c.field]}:</span> you entered “{c.provided}” — the website says “{c.website}”.{" "}
              {c.field !== "name" && c.field !== "address" && (
                <button type="button" onClick={() => onChange({ [c.field]: c.website } as Partial<LocationDraft>)} className="font-semibold text-findmi-700 hover:underline">
                  Use Website Value
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {draft.notes.map((n) => (
        <p key={n} className="text-metadata text-secondary">
          {n}
        </p>
      ))}
      <div className="grid grid-cols-2 gap-2">
        {text("name", "Location Name")}
        {text("address", "Street Address")}
        {text("city", "City", "")}
        {text("state", "State", "")}
        {text("postalCode", "ZIP Code", "")}
        {text("phone", "Phone", "")}
        {text("website", "Website")}
        <div className="col-span-2">
          <label htmlFor={`${idPrefix}-category`} className={labelClass}>
            Category
            <Source draft={draft} field="category" />
          </label>
          <select id={`${idPrefix}-category`} value={draft.categoryId ?? ""} onChange={(e) => onChange({ categoryId: e.target.value || null })} className={inputClass}>
            <option value="">No Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor={`${idPrefix}-description`} className={labelClass}>
            Description
            <Source draft={draft} field="description" />
          </label>
          <textarea id={`${idPrefix}-description`} value={draft.description} onChange={(e) => onChange({ description: e.target.value })} rows={3} maxLength={2000} autoCapitalize="sentences" className={inputClass} />
        </div>
      </div>

      {hasAnyHours(draft.hours) && (
        <fieldset className="rounded-xl border border-black/[0.08] p-3">
          <legend className="px-1 text-label font-bold uppercase text-subtle">Hours · From Website</legend>
          <ul className="grid grid-cols-2 gap-x-3 text-metadata text-secondary">
            {LOCATION_WEEKDAYS.filter(({ key }) => draft.hours?.[key]).map(({ key, short }) => (
              <li key={key}>
                <span className="font-semibold text-primary">{short}</span> {formatDayHoursCompact(draft.hours?.[key])}
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-metadata text-primary">
            <input type="checkbox" checked={draft.useHours} onChange={(e) => onChange({ useHours: e.target.checked })} /> Use These Hours
          </label>
        </fieldset>
      )}

      {draft.latitude != null && draft.longitude != null && (
        <label className="flex items-center gap-2 text-metadata text-primary">
          <input type="checkbox" checked={draft.useCoordinates} onChange={(e) => onChange({ useCoordinates: e.target.checked })} />
          Use the website&rsquo;s map position ({draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)})
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <MediaChoice label="Profile Image" choice={draft.logo} use={draft.useLogo} onUse={(useLogo) => onChange({ useLogo })} square />
        <MediaChoice label="Cover Image" choice={draft.cover} use={draft.useCover} onUse={(useCover) => onChange({ useCover })} />
      </div>
    </div>
  );
}

function MediaChoice({ label, choice, use, onUse, square = false }: { label: string; choice: LocationProposal["logo"]; use: boolean; onUse: (use: boolean) => void; square?: boolean }) {
  const verified = Boolean(choice?.preview);
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-black/[0.08] p-2.5">
      <p className="text-label font-bold uppercase text-subtle">{label}</p>
      <div className={`relative overflow-hidden rounded-lg bg-findmi-50 ${square ? "aspect-square w-16" : "aspect-[16/9] w-full"}`}>
        {verified && use ? (
          // Data-URI preview only (re-encoded server-side; never a remote URL).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={choice!.preview!} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-findmi-700">Findmi Fallback</span>
        )}
      </div>
      <p className="text-[11px] text-secondary">{verified ? (use ? "Verified · from the website" : "Not used — fallback shown") : "None found — fallback shown"}</p>
      {verified && (
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
          <input type="checkbox" checked={use} onChange={(e) => onUse(e.target.checked)} /> Use This Image
        </label>
      )}
    </div>
  );
}
