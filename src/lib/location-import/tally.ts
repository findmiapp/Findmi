/** Location Import V1 — pure (client-safe) Import Complete accounting. */

/** Import Complete — counted from what actually happened, never padded. */
export interface LocationImportTally {
  submitted: number;
  existingMatched: number;
  created: number;
  needsResolution: number;
  failed: number;
  awaitingReview: number;
}

export type LocationRowOutcome = "existing" | "created" | "unresolved" | "failed" | "skipped";

export function tallyLocationImport(outcomes: readonly LocationRowOutcome[]): LocationImportTally {
  const count = (k: LocationRowOutcome) => outcomes.filter((o) => o === k).length;
  const created = count("created");
  return {
    submitted: outcomes.length,
    existingMatched: count("existing"),
    created,
    needsResolution: count("unresolved"),
    failed: count("failed"),
    // Every created Location starts Not Listed (Needs Review).
    awaitingReview: created,
  };
}
