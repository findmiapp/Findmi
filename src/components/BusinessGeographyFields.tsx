"use client";

import { useEffect, useState } from "react";
import { useGeographySuggestion } from "@/lib/useGeographySuggestion";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface BusinessGeographyFieldsProps {
  markets: { id: string; name: string }[];
  defaultCity: string;
  defaultState: string;
  defaultMarketId: string;
  defaultRequestedMarketText: string;
}

/**
 * Geography Foundation Pass 2 — replaces Business creation's old
 * "type city/state, then separately go figure out what a Findmi Market
 * is" two-step with one flow: city/state (still the same factual fields
 * as before, just now controlled so they can drive a live suggestion)
 * feed useGeographySuggestion, which reuses the existing
 * findExistingGeographyMatch(...) matcher. A match pre-fills the Primary
 * Market choice as an editable suggestion; no match automatically
 * prepares a Market Request from the SAME city/state text — the visitor
 * never has to type "Nashville" a second time into a separate field, and
 * is never sent looking for a buried "Don't see your Market?" disclosure.
 *
 * Business creation has no Area picker at creation today (see the
 * architecture audit's own Part 4A instruction: use the Market portion of
 * an Area match, don't invent new storage) — an Area match still resolves
 * the correct parent Market perfectly well; the Area itself is simply not
 * captured here, same limitation as before this pass, just no longer
 * requiring the owner to solve it manually when a Market suggestion is
 * available.
 *
 * `market_id`/`requested_market_text` are still submitted as the exact
 * same two field names createMemberBusiness already validates as
 * mutually exclusive — this component only ever fills in ONE of them at
 * a time, so that server-side "choose one or the other" rule is
 * unaffected by this pass.
 */
export default function BusinessGeographyFields({
  markets,
  defaultCity,
  defaultState,
  defaultMarketId,
  defaultRequestedMarketText,
}: BusinessGeographyFieldsProps) {
  const [city, setCity] = useState(defaultCity);
  const [state, setState] = useState(defaultState);
  const [marketId, setMarketId] = useState(defaultMarketId);
  // A prior explicit choice (a real submitted market_id/requested text —
  // including one round-tripped back after a validation error) is
  // treated as an override from the very first render, so this never
  // fights a decision the visitor already made.
  const [overridden, setOverridden] = useState(Boolean(defaultMarketId || defaultRequestedMarketText));
  const { status, suggestion } = useGeographySuggestion(city, state, !overridden);

  useEffect(() => {
    if (overridden) return;
    if (status === "matched" && suggestion) {
      setMarketId(suggestion.marketId);
    } else if (status === "no_match" || status === "idle") {
      setMarketId("");
    }
  }, [status, suggestion, overridden]);

  const showManualPicker = overridden || status === "idle";
  const requestedMarketText =
    !overridden && status === "no_match" ? [city.trim(), state.trim()].filter(Boolean).join(", ") : "";

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            City <span className="font-normal text-ink/40">(optional)</span>
          </span>
          <input
            type="text"
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            State <span className="font-normal text-ink/40">(optional)</span>
          </span>
          <input
            type="text"
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">Findmi area</span>

        {!showManualPicker && status === "checking" && (
          <p className="rounded-xl border border-black/10 bg-mist/30 px-3.5 py-2.5 text-sm text-ink/50">
            Checking Findmi…
          </p>
        )}

        {!showManualPicker && status === "matched" && suggestion && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-findmi/25 bg-findmi-50 px-3.5 py-2.5 text-sm text-findmi-700">
            <span>
              Suggested Findmi area: <strong>{suggestion.label}</strong>
            </span>
            <button
              type="button"
              onClick={() => setOverridden(true)}
              className="text-xs font-semibold underline underline-offset-2"
            >
              Change area
            </button>
          </div>
        )}

        {!showManualPicker && status === "no_match" && (
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
          <>
            <select
              value={marketId}
              onChange={(e) => {
                setMarketId(e.target.value);
                setOverridden(true);
              }}
              className={inputClass}
            >
              <option value="">Choose an area</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {overridden && (city.trim() || state.trim()) && (
              <button
                type="button"
                onClick={() => setOverridden(false)}
                className="mt-1.5 text-xs font-semibold text-ink/50 underline underline-offset-2"
              >
                Use Findmi&rsquo;s suggestion instead
              </button>
            )}
          </>
        )}

        <p className="mt-1.5 text-xs text-ink/45">Where should people generally discover this business on Findmi?</p>
        <p className="mt-0.5 text-xs text-ink/40">
          This is separate from where you appear at events — you can still add appearances outside this area.
        </p>
      </div>

      <input type="hidden" name="market_id" value={marketId} />
      <input type="hidden" name="requested_market_text" value={showManualPicker ? "" : requestedMarketText} />
    </>
  );
}
