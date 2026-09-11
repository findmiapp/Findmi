"use client";

import { useEffect, useState } from "react";
import { useGeographySuggestion } from "@/lib/useGeographySuggestion";
import type { GeographyMatch } from "@/lib/market-requests";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface BusinessGeographyFieldsProps {
  markets: { id: string; name: string }[];
  defaultCity: string;
  defaultState: string;
  defaultMarketId: string;
  defaultRequestedMarketText: string;
}

/** "Staten Island · New York City" for an Area match, plain "North Jersey"
 * for a Market-only match — a presentation-only reformatting of the
 * existing GeographyMatch fields (never touches findExistingGeographyMatch
 * or GeographyMatch.label itself, which stays an em-dash "Area — Market"
 * string used elsewhere, e.g. the admin Market Requests queue). */
function formatSuggestionHeadline(suggestion: GeographyMatch): string {
  if (suggestion.type === "area" && suggestion.areaLabel) {
    return `${suggestion.areaLabel} · ${suggestion.marketLabel}`;
  }
  return suggestion.marketLabel;
}

/**
 * Business Geography Onboarding UX Correction pass — closes the gap Pass 2
 * left open: that pass wired up live city/state -> Findmi area matching,
 * but still showed the plain "Choose a market…" select immediately in the
 * blank/idle state (same as before Pass 2 existed), so a brand-new visitor
 * still saw an unexplained Findmi taxonomy dropdown before ever typing
 * anything. Root cause was `showManualPicker = overridden || status ===
 * "idle"` — "idle" (nothing typed yet) was treated the same as "the owner
 * wants the manual picker," which was backwards.
 *
 * Fixed by making the ENTIRE "Findmi area" section (suggestion banner,
 * no-match notice, or the manual selector) appear only once city OR state
 * has real input (`hasInput` below) — before that, this renders only the
 * plain City/State fields under a "Business location" heading, with no
 * mention of Markets/Areas at all. The manual `<select>` itself is now
 * reachable ONLY via the explicit "Change area" / "Choose an existing area
 * instead" actions (`overridden`), never automatically.
 *
 * City/State are now `required` (see this pass's own report for why no
 * existing Business type needed them optional) — still plain text
 * fields, no geocoding, no country field added.
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

  const hasInput = Boolean(city.trim() || state.trim());
  const requestedMarketText =
    !overridden && status === "no_match" ? [city.trim(), state.trim()].filter(Boolean).join(", ") : "";
  const enteredPlace = [city.trim(), state.trim()].filter(Boolean).join(", ");

  return (
    <>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">Business location</span>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink/60">City</span>
            <input
              type="text"
              name="city"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink/60">State</span>
            <input
              type="text"
              name="state"
              required
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {!hasInput && (
          <p className="mt-1.5 text-xs text-ink/45">
            Enter where your business is based. Findmi will determine the best area for discovery.
          </p>
        )}
      </div>

      {hasInput && (
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink">Findmi area</span>

          {!overridden && status === "checking" && (
            <p className="rounded-xl border border-black/10 bg-mist/30 px-3.5 py-2.5 text-sm text-ink/50">
              Checking Findmi…
            </p>
          )}

          {!overridden && status === "matched" && suggestion && (
            <div className="rounded-xl border border-findmi/25 bg-findmi-50 px-3.5 py-3">
              <p className="text-sm font-bold text-findmi-700">{formatSuggestionHeadline(suggestion)}</p>
              <p className="mt-0.5 text-xs text-findmi-700/70">Suggested from {enteredPlace}</p>
              <button
                type="button"
                onClick={() => setOverridden(true)}
                className="mt-1.5 text-xs font-semibold text-findmi-700 underline underline-offset-2"
              >
                Change area
              </button>
            </div>
          )}

          {!overridden && status === "no_match" && (
            <div className="rounded-xl border border-black/10 bg-mist/30 px-3.5 py-3">
              <p className="text-sm font-semibold text-ink/70">{enteredPlace} isn&rsquo;t on Findmi yet.</p>
              <p className="mt-0.5 text-xs text-ink/50">
                We&rsquo;ll add it for review. You can continue creating your business.
              </p>
              <button
                type="button"
                onClick={() => setOverridden(true)}
                className="mt-1.5 text-xs font-semibold text-ink/60 underline underline-offset-2"
              >
                Choose an existing area instead
              </button>
            </div>
          )}

          {overridden && (
            <>
              <select
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose an area</option>
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-ink/45">
                This controls your primary discovery area. Your appearances can be anywhere.
              </p>
              <button
                type="button"
                onClick={() => setOverridden(false)}
                className="mt-1.5 text-xs font-semibold text-ink/50 underline underline-offset-2"
              >
                Use Findmi&rsquo;s suggestion instead
              </button>
            </>
          )}
        </div>
      )}

      <input type="hidden" name="market_id" value={marketId} />
      <input type="hidden" name="requested_market_text" value={overridden ? "" : requestedMarketText} />
    </>
  );
}
