import type { LocationHours } from "@/lib/types";
import type { SelectedLocationDetail } from "@/components/account/EventLocationField";

/** Location Import V1 — ONE Location onboarding/resolution pipeline used by
 * Admin → Locations → Import Locations and by Admin Event Import when an
 * occurrence's place isn't on Findmi yet. It never introduces a second
 * Location model: every value maps to an existing `locations` column, and
 * every creation goes through the same unlisted Quick Create insert
 * (lib/places/inline-place.ts). */

export const LOCATION_IMPORT_MAX = 25;

/** What the operator (or an Event's place) supplied for one Location. */
export interface LocationEvidence {
  /** Batch identity — the same place repeated in one paste shares a key. */
  key: string;
  /** "Location 3" — every pasted block this place appeared in. */
  labels: string[];
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  /** Category as written (resolved against Location categories later). */
  category: string | null;
  description: string | null;
  warnings: string[];
}

/** An existing Findmi Location (Listed = is_public). */
export type ExistingLocation = SelectedLocationDetail;

export type LocationResolution =
  /** One existing Location clearly is this place — reuse its id. */
  | { kind: "existing"; location: ExistingLocation }
  /** Findmi has possible matches — the operator chooses (never guessed). */
  | { kind: "ambiguous"; candidates: ExistingLocation[] }
  /** Not on Findmi and specific enough to create. */
  | { kind: "new" }
  /** Not on Findmi and too vague to create (area, intersection, no street). */
  | { kind: "insufficient"; reason: string };

/** Facts read from an official Location website (JSON-LD place data +
 * page metadata). Untrusted until reviewed. */
export interface LocationWebsiteFacts {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  description: string | null;
  hours: LocationHours | null;
  latitude: number | null;
  longitude: number | null;
  /** schema.org types of the place entity used (category hint). */
  types: string[];
  /** The site lists several different addresses and none is the supplied
   * one — no address-bound fact (phone, hours, map position) is used. */
  multipleAddresses: boolean;
}

/** A verified website image offered for review: `sourceUrl` is fetched,
 * re-verified and re-hosted only at creation; `preview` is a small
 * re-encoded data URI (never stored, never a remote URL). */
export interface LocationMediaChoice {
  sourceUrl: string;
  preview: string | null;
}

export type LocationField = "name" | "address" | "city" | "state" | "postalCode" | "phone" | "description" | "hours" | "coordinates" | "category" | "website";

export interface LocationConflict {
  field: LocationField;
  provided: string;
  website: string;
  /** Where the conflicting value came from (default: the official website). */
  from?: "website" | "research";
}

/** The reviewable profile for a NEW Location: supplied values win; the
 * website only fills gaps; conflicts are flagged, never applied. */
export interface LocationProposal {
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  website: string;
  phone: string;
  description: string;
  categoryId: string | null;
  hours: LocationHours | null;
  latitude: number | null;
  longitude: number | null;
  /** Where each filled value came from. */
  sources: Partial<Record<LocationField, "provided" | "website" | "research">>;
  conflicts: LocationConflict[];
  notes: string[];
  logo: LocationMediaChoice | null;
  cover: LocationMediaChoice | null;
}

/** What creation receives (re-validated server-side; nothing trusted). */
export interface LocationCreateInput {
  name: string;
  address: string;
  /** Suite / unit / floor (optional; never geocoded or matched on). */
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode?: string | null;
  website?: string | null;
  phone?: string | null;
  description?: string | null;
  categoryId?: string | null;
  hours?: LocationHours | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Verified website images the operator kept (re-verified at creation). */
  logoSourceUrl?: string | null;
  coverSourceUrl?: string | null;
}
