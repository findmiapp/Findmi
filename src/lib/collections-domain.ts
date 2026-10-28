// Personal Library — Collections (pure rules; client + server + tests).
// Collections are the "how do I organize it?" layer of the library:
// optional, private, user-named buckets, independent of Relationships
// (product_wants, user_entity_relationships) and Saves (account_saved_*).
// Storage: user_collections / user_collection_items
// (supabase/migrations/20261125000000_user_collections.sql).

export const COLLECTION_ENTITY_TYPES = ["product", "event", "location", "business"] as const;
export type CollectionEntityType = (typeof COLLECTION_ENTITY_TYPES)[number];

export const COLLECTION_NAME_MAX = 60;

export function isCollectionEntityType(value: unknown): value is CollectionEntityType {
  return typeof value === "string" && (COLLECTION_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Trimmed, whitespace-collapsed name, or null when empty / too long. */
export function normalizeCollectionName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim();
  return v.length >= 1 && v.length <= COLLECTION_NAME_MAX ? v : null;
}

export interface CollectionSummary {
  id: string;
  name: string;
  itemCount: number;
  /** Whether the entity the picker was opened for is already in it. */
  contains: boolean;
}
