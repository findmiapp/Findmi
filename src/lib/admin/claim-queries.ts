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
