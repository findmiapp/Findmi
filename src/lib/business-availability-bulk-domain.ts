import {
  AVAILABILITY_PRODUCT_MAX,
  AVAILABILITY_RELATIONSHIPS,
  AVAILABILITY_STATUSES,
  isAvailabilityRelationship,
  normalizeAvailabilityRelationships,
  type AvailabilityRelationship,
  type AvailabilityStatus,
} from "./business-availability-domain";

/** Find Us Here at scale — the pure rules for filtering a Business's footprint
 * and for bulk changes to it. A bulk change always acts on the Business ↔
 * Location relationship (the availability entry); it never edits or deletes a
 * canonical Location. Client-safe (no I/O). */

export const AVAILABILITY_LIST_PAGE_SIZE = 50;
export const BULK_CHUNK = 200;
/** The most entries one bulk request may name explicitly. */
export const BULK_IDS_MAX = 5000;

export interface AvailabilityFilter {
  /** Matches the Location's name, city or street address. */
  q: string;
  status: AvailabilityStatus | "";
  relationship: AvailabilityRelationship | "";
  /** Only entries tied to an import source id. */
  imported: boolean;
}

export const EMPTY_AVAILABILITY_FILTER: AvailabilityFilter = { q: "", status: "", relationship: "", imported: false };

/** Reads a filter from untrusted input (URL params / an action argument). */
export function parseAvailabilityFilter(raw: Partial<Record<keyof AvailabilityFilter, unknown>> | null | undefined): AvailabilityFilter {
  const q = typeof raw?.q === "string" ? raw.q.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const status = (AVAILABILITY_STATUSES as readonly unknown[]).includes(raw?.status) ? (raw?.status as AvailabilityStatus) : "";
  const relationship = isAvailabilityRelationship(raw?.relationship) ? raw?.relationship : "";
  const imported = raw?.imported === true || raw?.imported === "1" || raw?.imported === "true";
  return { q, status, relationship, imported };
}

export const isEmptyAvailabilityFilter = (f: AvailabilityFilter) => !f.q && !f.status && !f.relationship && !f.imported;

export type BulkOp =
  | { kind: "add_relationships"; relationships: string[] }
  | { kind: "remove_relationships"; relationships: string[] }
  | { kind: "add_products"; productIds: string[] }
  | { kind: "remove_products"; productIds: string[] }
  | { kind: "apply_set"; setId: string }
  | { kind: "remove_from_footprint" };

export const BULK_OP_LABELS: Record<BulkOp["kind"], string> = {
  add_relationships: "Add Relationships",
  remove_relationships: "Remove Relationships",
  add_products: "Add Products",
  remove_products: "Remove Products",
  apply_set: "Apply Product Set",
  remove_from_footprint: "Remove From My Footprint",
};

/** Whether the op can send an entry back to Pending Review. It uses the SAME rule as
 * editing one entry by hand (business-availability-domain.ts statusAfterOwnerEdit):
 * only an op that adds a way the Business is there — a relationship the entry was
 * not approved for — is a new public claim. Product and Product Set changes, and
 * narrowing relationships, are ordinary management of an approved entry and leave it
 * exactly as approved; removing from the footprint just removes. */
export const bulkOpReturnsToReview = (op: BulkOp) => op.kind === "add_relationships";

export type BulkOpCheck = { ok: true; op: BulkOp } | { ok: false; error: string };

export function validateBulkOp(raw: unknown): BulkOpCheck {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Choose what to do." };
  const op = raw as Record<string, unknown>;
  const strings = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, max) : []);
  switch (op.kind) {
    case "add_relationships":
    case "remove_relationships": {
      const relationships = normalizeAvailabilityRelationships(strings(op.relationships, AVAILABILITY_RELATIONSHIPS.length));
      if (relationships.length === 0) return { ok: false, error: "Choose at least one relationship." };
      return { ok: true, op: { kind: op.kind, relationships } };
    }
    case "add_products":
    case "remove_products": {
      const productIds = strings(op.productIds, AVAILABILITY_PRODUCT_MAX);
      if (productIds.length === 0) return { ok: false, error: "Choose at least one product." };
      return { ok: true, op: { kind: op.kind, productIds } };
    }
    case "apply_set":
      return typeof op.setId === "string" && op.setId ? { ok: true, op: { kind: "apply_set", setId: op.setId } } : { ok: false, error: "Choose a Product Set." };
    case "remove_from_footprint":
      return { ok: true, op: { kind: "remove_from_footprint" } };
    default:
      return { ok: false, error: "Choose what to do." };
  }
}

export type RelationshipPlan = { next: AvailabilityRelationship[]; changed: boolean } | { skip: string };

/** What an add/remove does to ONE entry's relationships. Removing the last
 * remaining relationship is refused (an entry always says how the Business is
 * there; to take a place off the footprint, remove it instead). */
export function planRelationships(current: readonly AvailabilityRelationship[], op: { kind: "add_relationships" | "remove_relationships"; relationships: readonly string[] }): RelationshipPlan {
  const base = normalizeAvailabilityRelationships(current);
  const wanted = normalizeAvailabilityRelationships(op.relationships);
  const next = op.kind === "add_relationships" ? normalizeAvailabilityRelationships([...base, ...wanted]) : base.filter((r) => !wanted.includes(r));
  if (next.length === 0) return { skip: "Would leave no relationship" };
  const changed = next.length !== base.length || next.some((r, i) => r !== base[i]);
  return { next, changed };
}

export interface BulkProgress {
  processed: number;
  changed: number;
  unchanged: number;
  skipped: { reason: string; count: number }[];
  /** Entries that moved back to Pending Review because of this change. */
  returnedToReview: number;
}

export const emptyBulkProgress = (): BulkProgress => ({ processed: 0, changed: 0, unchanged: 0, skipped: [], returnedToReview: 0 });

export function mergeBulkProgress(a: BulkProgress, b: BulkProgress): BulkProgress {
  const skipped = new Map<string, number>();
  for (const s of [...a.skipped, ...b.skipped]) skipped.set(s.reason, (skipped.get(s.reason) ?? 0) + s.count);
  return {
    processed: a.processed + b.processed,
    changed: a.changed + b.changed,
    unchanged: a.unchanged + b.unchanged,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    returnedToReview: a.returnedToReview + b.returnedToReview,
  };
}
