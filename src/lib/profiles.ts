// Public user identity reads - User Identity + Follow Foundation pass.
// getPublicProfileByUsername reads the public_profiles VIEW, not the
// profiles table directly - the view's own SELECT list (username,
// display_name, avatar_url, bio, location_label only - see migration
// public_profiles_view) is the actual privacy boundary: profiles itself
// has no public read policy at all, so this is the only path anon can
// ever reach it through, and it structurally cannot return id/created_at/
// updated_at/anything else no matter what a caller asks for.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import type { PublicProfile } from "./types";

const PUBLIC_PROFILE_COLUMNS = "username, display_name, avatar_url, bio, location_label";

export async function getPublicProfileByUsername(username: string): Promise<PublicProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("public_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq("username", username.trim().toLowerCase())
    .maybeSingle();
  return (data as PublicProfile | null) ?? null;
}

/** Batch lookup by auth user id - used wherever a list of user_ids (e.g.
 * follower rows) needs to be resolved into public-safe identity chips.
 * Server-only: this queries the raw `profiles` table (needs `id` as the
 * join key, which the public_profiles view deliberately omits), so it
 * must always be called with the service-role admin client - profiles
 * has no public/anon read policy at all, so an anon client here would
 * simply get zero rows back regardless of the .in()/.not() filters below.
 * A user_id with no public profile yet has no entry in the returned map,
 * which is the correct "count them, but don't expose a private fallback
 * identity" behavior - and `id` itself is never included in a returned
 * value, only used as the map key. */
export async function getPublicProfilesByUserIds(
  supabase: SupabaseClient | null,
  userIds: string[]
): Promise<Map<string, PublicProfile>> {
  const map = new Map<string, PublicProfile>();
  if (!supabase || userIds.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select(`id, ${PUBLIC_PROFILE_COLUMNS}`)
    .in("id", userIds)
    .not("username", "is", null);
  for (const row of (data ?? []) as (PublicProfile & { id: string })[]) {
    map.set(row.id, { username: row.username, display_name: row.display_name, avatar_url: row.avatar_url, bio: row.bio, location_label: row.location_label });
  }
  return map;
}
