"use client";

import { useEffect, useState } from "react";
import EventLocationField, { type ManualVenueValues, type SelectedLocationDetail } from "@/components/account/EventLocationField";
import { useGeographySuggestion } from "@/lib/useGeographySuggestion";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export interface EventGeographyFieldsProps {
  markets: { id: string; name: string }[];
  initialLocation: SelectedLocationDetail | null;
  initialManual: ManualVenueValues | null;
  defaultMarketId: string;
  defaultRequestedMarketText: string;
}

/**
 * Geography Foundation Pass 2 — the Event counterpart of
 * BusinessGeographyFields. Event creation has no city/state fields of
 * its own to control — geography comes entirely from EventLocationField
 * (either a selected real Findmi Location, or manual venue text), which
 * already normalizes both into the same effective city/state (see that
 * component's own onGeographyChange addition). This wrapper simply
 * listens to whichever one is currently effective and suggests a Market
 * from it, exactly like Business/Location.
 *
 * Per the architecture audit's own Part 6 instruction, this deliberately
 * does NOT fight Event/Location precedence: when a real Location is
 * selected, its own city/state (not a duplicate manual entry) is what
 * gets suggested from — the SAME values already submitted via
 * EventLocationField's hidden city/state inputs — and resolveEffectiveEventMarket's
 * own read-time precedence (occurrence override -> Location -> Event
 * default) is untouched; this only ever fills in the Event's own default
 * market_id/requested_market_text, never a per-occurrence value.
 *
 * Event creation has no Area picker today (same limitation as Business —
 * see BusinessGeographyFields), so only the Market portion of a match is
 * used here, exactly matching the smallest-change-necessary instruction.
 */
export default function EventGeographyFields({
  markets,
  initialLocation,
  initialManual,
  defaultMarketId,
  defaultRequestedMarketText,
}: EventGeographyFieldsProps) {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [marketId, setMarketId] = useState(defaultMarketId);
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
      <EventLocationField
        initialLocation={initialLocation}
        initialManual={initialManual}
        onGeographyChange={({ city: c, state: s }) => {
          setCity(c);
          setState(s);
        }}
      />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">
          Market <span className="font-normal text-ink/40">(optional)</span>
        </span>

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
              Choose a different Market
            </button>
          </div>
        )}

        {!showManualPicker && status === "no_match" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/10 bg-mist/30 px-3.5 py-2.5 text-sm text-ink/60">
            <span>
              We don&rsquo;t have this Findmi area yet. We&rsquo;ll add &ldquo;{[city, state].filter(Boolean).join(", ")}
              &rdquo; for review.
            </span>
            <button
              type="button"
              onClick={() => setOverridden(true)}
              className="text-xs font-semibold underline underline-offset-2"
            >
              Choose an existing Market instead
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
              <option value="">Choose a market…</option>
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

        <p className="mt-1.5 text-xs text-ink/45">You can add or change this later from your Event Manager.</p>
      </div>

      <input type="hidden" name="market_id" value={marketId} />
      <input type="hidden" name="requested_market_text" value={showManualPicker ? "" : requestedMarketText} />
    </>
  );
}
