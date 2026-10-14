// Legacy Appearance → Event batch conversion — which of a Business's
// schedule items the Admin batch screen may convert. The conversion itself
// is the existing one (convertLegacyAppearanceToEvent → Event Import
// analysis → convertAppearanceToEvent); this only decides what to offer.

export interface LegacyConversionRow {
  id: string;
  title: string;
  external_url: string | null;
  start_at: string;
  end_at: string | null;
  location_id: string | null;
  event_id: string | null;
  event_occurrence_id: string | null;
  status: string;
  venue_name: string | null;
  location_name?: string | null;
}

export type LegacyConversionEligibility = "eligible" | "already_event" | "no_source_link" | "canceled";

export function legacyConversionEligibility(row: Pick<LegacyConversionRow, "event_id" | "external_url" | "status">): LegacyConversionEligibility {
  if (row.event_id) return "already_event";
  if (row.status === "canceled") return "canceled";
  if (!row.external_url) return "no_source_link";
  return "eligible";
}

export const LEGACY_ELIGIBILITY_LABEL: Record<LegacyConversionEligibility, string> = {
  eligible: "Ready",
  already_event: "Already an Event",
  no_source_link: "No source link",
  canceled: "Canceled",
};

/** Has this item already finished? Still convertible, but not pre-selected. */
export function hasEnded(row: Pick<LegacyConversionRow, "start_at" | "end_at">, now: number = Date.now()): boolean {
  return Date.parse(row.end_at ?? row.start_at) < now;
}
