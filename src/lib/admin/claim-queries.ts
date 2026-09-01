import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "./supabase-admin";

export type ClaimEntityType = "business" | "event";
export type ClaimStatus = "pending" | "approved" | "rejected";

export interface AdminClaimRow {
  id: string;
  user_id: string;
  entityType: ClaimEntityType;
  entity: { id: string; name: string; slug: string } | null;
  status: ClaimStatus;
  message: string | null;
  created_at: string;
  reviewed_at: string | null;
  claimantEmail: string | null;
  claimantDisplayName: string | null;
  entityAlreadyOwned: boolean;
}

export interface ClaimListFilters {
  status?: ClaimStatus;
  entityType?: ClaimEntityType;
}

type RawClaimRow = {
  id: string;
  user_id: string;
  status: ClaimStatus;
  message: string | null;
  created_at: string;
  reviewed_at: string | null;
  entity: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
};

async function fetchClaims(
  supabase: SupabaseClient,
  table: string,
  entityTable: string,
  status?: ClaimStatus
): Promise<Omit<AdminClaimRow, "entityType" | "claimantEmail" | "claimantDisplayName" | "entityAlreadyOwned">[]> {
  let query = supabase
    .from(table)
    .select(`id, user_id, status, message, created_at, reviewed_at, entity:${entityTable}(id, name, slug)`)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data } = await query;
  return ((data ?? []) as never[]).map((row: unknown) => {
    const r = row as RawClaimRow;
    return { ...r, entity: Array.isArray(r.entity) ? (r.entity[0] ?? null) : r.entity };
  });
}

/** The founder's claim review queue — small dataset by nature (new claims
 * only, not the whole businesses/events table), so a couple of batched
 * follow-up queries + in-JS merge is fine, same shape
 * getAdminMemberships() already uses for membership_markets. Claimant
 * email comes from the Auth Admin API (getUserById) — email intentionally
 * isn't duplicated onto profiles (see the account foundation migration),
 * so there's no public.profiles.email column to select instead. */
export async function getAdminClaims(filters: ClaimListFilters = {}): Promise<AdminClaimRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  const wantBusiness = !filters.entityType || filters.entityType === "business";
  const wantEvent = !filters.entityType || filters.entityType === "event";

  const [businessRows, eventRows] = await Promise.all([
    wantBusiness ? fetchClaims(supabase, "business_claim_requests", "businesses", filters.status) : Promise.resolve([]),
    wantEvent ? fetchClaims(supabase, "event_claim_requests", "events", filters.status) : Promise.resolve([]),
  ]);

  const combined = [
    ...businessRows.map((r) => ({ ...r, entityType: "business" as const })),
    ...eventRows.map((r) => ({ ...r, entityType: "event" as const })),
  ];

  const businessIds = Array.from(new Set(combined.filter((c) => c.entityType === "business").map((c) => c.entity?.id).filter((id): id is string => Boolean(id))));
  const eventIds = Array.from(new Set(combined.filter((c) => c.entityType === "event").map((c) => c.entity?.id).filter((id): id is string => Boolean(id))));
  const userIds = Array.from(new Set(combined.map((c) => c.user_id)));

  const [{ data: businessOwners }, { data: eventOwners }, { data: profiles }] = await Promise.all([
    businessIds.length
      ? supabase.from("business_members").select("business_id").eq("role", "owner").in("business_id", businessIds)
      : Promise.resolve({ data: [] as { business_id: string }[] }),
    eventIds.length
      ? supabase.from("event_members").select("event_id").eq("role", "owner").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    userIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);

  const ownedBusinessIds = new Set(((businessOwners ?? []) as { business_id: string }[]).map((r) => r.business_id));
  const ownedEventIds = new Set(((eventOwners ?? []) as { event_id: string }[]).map((r) => r.event_id));
  const displayNameByUser = new Map(((profiles ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name]));

  const emailByUser = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(id);
        emailByUser.set(id, data?.user?.email ?? null);
      } catch {
        emailByUser.set(id, null);
      }
    })
  );

  return combined
    .map((c) => ({
      ...c,
      claimantEmail: emailByUser.get(c.user_id) ?? null,
      claimantDisplayName: displayNameByUser.get(c.user_id) ?? null,
      entityAlreadyOwned: c.entityType === "business" ? ownedBusinessIds.has(c.entity?.id ?? "") : ownedEventIds.has(c.entity?.id ?? ""),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
