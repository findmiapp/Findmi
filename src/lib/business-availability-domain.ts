/** Findmi Here — Where To Find Us: the pure vocabulary and validation for a
 * Business's real-world availability (see migration
 * 20261026000000_business_availability_details.sql). No database access
 * here — shared by the owner UI, the server actions and tests. */

export const AVAILABILITY_RELATIONSHIPS = ["stocked", "sold", "served", "featured", "sampled"] as const;
export type AvailabilityRelationship = (typeof AVAILABILITY_RELATIONSHIPS)[number];
export const isAvailabilityRelationship = (v: unknown): v is AvailabilityRelationship =>
  typeof v === "string" && (AVAILABILITY_RELATIONSHIPS as readonly string[]).includes(v);

/** Owner-facing wording: how the Business is there. */
export const AVAILABILITY_RELATIONSHIP_LABELS: Record<AvailabilityRelationship, string> = {
  stocked: "Stocked Here",
  sold: "Sold Here",
  served: "Served Here",
  featured: "Featured Here",
  sampled: "Sampled Here",
};

export const AVAILABILITY_STATUSES = ["pending", "live", "declined"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export const AVAILABILITY_STATUS_LABELS: Record<AvailabilityStatus, string> = {
  pending: "Pending Review",
  live: "Live",
  declined: "Not Approved",
};

export const AVAILABILITY_SOURCES = ["admin", "business"] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];
export const AVAILABILITY_SOURCE_LABELS: Record<AvailabilitySource, string> = {
  admin: "Added By Findmi",
  business: "Added By You",
};

export const AVAILABILITY_NOTE_MAX = 200;
export const AVAILABILITY_PRODUCT_MAX = 25;

export type AvailabilityTiming = "ongoing" | "date_range" | "temporary";

/** The Business-facing timing kind, derived from the two dates. */
export function availabilityTiming(startsOn: string | null, endsOn: string | null): AvailabilityTiming {
  if (startsOn && endsOn) return "date_range";
  if (endsOn) return "temporary";
  return "ongoing";
}

const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function availabilityWhenLabel(startsOn: string | null, endsOn: string | null): string {
  if (startsOn && endsOn) return `${fmt(startsOn)} – ${fmt(endsOn)}`;
  if (endsOn) return `Until ${fmt(endsOn)}`;
  if (startsOn) return `From ${fmt(startsOn)}`;
  return "Ongoing";
}

/** Whether a row is in effect on `today` (YYYY-MM-DD). Public surfaces only
 * show live rows that are in effect; an expired temporary row simply stops
 * showing — it is never deleted. */
export function isAvailabilityInEffect(startsOn: string | null, endsOn: string | null, today: string): boolean {
  if (startsOn && startsOn > today) return false;
  if (endsOn && endsOn < today) return false;
  return true;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AvailabilityRequestInput {
  locationId: string;
  relationship: string;
  productIds: string[];
  timing: string;
  startsOn: string | null;
  endsOn: string | null;
  note: string | null;
}

export type AvailabilityRequestResult =
  | {
      ok: true;
      value: {
        locationId: string;
        relationship: AvailabilityRelationship;
        productIds: string[];
        startsOn: string | null;
        endsOn: string | null;
        note: string | null;
      };
    }
  | { ok: false; error: string };

/** Shape/range validation only; ownership of the Location/Products is
 * re-verified against the database in the write path. */
export function validateAvailabilityRequest(input: AvailabilityRequestInput): AvailabilityRequestResult {
  if (!input.locationId) return { ok: false, error: "Choose where to find you." };
  if (!isAvailabilityRelationship(input.relationship)) return { ok: false, error: "Choose how you’re there." };
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  if (productIds.length > AVAILABILITY_PRODUCT_MAX) return { ok: false, error: `Choose up to ${AVAILABILITY_PRODUCT_MAX} products.` };

  let startsOn: string | null = null;
  let endsOn: string | null = null;
  if (input.timing === "date_range" || input.timing === "temporary") {
    if (input.timing === "date_range") {
      if (!input.startsOn || !ISO_DATE.test(input.startsOn)) return { ok: false, error: "Enter a start date." };
      startsOn = input.startsOn;
    }
    if (!input.endsOn || !ISO_DATE.test(input.endsOn)) return { ok: false, error: "Enter an end date." };
    endsOn = input.endsOn;
    if (startsOn && endsOn < startsOn) return { ok: false, error: "The end date can’t be before the start date." };
  } else if (input.timing !== "ongoing") {
    return { ok: false, error: "Choose when this applies." };
  }
  const note = input.note?.trim().slice(0, AVAILABILITY_NOTE_MAX) || null;
  return { ok: true, value: { locationId: input.locationId, relationship: input.relationship, productIds, startsOn, endsOn, note } };
}
