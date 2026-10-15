import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Keeps only ids that are real kind='event' categories — a submitted
 * category id is never trusted as-is (a Business/Product/Location id, or
 * a made-up one, is dropped rather than linked to an Event). */
export async function existingEventCategoryIds(client: SupabaseClient, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("categories").select("id").eq("kind", "event").in("id", [...ids]);
  if (error) return [];
  const valid = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  return ids.filter((id) => valid.has(id));
}
