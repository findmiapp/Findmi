/** Findmi Here — Where To Find Us: the pure vocabulary and validation for a
 * Business's real-world availability (see migration
 * 20261026000000_business_availability_details.sql). No database access
 * here — shared by the owner UI, the server actions and tests. */

export const AVAILABILITY_RELATIONSHIPS = ["stocked", "sold", "served", "featured", "sampled"] as const;
export type AvailabilityRelationship = (typeof AVAILABILITY_RELATIONSHIPS)[number];
export const isAvailabilityRelationship = (v: unknown): v is AvailabilityRelationship =>
  typeof v === "string" && (AVAILABILITY_RELATIONSHIPS as readonly string[]).includes(v);

/** What each relationship means in the real world — the five stay distinct
 * (a place can stock a Brand's bottles on a shelf, sell them at a counter,
 * serve them as a drink, feature them in a display and hand out samples —
 * and any combination can be true at once):
 *   stocked  — on the shelf / in inventory
 *   sold     — you can buy it there
 *   served   — prepared and served on site (café, bar, restaurant)
 *   featured — promoted or displayed (an endcap, a menu feature)
 *   sampled  — tastings and demos */
export const AVAILABILITY_RELATIONSHIP_HINTS: Record<AvailabilityRelationship, string> = {
  stocked: "On the shelf",
  sold: "You can buy it here",
  served: "Prepared and served here",
  featured: "Promoted or displayed here",
  sampled: "Tastings and demos",
};

/** Owner-facing wording: how the Business is there. */
export const AVAILABILITY_RELATIONSHIP_LABELS: Record<AvailabilityRelationship, string> = {
  stocked: "Stocked Here",
  sold: "Sold Here",
  served: "Served Here",
  featured: "Featured Here",
  sampled: "Sampled Here",
};

/** Canonical order for a set of relationships (the order of the list above),
 * duplicates and anything unknown removed. */
export function normalizeAvailabilityRelationships(values: readonly unknown[]): AvailabilityRelationship[] {
  const set = new Set(values.filter(isAvailabilityRelationship));
  return AVAILABILITY_RELATIONSHIPS.filter((r) => set.has(r));
}

/** "Served Here" for one; "Served, Sold & Stocked Here" for several — one
 * phrase for one place, never one card per relationship. */
export function availabilityRelationshipsPhrase(relationships: readonly AvailabilityRelationship[]): string {
  const rels = normalizeAvailabilityRelationships(relationships);
  if (rels.length === 0) return "";
  const word = (r: AvailabilityRelationship) => AVAILABILITY_RELATIONSHIP_LABELS[r].replace(/ Here$/, "");
  if (rels.length === 1) return AVAILABILITY_RELATIONSHIP_LABELS[rels[0]];
  const words = rels.map(word);
  return `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]} Here`;
}

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
  /** One or more of the five. (`relationship`, the single legacy value, is
   * still accepted when `relationships` is absent.) */
  relationships?: readonly string[];
  relationship?: string;
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
        /** Canonical order, at least one. */
        relationships: AvailabilityRelationship[];
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
  const requested = input.relationships ?? (input.relationship !== undefined ? [input.relationship] : []);
  if (requested.some((r) => !isAvailabilityRelationship(r))) return { ok: false, error: "Choose how you’re there." };
  const relationships = normalizeAvailabilityRelationships(requested);
  if (relationships.length === 0) return { ok: false, error: "Choose at least one way you’re there." };
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
  return { ok: true, value: { locationId: input.locationId, relationships, productIds, startsOn, endsOn, note } };
}

// ── Review semantics for owner edits ───────────────────────────────────────
// ONE rule, used by single-entry edits, bulk edits and CSV re-imports, for what an
// edit does to an entry's review status. The question is never "did something
// change?" but "did the PUBLIC CLAIM Findmi approved change?":
//   · A) identity / trust of the Location relationship — claiming a place, or
//        saying something NEW about how the Business is there. Needs Findmi.
//   · B) ordinary management of an already-approved relationship — what products
//        it covers (only ever the Business's own, verified server-side), when it
//        runs, narrowing what it says. Stays exactly as approved.
// A place's identity can't be edited at all (the entry is bound to its Location),
// and a brand-new entry is always created Pending — so a falsely claimed place or a
// new relationship still always passes review.

/** Whether an edit widens what the entry publicly claims: a relationship it was not
 * approved for (a Business that was approved as "Stocked" now saying "Served" or
 * "Sampled"), or new/changed free-text note (arbitrary public copy). Removing a
 * relationship, clearing the note, changing products or changing dates is not. */
export function editAddsPublicClaim(edit: {
  relationshipsBefore: readonly AvailabilityRelationship[];
  relationshipsAfter: readonly AvailabilityRelationship[];
  noteBefore?: string | null;
  noteAfter?: string | null;
}): boolean {
  const before = new Set(normalizeAvailabilityRelationships(edit.relationshipsBefore));
  const addedRelationship = normalizeAvailabilityRelationships(edit.relationshipsAfter).some((r) => !before.has(r));
  const noteAfter = (edit.noteAfter ?? "").trim();
  const noteChanged = noteAfter !== "" && noteAfter !== (edit.noteBefore ?? "").trim();
  return addedRelationship || noteChanged;
}

/** The status an entry has after an owner edit.
 *   Live      → stays Live, unless the edit adds a public claim → Pending Review
 *   Pending   → stays Pending (it has not been approved yet)
 *   Declined  → stays Declined, unless the edit adds a claim, which is a fresh
 *               submission → Pending Review */
export function statusAfterOwnerEdit(current: AvailabilityStatus, edit: Parameters<typeof editAddsPublicClaim>[0]): AvailabilityStatus {
  if (current === "pending") return "pending";
  return editAddsPublicClaim(edit) ? "pending" : current;
}
