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
 *   featured — this entity shows the Moment FIRST on its profile (at most one
 *              per entity; featuring another replaces it). A featured Moment is
 *              never hidden and a hidden one is never featured: one row, one state.
 *
 * Reads fail OPEN (a missing table/error means "no preferences"), so public
 * pages keep working before the migration is applied. */

export type MomentDisplayEntity = "business" | "location" | "event";
export const MOMENT_DISPLAY_ENTITIES: readonly MomentDisplayEntity[] = ["business", "location", "event"];
export const isMomentDisplayEntity = (v: unknown): v is MomentDisplayEntity => (MOMENT_DISPLAY_ENTITIES as readonly unknown[]).includes(v);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What this entity has decided about its Moments (anon-readable). */
export interface EntityMomentDisplay {
  hidden: string[];
  /** The one Moment shown first, or null. */
  featured: string | null;
}

export const NO_MOMENT_DISPLAY: EntityMomentDisplay = { hidden: [], featured: null };

export async function getEntityMomentDisplay(client: SupabaseClient | null, entityType: MomentDisplayEntity, entityId: string): Promise<EntityMomentDisplay> {
  if (!client || !UUID_RE.test(entityId)) return NO_MOMENT_DISPLAY;
  const { data, error } = await client
    .from("entity_moment_display")
    .select("journal_entry_id, display")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .limit(5000);
  if (error) return NO_MOMENT_DISPLAY;
  const rows = ((data ?? []) as { journal_entry_id: string; display: string }[]).filter((r) => UUID_RE.test(r.journal_entry_id));
  return { hidden: rows.filter((r) => r.display === "hidden").map((r) => r.journal_entry_id), featured: rows.find((r) => r.display === "featured")?.journal_entry_id ?? null };
}

/** Entry ids this entity has hidden from its profile (anon-readable). */
export async function getHiddenMomentIds(client: SupabaseClient | null, entityType: MomentDisplayEntity, entityId: string): Promise<string[]> {
  return (await getEntityMomentDisplay(client, entityType, entityId)).hidden;
}

/** `(id,id,…)` for a PostgREST `not.in` — ids come from our own rows. */
export const notInList = (ids: string[]) => `(${ids.join(",")})`;

export type MomentDisplayResult = { ok: true } | { ok: false; error: string };

export type MomentDisplayState = "shown" | "hidden" | "featured";

/** Writes one preference (service role; the caller has already authorized the
 * entity and verified the Moment is connected to it). Showing again deletes the
 * row — the default needs no storage. Featuring replaces any other featured
 * Moment of the same entity (that one simply goes back to shown). */
export async function setMomentDisplay(
  admin: SupabaseClient,
  entityType: MomentDisplayEntity,
  entityId: string,
  journalEntryId: string,
  display: MomentDisplayState,
  userId: string | null
): Promise<MomentDisplayResult> {
  if (!UUID_RE.test(entityId) || !UUID_RE.test(journalEntryId)) return { ok: false, error: "That Moment wasn't found." };
  const unavailable = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/.test(e.message ?? "")));
  if (display === "shown") {
    const { error } = await admin.from("entity_moment_display").delete().eq("entity_type", entityType).eq("entity_id", entityId).eq("journal_entry_id", journalEntryId);
    if (error && !unavailable(error)) return { ok: false, error: "Couldn't update that. Please try again." };
    return { ok: true };
  }
  if (display === "featured") {
    // One featured per entity: release the previous one first.
    const { error: clearError } = await admin.from("entity_moment_display").delete().eq("entity_type", entityType).eq("entity_id", entityId).eq("display", "featured").neq("journal_entry_id", journalEntryId);
    if (clearError) return { ok: false, error: unavailable(clearError) ? "Profile display controls aren’t available yet. Please try again soon." : "Couldn't update that. Please try again." };
  }
  const { error } = await admin
    .from("entity_moment_display")
    .upsert(
      { entity_type: entityType, entity_id: entityId, journal_entry_id: journalEntryId, display, updated_by_user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "entity_type,entity_id,journal_entry_id" }
    );
  if (error) {
    if (unavailable(error)) return { ok: false, error: "Profile display controls aren’t available yet. Please try again soon." };
    return { ok: false, error: "Couldn't update that. Please try again." };
  }
  return { ok: true };
}
