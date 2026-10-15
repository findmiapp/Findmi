// Admin Event Import — the OPERATOR context of the one Event Import engine.
// Findmi Admin imports public third-party Events for discovery: there is no
// initiating Business, so every result is reviewed in the several-Events
// Review (one row per Event, each with its OWN Business), and each Event is
// saved as a participating-style source Event (no host) — see
// persistDiscoveryEvent. Pure; no I/O.
import { reviewDefaults } from "./review";
import type { EventCandidate, EventImportAnalysis, EventImportMatches, EventImportReview, ImportSource } from "./types";

/** One analysis → the several-Events shape Review uses. A single Event
 * becomes a one-row list (its warnings shown with the list); failures and
 * several-Events results pass through unchanged. */
export function asOperatorAnalysis(a: EventImportAnalysis, source: ImportSource): EventImportAnalysis {
  if (!a.ok || a.kind === "multi") return a;
  const past = a.candidate.occurrences.length > 0 && a.candidate.occurrences.every((o) => o.past);
  return {
    ok: true,
    kind: "multi",
    source,
    events: [{ key: "event-1", candidate: a.candidate, matches: a.matches, warnings: a.warnings, past, alreadyOnSchedule: null }],
    warnings: a.warnings,
  };
}

/** Initial Review values for an operator import: always a genuine Event
 * (there is no Business schedule to fall back to), never hosted. */
export function operatorReviewDefaults(candidate: EventCandidate, matches: EventImportMatches): EventImportReview {
  return { ...reviewDefaults(candidate, matches, "participating", ""), intent: "participating", asEvent: true };
}

/** The Business suggested for one Event: only the engine's confident,
 * public organizer match (exact name + place) — anything else stays
 * unresolved for the operator to choose. */
export function suggestedEventBusiness(matches: EventImportMatches): { id: string; name: string } | null {
  return matches.organizerBusiness ? { id: matches.organizerBusiness.id, name: matches.organizerBusiness.name } : null;
}
