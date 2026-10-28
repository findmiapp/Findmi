// Personal Library — three independent concepts:
//   Relationship  what it means to me (Product Want = product_wants; Have /
//                 Been / Must Do / Event & Place Want = user_entity_relationships)
//   Save          a plain bookmark (account_saved_*)
//   Collection    how I organize it (user_collections, lib/collections.ts)
// The sheet that opens after a Save offers the relationship statements below
// under "Mark As" (never as Save sub-types) plus Collections. Each is an EXISTING user_entity_relationships relation
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
  // Product Want is NOT a Save classification: it is the canonical
  // product_wants relationship, owned by the Product's own Want button
  // (ProductWantButton). The Save sheet only offers Have for Products.
  product: [{ relation: "have", label: "Have" }],
  event: [
    { relation: "want", label: "Want To Do" },
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

/** Personal Library filters on /account/saved (the ONE signed-in library).
 * Each filter is defined only by real rows — a relationship, a Save or a
 * Follow — so no taxonomy is manufactured: a filter with nothing in it is
 * hidden by the page. User-created Collections are a separate area
 * (lib/collections.ts), never a filter here.
 *   all         every Save + every relationship (not Like/Dislike, which
 *               are taste signals, not things you keep) — Following has
 *               its own filter so subscriptions don't flood "All"
 *   want        Things I Want — Product Want (product_wants)
 *   want-to-do  Event Want ("Want To Do")
 *   want-to-go  Place Want
 *   must-do     Must Do (Events, Places)
 *   have-been   Have (Products) & Been (Places, Events)
 *   following   Followed Businesses, Events, Places
 *   saved       plain Save bookmarks only (legacy — kept, never deleted) */
export type SavedCollectionKey = "all" | "want" | "want-to-do" | "want-to-go" | "must-do" | "have-been" | "following" | "saved";

export type LibraryEntityType = "product" | "event" | "location" | "business";

interface LibraryFilter {
  key: SavedCollectionKey;
  label: string;
  relations: readonly Relationship[];
  /** Restricts relation rows to these entity types (all when omitted). */
  entityTypes?: readonly LibraryEntityType[];
}

export const SAVED_COLLECTIONS: readonly LibraryFilter[] = [
  { key: "all", label: "All", relations: [] },
  { key: "want", label: "Things I Want", relations: ["want"], entityTypes: ["product"] },
  { key: "want-to-do", label: "Want To Do", relations: ["want"], entityTypes: ["event"] },
  { key: "want-to-go", label: "Want To Go", relations: ["want"], entityTypes: ["location"] },
  { key: "have-been", label: "Have & Been", relations: ["have", "been"] },
  { key: "following", label: "Following", relations: [] },
  // Legacy: Must Do is no longer offered as a primary action (lib/personal-model.ts) but
  // existing rows stay visible here — the page hides this filter when it is empty.
  { key: "must-do", label: "Must Do", relations: ["must_do"] },
  { key: "saved", label: "Saved", relations: [] },
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

/** Product "want" comes from the canonical Product Want (product_wants),
 * never from user_entity_relationships (whose legacy Product "want" rows
 * were copied there). Replaces any Product/want relation rows with the
 * viewer's actual Wanted Product ids, so Things I Want and the Product
 * page's Want button always agree. */
export function withCanonicalProductWants(relations: readonly RelationRow[], wantedProductIds: readonly string[]): RelationRow[] {
  return [
    ...relations.filter((r) => !(r.entity_type === "product" && r.relation === "want")),
    ...[...new Set(wantedProductIds)].map((id) => ({ entity_type: "product", entity_id: id, relation: "want" })),
  ];
}

export type LibraryIds = Partial<Record<LibraryEntityType, readonly string[]>>;

const LIBRARY_TYPES = ["product", "event", "location", "business"] as const;

/** Entity ids per type in one library filter, from the viewer's
 * relationship rows, Save rows and Follow rows. */
export function collectionMembers(key: SavedCollectionKey, relations: readonly RelationRow[], saved: LibraryIds = {}, followed: LibraryIds = {}): Record<LibraryEntityType, string[]> {
  const out: Record<LibraryEntityType, string[]> = { product: [], event: [], location: [], business: [] };
  const def = SAVED_COLLECTIONS.find((c) => c.key === key)!;
  if (key === "following") {
    for (const t of LIBRARY_TYPES) out[t].push(...(followed[t] ?? []));
  } else if (key === "saved") {
    for (const t of LIBRARY_TYPES) out[t].push(...(saved[t] ?? []));
  } else {
    for (const r of relations) {
      if (!isOrganizable(r.entity_type)) continue;
      if (key === "all" ? r.relation === "like" || r.relation === "dislike" : !def.relations.includes(r.relation as Relationship)) continue;
      if (def.entityTypes && !def.entityTypes.includes(r.entity_type)) continue;
      out[r.entity_type].push(r.entity_id);
    }
    if (key === "all") for (const t of LIBRARY_TYPES) out[t].push(...(saved[t] ?? []));
  }
  for (const t of LIBRARY_TYPES) out[t] = [...new Set(out[t])];
  return out;
}

/** Item counts per filter (the filter chips). */
export function collectionCounts(relations: readonly RelationRow[], saved: LibraryIds = {}, followed: LibraryIds = {}): Record<SavedCollectionKey, number> {
  const counts = {} as Record<SavedCollectionKey, number>;
  for (const { key } of SAVED_COLLECTIONS) {
    const m = collectionMembers(key, relations, saved, followed);
    counts[key] = LIBRARY_TYPES.reduce((n, t) => n + m[t].length, 0);
  }
  return counts;
}
