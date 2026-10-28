import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectionEntityType, CollectionSummary } from "./collections-domain";

// Personal Library — Collections, server data access. Always runs as the
// signed-in person (request-scoped client): RLS limits every read and write
// to their own Collections. Never touches relationships or Saves.
//
// `available: false` means the user_collections tables don't exist yet
// (migration not applied) — callers hide Collections UI rather than erroring.

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);
const isMissing = (error: { code?: string } | null) => Boolean(error && MISSING_TABLE.has(error.code ?? ""));

export interface CollectionsResult {
  available: boolean;
  collections: CollectionSummary[];
}

/** The person's Collections (newest first) with item counts, flagging the
 * ones that already contain `entity` when given. */
export async function listCollections(client: SupabaseClient, userId: string, entity?: { type: CollectionEntityType; id: string }): Promise<CollectionsResult> {
  const { data, error } = await client.from("user_collections").select("id, name, created_at").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) return { available: !isMissing(error), collections: [] };
  const rows = (data ?? []) as { id: string; name: string }[];
  if (rows.length === 0) return { available: true, collections: [] };
  const { data: items } = await client.from("user_collection_items").select("collection_id, entity_type, entity_id").in("collection_id", rows.map((r) => r.id));
  const itemRows = (items ?? []) as { collection_id: string; entity_type: string; entity_id: string }[];
  return {
    available: true,
    collections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      itemCount: itemRows.filter((i) => i.collection_id === r.id).length,
      contains: Boolean(entity) && itemRows.some((i) => i.collection_id === r.id && i.entity_type === entity!.type && i.entity_id === entity!.id),
    })),
  };
}

/** Creates a Collection (name already normalized). Returns its id, or an
 * error code: "duplicate" when the person already has one by that name. */
export async function createCollection(client: SupabaseClient, userId: string, name: string): Promise<{ id: string } | { error: "duplicate" | "unavailable" | "failed" }> {
  const { data, error } = await client.from("user_collections").insert({ user_id: userId, name }).select("id").single();
  if (error) return { error: error.code === "23505" ? "duplicate" : isMissing(error) ? "unavailable" : "failed" };
  return { id: (data as { id: string }).id };
}

/** Adds / removes one entity. Idempotent. Ownership is enforced by RLS
 * (an item can only be written into the caller's own Collection). */
export async function setCollectionItem(client: SupabaseClient, collectionId: string, entity: { type: CollectionEntityType; id: string }, on: boolean): Promise<boolean> {
  if (on) {
    const { error } = await client.from("user_collection_items").insert({ collection_id: collectionId, entity_type: entity.type, entity_id: entity.id });
    return !error || error.code === "23505";
  }
  const { error } = await client.from("user_collection_items").delete().eq("collection_id", collectionId).eq("entity_type", entity.type).eq("entity_id", entity.id);
  return !error;
}

/** Entity ids per type in one of the person's Collections (null when it
 * isn't theirs / doesn't exist). */
export async function getCollectionMembers(client: SupabaseClient, userId: string, collectionId: string): Promise<{ name: string; members: Record<CollectionEntityType, string[]> } | null> {
  const { data: col, error } = await client.from("user_collections").select("id, name").eq("id", collectionId).eq("user_id", userId).maybeSingle();
  if (error || !col) return null;
  const { data } = await client.from("user_collection_items").select("entity_type, entity_id").eq("collection_id", collectionId).order("created_at", { ascending: false });
  const members: Record<CollectionEntityType, string[]> = { product: [], event: [], location: [], business: [] };
  for (const r of (data ?? []) as { entity_type: CollectionEntityType; entity_id: string }[]) members[r.entity_type]?.push(r.entity_id);
  return { name: (col as { name: string }).name, members };
}

/** Renames / deletes one of the person's Collections. */
export async function renameCollection(client: SupabaseClient, userId: string, collectionId: string, name: string): Promise<"ok" | "duplicate" | "failed"> {
  const { error } = await client.from("user_collections").update({ name, updated_at: new Date().toISOString() }).eq("id", collectionId).eq("user_id", userId);
  return error ? (error.code === "23505" ? "duplicate" : "failed") : "ok";
}

export async function deleteCollection(client: SupabaseClient, userId: string, collectionId: string): Promise<boolean> {
  const { error } = await client.from("user_collections").delete().eq("id", collectionId).eq("user_id", userId);
  return !error;
}
