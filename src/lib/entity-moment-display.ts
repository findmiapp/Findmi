import type { SupabaseClient } from "@supabase/supabase-js";

/** Entity-owned display preferences for Moments (migration 20261101000100).
 *
 * A Moment has ONE author and lives on its own page; BUSINESSES, LOCATIONS and
 * EVENTS it is connected to each decide whether it is shown on THEIR public
 * profile. That decision is a preference of the displaying entity — it never
 * edits, unpublishes or deletes the Moment, never touches its author, and never
 * affects any other profile. No row = the default = shown (so adding this
 * changes nothing that is visible today). A row records a deviation:
 *   hidden   — not shown on this entity's profile
 *   featured — reserved by the schema; no profile surface renders it yet
 *
 * Reads fail OPEN (a missing table/error means "no preferences"), so public
 * pages keep working before the migration is applied. */

export type MomentDisplayEntity = "business" | "location" | "event";
export const MOMENT_DISPLAY_ENTITIES: readonly MomentDisplayEntity[] = ["business", "location", "event"];
export const isMomentDisplayEntity = (v: unknown): v is MomentDisplayEntity => (MOMENT_DISPLAY_ENTITIES as readonly unknown[]).includes(v);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entry ids this entity has hidden from its profile (anon-readable). */
export async function getHiddenMomentIds(client: SupabaseClient | null, entityType: MomentDisplayEntity, entityId: string): Promise<string[]> {
  if (!client || !UUID_RE.test(entityId)) return [];
  const { data, error } = await client
    .from("entity_moment_display")
    .select("journal_entry_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("display", "hidden")
    .limit(5000);
  if (error) return [];
  return ((data ?? []) as { journal_entry_id: string }[]).map((r) => r.journal_entry_id).filter((id) => UUID_RE.test(id));
}

/** `(id,id,…)` for a PostgREST `not.in` — ids come from our own rows. */
export const notInList = (ids: string[]) => `(${ids.join(",")})`;

export type MomentDisplayResult = { ok: true } | { ok: false; error: string };

/** Writes one preference (service role; the caller has already authorized the
 * entity and verified the Moment is connected to it). Showing again deletes the
 * row — the default needs no storage. */
export async function setMomentDisplay(
  admin: SupabaseClient,
  entityType: MomentDisplayEntity,
  entityId: string,
  journalEntryId: string,
  display: "shown" | "hidden",
  userId: string | null
): Promise<MomentDisplayResult> {
  if (!UUID_RE.test(entityId) || !UUID_RE.test(journalEntryId)) return { ok: false, error: "That Moment wasn't found." };
  if (display === "shown") {
    const { error } = await admin.from("entity_moment_display").delete().eq("entity_type", entityType).eq("entity_id", entityId).eq("journal_entry_id", journalEntryId);
    if (error && error.code !== "42P01" && error.code !== "PGRST205") return { ok: false, error: "Couldn't update that. Please try again." };
    return { ok: true };
  }
  const { error } = await admin
    .from("entity_moment_display")
    .upsert(
      { entity_type: entityType, entity_id: entityId, journal_entry_id: journalEntryId, display: "hidden", updated_by_user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "entity_type,entity_id,journal_entry_id" }
    );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/.test(error.message ?? "")) return { ok: false, error: "Profile display controls aren’t available yet. Please try again soon." };
    return { ok: false, error: "Couldn't update that. Please try again." };
  }
  return { ok: true };
}
