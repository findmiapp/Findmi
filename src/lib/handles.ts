// FindMi Global Handle Registry — server-only helpers shared by every
// entity's "choose a username" write path (Business/Location/Event; the
// Person case is its own claim_person_handle() RPC, called directly from
// account/profile/actions.ts since it also has to sync profiles.username).
// See supabase/migrations/20260907170000_handles_registry.sql for the
// actual table/constraints — the unique index on `handle` there is the
// real cross-entity uniqueness guarantee, not anything in this file.
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateUsername } from "./username";

export type HandleEntityType = "person" | "business" | "location" | "event";

export interface ClaimHandleResult {
  ok: boolean;
  value?: string;
  error?: string;
}

/** Business/Location/Event handle claim (Person goes through the separate
 * claim_person_handle() RPC instead — see account/profile/actions.ts).
 * `admin` must already be a service-role client, and the caller must have
 * ALREADY authorized `entityId` against `entityType` (requireBusinessMember/
 * requireLocationMember/requireEventMember) before calling this — this
 * function performs no authorization of its own, only the claim itself.
 *
 * Upserts on (entity_type, entity_id) — one handle per entity, changing it
 * updates the same row rather than leaving an old one behind (this pass's
 * own "no username history" rule). A collision with a DIFFERENT entity's
 * handle (any type, including Person) surfaces as a 23505 unique_violation
 * on the global `handle` index, caught here and turned into the same
 * clean, non-leaking message every other race-safety path in this app
 * already uses. */
export async function claimEntityHandle(
  admin: SupabaseClient,
  entityType: Exclude<HandleEntityType, "person">,
  entityId: string,
  rawHandle: string,
  userId: string | null
): Promise<ClaimHandleResult> {
  const validation = validateUsername(rawHandle);
  if (!validation.ok) return { ok: false, error: validation.error ?? "Invalid username." };

  const { error } = await admin
    .from("handles")
    .upsert(
      { handle: validation.value, entity_type: entityType, entity_id: entityId, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "entity_type,entity_id" }
    );

  if (error) {
    if (error.code === "23505") return { ok: false, error: "That username was just taken. Try another one." };
    return { ok: false, error: "Couldn't save that username. Please try again." };
  }
  return { ok: true, value: validation.value };
}

/** Current handle for one entity, if any — used by owner-facing manager
 * pages to prefill the field and show the current public URL. Reads the
 * base table (never the public view) since this is an authorized,
 * service-role owner-facing read, not a public one. */
export async function getEntityHandle(
  admin: SupabaseClient,
  entityType: HandleEntityType,
  entityId: string
): Promise<string | null> {
  const { data } = await admin
    .from("handles")
    .select("handle")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  return data?.handle ?? null;
}
