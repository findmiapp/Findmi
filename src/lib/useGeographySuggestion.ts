"use client";

import { useEffect, useRef, useState } from "react";
import { suggestGeographyMatch } from "@/app/(public)/actions/geography-suggest";
import type { GeographyMatch } from "@/lib/market-requests";

const DEBOUNCE_MS = 500;

export type GeographySuggestionStatus = "idle" | "checking" | "matched" | "no_match";

export interface GeographySuggestionState {
  status: GeographySuggestionStatus;
  suggestion: GeographyMatch | null;
}

/**
 * Geography Foundation Pass 2 — the one shared debounce/race-guard shell
 * every owner-facing creation form's city/state -> Market/Area suggestion
 * uses (Business/Location/Event), so each doesn't hand-roll its own timer
 * and risk drifting out of sync (per the architecture audit's own Part 32
 * recommendation: share only where duplication would otherwise cause
 * real behavioral drift — three near-identical debounce implementations
 * is exactly that case). Calls the EXISTING findExistingGeographyMatch(...)
 * matcher via the suggestGeographyMatch server action — no new matching
 * logic, no geocoding, the same fuzzy/alias matching standalone
 * Appearance geography already relies on.
 *
 * "idle" (never queried) is distinct from "no_match" (queried, nothing
 * plausible found) — callers use "idle" to mean "nothing typed yet, show
 * the plain manual picker" and "no_match" to mean "show the unresolved-
 * geography / Market Request state."
 *
 * Race-safety: a slow-resolving lookup for an earlier city/state pair can
 * never clobber a faster-resolving lookup for whatever the visitor has
 * since typed — each call's own (city, state) pair is compared against
 * the CURRENT pair at resolution time, and a stale response is discarded.
 * Debounce's own effect-cleanup (clearTimeout) already prevents a
 * superseded keystroke's timer from firing at all in the common case;
 * this guard additionally covers the rarer case of the network call
 * itself resolving out of order.
 */
export function useGeographySuggestion(city: string, state: string, enabled: boolean): GeographySuggestionState {
  const [suggestion, setSuggestion] = useState<GeographyMatch | null>(null);
  const [status, setStatus] = useState<GeographySuggestionStatus>("idle");
  const latestQuery = useRef<string>("");

  useEffect(() => {
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const query = `${trimmedCity}|${trimmedState}`;
    latestQuery.current = query;

    if (!enabled || (!trimmedCity && !trimmedState)) {
      setSuggestion(null);
      setStatus("idle");
      return;
    }

    setStatus("checking");
    const timer = setTimeout(() => {
      suggestGeographyMatch(trimmedCity, trimmedState).then((result) => {
        // Discard a stale response — the visitor has since typed
        // something else and a newer effect run already owns latestQuery.
        if (latestQuery.current !== query) return;
        setSuggestion(result);
        setStatus(result ? "matched" : "no_match");
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [city, state, enabled]);

  return { status, suggestion };
}
