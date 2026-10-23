"use server";

import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { isTargetKind } from "@/lib/commercial-intents";
import { getEntityRelationships, type EntityRelationship } from "@/lib/relationship-context";

/** "For Your Business" on a public Place / Business / Event page — the signed-
 * in viewer's OWN Businesses' relationship with this entity, read for that
 * viewer only (their business_members rows, re-read here — never ids from
 * the client). Anonymous visitors and people who manage no Business get
 * nothing. Never returns another Business's Targets, nor any Context, Next
 * Step, Activity or Findmi Internal. */
export async function getEntityRelationshipsAction(kind: string, entityId: string): Promise<EntityRelationship[]> {
  if (!isTargetKind(kind)) return [];
  const user = await getCurrentUser().catch(() => null);
  if (!user) return [];
  const admin = getAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from("business_members")
    .select("business_id, role, business:businesses(id, name, archived_at, trashed_at)")
    .eq("user_id", user.id)
    .limit(20);
  type R = { business_id: string; role: string; business: { id: string; name: string; archived_at: string | null; trashed_at: string | null } | { id: string; name: string; archived_at: string | null; trashed_at: string | null }[] | null };
  const businesses = ((data ?? []) as unknown as R[])
    .map((r) => ({ role: r.role, b: Array.isArray(r.business) ? r.business[0] : r.business }))
    .filter((r) => r.b && !r.b.archived_at && !r.b.trashed_at)
    .map((r) => ({ id: r.b!.id, name: r.b!.name, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return getEntityRelationships(admin, businesses, kind, entityId);
}
