import { getAdminSupabase } from "./supabase-admin";
import type { BillingStatus, Market, Membership, MembershipPlan, OnboardingStatus, PublicationStatus } from "@/lib/types";
import type { SelectOption } from "./queries";

export interface AdminMembershipRow extends Membership {
  plan: { id: string; name: string; slug: string } | null;
  business: { id: string; name: string; slug: string } | null;
  markets: { id: string; name: string }[];
}

export interface MembershipListFilters {
  q?: string;
  view?: "pending_review" | "paid_incomplete" | "comped_pending" | "approved_live" | "rejected";
}

/** The founder's onboarding queue. Small dataset (invited/paid vendors,
 * not the whole business table), so one query + in-JS market/plan
 * attach is fine — no need for the server-side search picker pattern
 * here, unlike /admin/api/search's bounded-result relationship pickers. */
export async function getAdminMemberships(filters: MembershipListFilters = {}): Promise<AdminMembershipRow[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  let query = supabase
    .from("memberships")
    .select("*, plan:membership_plans(id, name, slug), business:businesses(id, name, slug)")
    .order("created_at", { ascending: false });

  if (filters.view === "pending_review") query = query.eq("publication_status", "pending_review");
  if (filters.view === "paid_incomplete") query = query.eq("billing_status", "paid").eq("onboarding_status", "incomplete");
  if (filters.view === "comped_pending") query = query.eq("billing_status", "comped").in("onboarding_status", ["not_started", "incomplete", "submitted"]);
  if (filters.view === "approved_live") query = query.eq("publication_status", "live");
  if (filters.view === "rejected") query = query.eq("publication_status", "rejected");

  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`contact_name.ilike.${term},contact_email.ilike.${term},intended_business_name.ilike.${term}`);
  }

  const { data } = await query;
  const rows = (data ?? []) as never[];

  type Row = Membership & {
    plan: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
    business: { id: string; name: string; slug: string } | { id: string; name: string; slug: string }[] | null;
  };
  const normalized = rows.map((row: unknown) => {
    const r = row as Row;
    return {
      ...r,
      plan: Array.isArray(r.plan) ? (r.plan[0] ?? null) : r.plan,
      business: Array.isArray(r.business) ? (r.business[0] ?? null) : r.business,
    };
  });

  const membershipIds = normalized.map((m) => m.id);
  const { data: marketLinks } = membershipIds.length
    ? await supabase
        .from("membership_markets")
        .select("membership_id, markets(id, name)")
        .in("membership_id", membershipIds)
    : { data: [] as never[] };

  const marketsByMembership = new Map<string, { id: string; name: string }[]>();
  for (const row of (marketLinks ?? []) as {
    membership_id: string;
    markets: { id: string; name: string } | { id: string; name: string }[] | null;
  }[]) {
    const m = Array.isArray(row.markets) ? row.markets[0] : row.markets;
    if (!m) continue;
    const existing = marketsByMembership.get(row.membership_id) ?? [];
    marketsByMembership.set(row.membership_id, [...existing, m]);
  }

  return normalized.map((m) => ({ ...m, markets: marketsByMembership.get(m.id) ?? [] }));
}

export async function getAdminMembershipById(id: string): Promise<AdminMembershipRow | null> {
  const rows = await getAdminMemberships({});
  return rows.find((m) => m.id === id) ?? null;
}

/** The one membership tied to a business, for the Membership section on
 * the business admin page. A business can only have one active
 * membership record in this model. */
export async function getMembershipForBusiness(businessId: string): Promise<AdminMembershipRow | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("memberships")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return getAdminMembershipById(data.id);
}

export async function getAllMembershipPlans(): Promise<MembershipPlan[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("membership_plans").select("*").order("sort_order");
  return data ?? [];
}

export async function getMembershipPlanById(id: string): Promise<MembershipPlan | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("membership_plans").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function getAllMarkets(): Promise<Market[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("markets").select("*").order("sort_order");
  return data ?? [];
}

export async function getMarketIdsForMembership(membershipId: string): Promise<string[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  const { data } = await supabase.from("membership_markets").select("market_id").eq("membership_id", membershipId);
  return (data ?? []).map((r) => r.market_id);
}

/** Looks up just the one business a membership is already linked to, for
 * seeding the "Link Existing Business" RelationField's initial value. */
export async function getBusinessOptionByIdForMembership(id: string | null): Promise<SelectOption | null> {
  if (!id) return null;
  const supabase = getAdminSupabase();
  if (!supabase) return null;
  const { data } = await supabase.from("businesses").select("id, name, city, state").eq("id", id).maybeSingle();
  if (!data) return null;
  return {
    value: data.id,
    label: data.name,
    sublabel: [data.city, data.state].filter(Boolean).join(", ") || undefined,
  };
}

export function billingStatusLabel(s: BillingStatus): string {
  return { comped: "Comped", pending_payment: "Pending Payment", paid: "Paid", past_due: "Past Due", cancelled: "Cancelled" }[s];
}
export function onboardingStatusLabel(s: OnboardingStatus): string {
  return { not_started: "Not Started", incomplete: "Incomplete", submitted: "Submitted", approved: "Approved" }[s];
}
export function publicationStatusLabel(s: PublicationStatus): string {
  return { draft: "Draft", pending_review: "Pending Review", live: "Live", paused: "Paused", rejected: "Rejected" }[s];
}
