// Save organization — Save is the consumer's one organization entry point;
// these are the optional classifications offered in the sheet that opens
// after a Save. Each is an EXISTING user_entity_relationships relation
// (lib/discovery/relationships.ts), shown with a label that fits the
// entity — never a value the schema can't truthfully hold (no "Going", no
// "Must Have", no Appearance saves). Classifications are independent rows:
// unsaving never deletes them (Have / Been are personal history), and a
// collection lists an item from its classification even without a Save.
// Pure (client + server).

import type { Relationship, RelationshipEntityType } from "./discovery/relationships";

export type OrganizableType = "product" | "event" | "location";

export interface SaveClassification {
  relation: Relationship;
  label: string;
}

/** The sheet's options per saved entity type (multi-select). Businesses
 * have none: Save, with Follow as its own separate relationship. */
export const SAVE_CLASSIFICATIONS: Record<OrganizableType, readonly SaveClassification[]> = {
  product: [
    { relation: "want", label: "Want" },
    { relation: "have", label: "Have" },
  ],
  event: [
    { relation: "want", label: "Interested" },
    { relation: "must_do", label: "Must Do" },
  ],
  location: [
    { relation: "want", label: "Want To Go" },
    { relation: "must_do", label: "Must Do" },
    { relation: "been", label: "Been Here" },
  ],
};

export function isOrganizable(type: string): type is OrganizableType {
  return type === "product" || type === "event" || type === "location";
}

/** Personal collections on /account/saved. "all" is every Saved item plus
 * every classified one; the others are defined only by real relation
 * rows. Only truthful collections exist (no "Must Haves"). */
export type SavedCollectionKey = "all" | "must-do" | "want" | "have-been";

/** Consumer labels: "Want" covers Product Want, Event Interested and Place
 * Want To Go (all the existing `want` relation) without exposing that. */
export const SAVED_COLLECTIONS: readonly { key: SavedCollectionKey; label: string; relations: readonly Relationship[] }[] = [
  { key: "all", label: "All Saved", relations: [] },
  { key: "want", label: "Want", relations: ["want"] },
  { key: "must-do", label: "Must Do", relations: ["must_do"] },
  { key: "have-been", label: "Have & Been", relations: ["have", "been"] },
];

export const COLLECTION_ENTITY_TYPES: readonly RelationshipEntityType[] = ["product", "event", "location"];

export function parseCollection(value: unknown): SavedCollectionKey {
  return SAVED_COLLECTIONS.some((c) => c.key === value) ? (value as SavedCollectionKey) : "all";
}

export interface RelationRow {
  entity_type: string;
  entity_id: string;
  relation: string;
}

/** Entity ids per type in one collection, from the viewer's relation rows
 * (and, for "all", their Save rows too). */
export function collectionMembers(
  key: SavedCollectionKey,
  relations: readonly RelationRow[],
  saved: Partial<Record<OrganizableType, readonly string[]>> = {}
): Record<OrganizableType, string[]> {
  const out: Record<OrganizableType, string[]> = { product: [], event: [], location: [] };
  const def = SAVED_COLLECTIONS.find((c) => c.key === key)!;
  for (const r of relations) {
    if (!isOrganizable(r.entity_type)) continue;
    if (key === "all" ? r.relation === "like" || r.relation === "dislike" : !def.relations.includes(r.relation as Relationship)) continue;
    out[r.entity_type].push(r.entity_id);
  }
  if (key === "all") for (const t of ["product", "event", "location"] as const) out[t].push(...(saved[t] ?? []));
  for (const t of ["product", "event", "location"] as const) out[t] = [...new Set(out[t])];
  return out;
}

/** Item counts per collection (Account Home's Saved module, the
 * collection chips). Businesses count toward "all" only. */
export function collectionCounts(
  relations: readonly RelationRow[],
  saved: Partial<Record<OrganizableType, readonly string[]>> & { business?: readonly string[] } = {}
): Record<SavedCollectionKey, number> {
  const count = (key: SavedCollectionKey) => {
    const m = collectionMembers(key, relations, saved);
    return m.product.length + m.event.length + m.location.length + (key === "all" ? new Set(saved.business ?? []).size : 0);
  };
  return { all: count("all"), "must-do": count("must-do"), want: count("want"), "have-been": count("have-been") };
}
