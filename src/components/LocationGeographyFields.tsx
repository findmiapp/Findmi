"use client";

import { useState } from "react";
import CanonicalGeographyPicker from "@/components/geo/CanonicalGeographyPicker";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface LocationGeographyFieldsProps {
  defaultCity: string;
  defaultState: string;
  /** Business creation's City/State are labeled "(optional)"; Location's
   * are not (a physical venue's city/state has always been plain,
   * unlabeled required-in-spirit fields on this form) — kept exactly as
   * each page already had it rather than unifying wording this pass
   * wasn't asked to touch. */
  cityStateOptionalLabel?: boolean;
}

/**
 * Geography Foundation Pass 2 → Personal/Account UX Correction pass — a
 * submitter provides FACTUAL geography only: name (elsewhere on the
 * form), address, City, State, and optionally an exact geocoded place.
 * Findmi's own editorial market/sub-area classification is internal
 * organization, not something an ordinary visitor should be asked to
 * self-classify into — Admin assigns it later from the real City/State on
 * file (createMemberLocation already omits market_id/market_area_id
 * entirely when this form doesn't submit them; both columns stay
 * nullable, no schema/validation change). Admin's own geography tools
 * (its own picker, the Admin Location form) are untouched — this
 * component simply doesn't render that control any more for this one
 * user-facing flow. */
export default function LocationGeographyFields({ defaultCity, defaultState, cityStateOptionalLabel }: LocationGeographyFieldsProps) {
  const [showCanonicalPicker, setShowCanonicalPicker] = useState(false);
  const [explicitGeoKey, setExplicitGeoKey] = useState("");

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            City {cityStateOptionalLabel && <span className="font-normal text-ink/40">(optional)</span>}
          </span>
          <input autoCapitalize="words" type="text" name="city" defaultValue={defaultCity} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            State {cityStateOptionalLabel && <span className="font-normal text-ink/40">(optional)</span>}
          </span>
          <input autoCapitalize="words" type="text" name="state" defaultValue={defaultState} className={inputClass} />
        </label>
      </div>

      {!showCanonicalPicker ? (
        <button
          type="button"
          onClick={() => setShowCanonicalPicker(true)}
          className="text-xs font-semibold text-ink/40 underline underline-offset-2"
        >
          Set an exact place (optional)
        </button>
      ) : (
        <CanonicalGeographyPicker
          label="Exact place (optional)"
          placeholder="City, ZIP, or neighborhood"
          onSelect={(hit) => setExplicitGeoKey(hit?.geo_key ?? "")}
        />
      )}

      <input type="hidden" name="explicit_geo_key" value={explicitGeoKey} />
    </>
  );
}
