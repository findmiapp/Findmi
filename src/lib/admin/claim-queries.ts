import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "./supabase-admin";

export type ClaimEntityType = "business" | "event";
export type ClaimStatus = "pending" | "approved" | "rejected";
export type ClaimPaymentStatus = "unpaid" | "paid" | "refunded";

export interface AdminClaimRow {
  id: string;
  user_id: string;
  entityType: ClaimEntityType;
  entity: { id: string; name: string; slug: string } | null;
  status: ClaimStatus;
  message: string | null;
  created_at: string;
  reviewed_at: string | null;
  paymentStatus: ClaimPaymentStatus;
  paymentAmount: number | null;
  paidAt: string | null;
  /** The claim's own submitted contact email (required at submission —
   * prefilled from the account but editable, see /api/account/claim) —
   * NOT necessarily the account's login email. This is the claim's own
   * record, deliberately not the Auth Admin API's account email. */
  claimantEmail: string | null;
  /** The claim's own full_name (required at submission). */
  claimantDisplayName: string | null;
  /** The claim's own phone (required at submission). */
  claimantPhone: string | null;
  entityAlreadyOwned: boolean;
}

export interface ClaimListFilters {
  status?: ClaimStatus;
  entityType?: ClaimEntityType;
  /** "paid_needs_review" — status='pending' AND paymentStatus='paid',
   * the operational state the founder should act on first. */
  view?: "paid_needs_review";
}

type RawClaimRow = {
  id: string;
  user_id: string;
  status: ClaimStatus;
  message: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  reviewed_at: string | null;
  payment_status: ClaimPaymentStatus;
  payment_amount: number | null;
  paid_at: string | null;
  entity: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
};

async function fetchClaims(
  supabase: SupabaseClient,
  table: string,
  entityTable: string,
  filters: ClaimListFilters
): Promise<(Omit<RawClaimRow, "entity"> & { entity: { id: string; name: string; slug: string } | null })[]> {
  let query = supabase
    .from(table)
    .select(
      `id, user_id, status, message, full_name, email, phone, created_at, reviewed_at, payment_status, payment_amount, paid_at, entity:${entityTable}(id, name, slug)`
    )
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.view === "paid_needs_review") query = query.eq("status", "pending").eq("payment_status", "paid");

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
 * name/email/phone all come directly off the claim row (full_name/email/
 * phone — required at submission for a claim made through the current
 * form; null on the one pre-existing claim created before these columns
 * existed) — no profiles or Auth Admin API lookup needed. */
