import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanEventFormatIds, diffEventFormats } from "./event-formats";

/** Keeps only ids that are real kind='event_format' categories (never an
 * Event category, or anything made up). The database refuses any other
 * link too (trg_event_formats_kind); this keeps a bad id from failing the
 * whole save. */
export async function existingEventFormatIds(client: SupabaseClient, ids: readonly string[]): Promise<string[]> {
  const clean = cleanEventFormatIds(ids);
  if (clean.length === 0) return [];
  const { data, error } = await client.from("categories").select("id").eq("kind", "event_format").in("id", clean);
  if (error) return [];
  const valid = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  return clean.filter((id) => valid.has(id));
}

/** Makes an Event's Format links exactly `wanted`: removes deselected
 * links, adds new ones, leaves the rest untouched (no churn, never a
 * duplicate — the table's primary key also refuses one). */
export async function syncEventFormats(client: SupabaseClient, eventId: string, wanted: readonly string[]): Promise<{ error?: string }> {
  const valid = await existingEventFormatIds(client, wanted);
  const { data: rows, error: readError } = await client.from("event_formats").select("category_id").eq("event_id", eventId);
  if (readError) return { error: readError.message };
  const { add, remove } = diffEventFormats(((rows ?? []) as { category_id: string }[]).map((r) => r.category_id), valid);
  if (remove.length > 0) {
    const { error } = await client.from("event_formats").delete().eq("event_id", eventId).in("category_id", remove);
    if (error) return { error: error.message };
  }
  if (add.length > 0) {
    const { error } = await client
      .from("event_formats")
      .upsert(add.map((category_id) => ({ event_id: eventId, category_id })), { onConflict: "event_id,category_id", ignoreDuplicates: true });
    if (error) return { error: error.message };
  }
  return {};
}

/** The Event's current Format ids (for prefilling a picker). */
export async function getEventFormatIds(client: SupabaseClient, eventId: string): Promise<string[]> {
  const { data } = await client.from("event_formats").select("category_id").eq("event_id", eventId);
  return ((data ?? []) as { category_id: string }[]).map((r) => r.category_id);
}
