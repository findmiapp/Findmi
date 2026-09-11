"use client";

import { useEffect, useState } from "react";
import MarketAreaFields, { type MarketWithAreaOptions } from "@/components/MarketAreaFields";
import { useGeographySuggestion } from "@/lib/useGeographySuggestion";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface LocationGeographyFieldsProps {
  markets: MarketWithAreaOptions[];
  defaultCity: string;
  defaultState: string;
  defaultMarketId: string;
  defaultAreaId: string;
  defaultRequestedMarketText: string;
  /** Business creation's City/State are labeled "(optional)"; Location's
   * are not (a physical venue's city/state has always been plain,
   * unlabeled required-in-spirit fields on this form) — kept exactly as
   * each page already had it rather than unifying wording this pass
   * wasn't asked to touch. */
  cityStateOptionalLabel?: boolean;
}

/**
 * Geography Foundation Pass 2 — the Location counterpart of
 * BusinessGeographyFields, extended to also suggest an Area (Location
 * creation already stores one — unlike Business — via the existing
 * MarketAreaFields cascading picker). Owns City/State the same way
 * BusinessGeographyFields does, so it can react to them without a
 * separate lifted-state wrapper.
 *
 * A matched Area or Market pre-fills MarketAreaFields' own defaults; a
 * remount (via `key`) is used to apply a NEW suggestion to that
 * component, since MarketAreaFields intentionally owns its Market/Area
 * selection as plain internal state once mounted (same reason its own
 * "changing Market clears Area" reset only works client-side) — this
 * keeps MarketAreaFields itself completely unchanged, per this pass's
 * own scope. No match automatically prepares a Market Request from the
 * same city/state text — never a second manual "type it again" field —
 * while creation continues exactly as it already did on no match.
 */
export default function LocationGeographyFields({
  markets,
  defaultCity,
  defaultState,
  defaultMarketId,
  defaultAreaId,
  defaultRequestedMarketText,
  cityStateOptionalLabel,
}: LocationGeographyFieldsProps) {
  const [city, setCity] = useState(defaultCity);
  const [state, setState] = useState(defaultState);
  const [overridden, setOverridden] = useState(Boolean(defaultMarketId || defaultAreaId || defaultRequestedMarketText));
  const { status, suggestion } = useGeographySuggestion(city, state, !overridden);

  // MarketAreaFields is a fully self-contained, uncontrolled picker (see
  // its own doc comment) — remounting it via `key` whenever a NEW
  // suggestion is applied is the smallest way to hand it a fresh default
  // without touching that shared component at all.
  const [appliedKey, setAppliedKey] = useState(0);
  useEffect(() => {
    if (!overridden && status === "matched") setAppliedKey((k) => k + 1);
  }, [overridden, status, suggestion]);

  const showManualPicker = overridden || status === "idle" || status === "matched";
  const requestedMarketText =
    !overridden && status === "no_match" ? [city.trim(), state.trim()].filter(Boolean).join(", ") : "";

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            City {cityStateOptionalLabel && <span className="font-normal text-ink/40">(optional)</span>}
          </span>
          <input type="text" name="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            State {cityStateOptionalLabel && <span className="font-normal text-ink/40">(optional)</span>}
          </span>
          <input type="text" name="state" value={state} onChange={(e) => setState(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div>
        {!showManualPicker && (
          <span className="mb-1.5 block text-sm font-medium text-ink">
            Findmi area <span className="font-normal text-ink/40">(optional)</span>
          </span>
        )}

        {!overridden && status === "checking" && (
          <p className="rounded-xl border border-black/10 bg-mist/30 px-3.5 py-2.5 text-sm text-ink/50">
            Checking Findmi…
          </p>
        )}

        {!overridden && status === "matched" && suggestion && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-findmi/25 bg-findmi-50 px-3.5 py-2.5 text-sm text-findmi-700">
            <span>
              Suggested Findmi area: <strong>{suggestion.label}</strong>
            </span>
          </div>
        )}

        {!overridden && status === "no_match" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-mist/30 px-3.5 py-2.5 text-sm text-ink/60">
            <span>
              No Findmi area yet for &ldquo;{[city, state].filter(Boolean).join(", ")}&rdquo; — we&rsquo;ll add it for
              review.
            </span>
            <button
              type="button"
              onClick={() => setOverridden(true)}
              className="text-xs font-semibold underline underline-offset-2"
            >
              Choose an existing area instead
            </button>
          </div>
        )}

        {showManualPicker && (
          <MarketAreaFields
            key={appliedKey}
            markets={markets}
            defaultMarketId={!overridden && suggestion ? suggestion.marketId : defaultMarketId}
            defaultAreaId={!overridden && suggestion?.type === "area" ? (suggestion.areaId ?? null) : defaultAreaId}
            marketLabel="Findmi area"
            areaLabel="Specific area"
            blankMarketOptionLabel="Choose an area"
            noAreasAvailableLabel="No specific area available here"
            noSpecificAreaLabel="No specific area"
          />
        )}

        {!overridden && status === "matched" && (
          <button
            type="button"
            onClick={() => setOverridden(true)}
            className="mt-1.5 text-xs font-semibold text-ink/50 underline underline-offset-2"
          >
            Change area
          </button>
        )}
        {overridden && (city.trim() || state.trim()) && (
          <button
            type="button"
            onClick={() => setOverridden(false)}
            className="mt-1.5 text-xs font-semibold text-ink/50 underline underline-offset-2"
          >
            Use Findmi&rsquo;s suggestion instead
          </button>
        )}

        <p className="mt-1.5 text-xs text-ink/45">You can add or change this later from your Location Manager.</p>
      </div>

      <input type="hidden" name="requested_market_text" value={requestedMarketText} />
    </>
  );
}