export async function getAdminClaims(filters: ClaimListFilters = {}): Promise<AdminClaimRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  const wantBusiness = !filters.entityType || filters.entityType === "business";
  const wantEvent = !filters.entityType || filters.entityType === "event";

  const [businessRows, eventRows] = await Promise.all([
    wantBusiness ? fetchClaims(supabase, "business_claim_requests", "businesses", filters) : Promise.resolve([]),
    wantEvent ? fetchClaims(supabase, "event_claim_requests", "events", filters) : Promise.resolve([]),
  ]);

  const combined = [
    ...businessRows.map((r) => ({ ...r, entityType: "business" as const })),
    ...eventRows.map((r) => ({ ...r, entityType: "event" as const })),
  ];

  const businessIds = Array.from(new Set(combined.filter((c) => c.entityType === "business").map((c) => c.entity?.id).filter((id): id is string => Boolean(id))));
  const eventIds = Array.from(new Set(combined.filter((c) => c.entityType === "event").map((c) => c.entity?.id).filter((id): id is string => Boolean(id))));

  const [{ data: businessOwners }, { data: eventOwners }] = await Promise.all([
    businessIds.length
      ? supabase.from("business_members").select("business_id").eq("role", "owner").in("business_id", businessIds)
      : Promise.resolve({ data: [] as { business_id: string }[] }),
    eventIds.length
      ? supabase.from("event_members").select("event_id").eq("role", "owner").in("event_id", eventIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
  ]);

  const ownedBusinessIds = new Set(((businessOwners ?? []) as { business_id: string }[]).map((r) => r.business_id));
  const ownedEventIds = new Set(((eventOwners ?? []) as { event_id: string }[]).map((r) => r.event_id));

  return combined
    .map((c) => ({
      id: c.id,
      user_id: c.user_id,
      entityType: c.entityType,
      entity: c.entity,
      status: c.status,
      message: c.message,
      created_at: c.created_at,
      reviewed_at: c.reviewed_at,
      paymentStatus: c.payment_status,
      paymentAmount: c.payment_amount,
      paidAt: c.paid_at,
      claimantEmail: c.email,
      claimantDisplayName: c.full_name,
      claimantPhone: c.phone,
      entityAlreadyOwned: c.entityType === "business" ? ownedBusinessIds.has(c.entity?.id ?? "") : ownedEventIds.has(c.entity?.id ?? ""),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// ── Current access (business_members / event_members) ──────────────────────
// Deliberately separate from everything above: a claim row is a historical
// record of a REQUEST, never edited to reflect current access. Membership
// is the current-access grant, read here independently so /admin/claims can
// show "who has access to this business/event right now" alongside (never
// merged into) the claim's own historical fields.

export type MemberRole = "owner" | "manager" | "staff";

export interface AdminCurrentAccessMember {
  /** business_members/event_members row id — the identifier every
   * role-change/remove action below operates on, never the claim id. */
  id: string;
  user_id: string;
  role: MemberRole;
  displayName: string | null;
  /** The account's real login email (Auth Admin API), not a claim's own
   * submitted contact email — those are two different things (see
   * AdminClaimRow.claimantEmail's own note). */
  email: string | null;
}

const MEMBER_TABLE: Record<ClaimEntityType, "business_members" | "event_members"> = {
  business: "business_members",
  event: "event_members",
};
const MEMBER_ENTITY_COLUMN: Record<ClaimEntityType, "business_id" | "event_id"> = {
  business: "business_id",
  event: "event_id",
};
const ROLE_SORT_ORDER: Record<MemberRole, number> = { owner: 0, manager: 1, staff: 2 };

/** Batched account lookups for a small, bounded set of user ids — the
 * Auth Admin API has no "get many by id" call, so this is one request per
 * unique member account, run in parallel; fine at the scale claims/
 * memberships actually run at (a handful of entities, a few members
 * each), same "small dataset, in-JS merge" reasoning getAdminClaims above
 * already uses. Never throws — a lookup failure just leaves that member's
 * email null rather than breaking the whole page. */
async function fetchEmailsByUserId(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  await Promise.all(
    userIds.map(async (id) => {
      const { data } = await supabase.auth.admin.getUserById(id);
      map.set(id, data.user?.email ?? null);
    })
  );
  return map;
}

/** Current business_members/event_members for a set of entities, keyed by
 * entity id — owner first, then manager/staff. Used by the claims page to
 * render each claim's "Current Access" section without ever reading or
 * writing through the claim record itself. */
export async function getCurrentAccessByEntity(
  entityType: ClaimEntityType,
  entityIds: string[]
): Promise<Map<string, AdminCurrentAccessMember[]>> {
  const map = new Map<string, AdminCurrentAccessMember[]>();
  if (entityIds.length === 0) return map;
  const supabase = getAdminSupabase();
  if (!supabase) return map;

  const table = MEMBER_TABLE[entityType];
  const column = MEMBER_ENTITY_COLUMN[entityType];
  const { data } = await supabase.from(table).select(`id, user_id, role, ${column}`).in(column, entityIds);
  const rows = (data ?? []) as { id: string; user_id: string; role: MemberRole; [key: string]: unknown }[];
  if (rows.length === 0) return map;

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const [{ data: profileRows }, emailByUser] = await Promise.all([
    supabase.from("profiles").select("id, display_name").in("id", userIds),
    fetchEmailsByUserId(supabase, userIds),
  ]);
  const displayNameByUser = new Map(
    ((profileRows ?? []) as { id: string; display_name: string | null }[]).map((p) => [p.id, p.display_name])
  );

  for (const row of rows) {
    const entityId = row[column] as string;
    const member: AdminCurrentAccessMember = {
      id: row.id,
      user_id: row.user_id,
      role: row.role,
      displayName: displayNameByUser.get(row.user_id) ?? null,
      email: emailByUser.get(row.user_id) ?? null,
    };
    map.set(entityId, [...(map.get(entityId) ?? []), member]);
  }
  for (const members of map.values()) {
    members.sort((a, b) => ROLE_SORT_ORDER[a.role] - ROLE_SORT_ORDER[b.role]);
  }
  return map;
}
