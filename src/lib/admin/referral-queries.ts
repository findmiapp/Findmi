import { getAdminSupabase } from "./supabase-admin";

// Referral Partner + Discount + Manual Payout Foundation — admin reads
// only. All five referral_* tables have RLS enabled with zero policies
// (service_role via getAdminSupabase() is the only reader) — same
// pattern pro_invites/queries.ts already established. Writes never
// happen here — every mutation goes through admin/referrals/actions.ts
// or the SECURITY DEFINER RPCs (attribute_referral/
// qualify_referral_earning/request_referral_payout), never a plain
// update from this file.

export interface AdminReferralPartner {
  id: string;
  business_id: string;
  business_name: string | null;
  label: string | null;
  is_active: boolean;
  default_commission_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  referralCount: number;
  freeReferralCount: number;
  paidReferralCount: number;
  grossReferredRevenueCents: number;
  earnedCommissionCents: number;
  paidCommissionCents: number;
  availableCommissionCents: number;
}

interface RawPartnerRow {
  id: string;
  business_id: string;
  label: string | null;
  is_active: boolean;
  default_commission_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  business: { name: string } | { name: string }[] | null;
}

function summarizePartner(
  p: RawPartnerRow,
  attributions: { status: string }[],
  earnings: { gross_amount_cents: number; commission_amount_cents: number; status: string }[]
): AdminReferralPartner {
  const business = Array.isArray(p.business) ? p.business[0] : p.business;
  const paidReferralCount = attributions.filter((a) => a.status === "qualified").length;
  return {
    id: p.id,
    business_id: p.business_id,
    business_name: business?.name ?? null,
    label: p.label,
    is_active: p.is_active,
    default_commission_cents: p.default_commission_cents,
    notes: p.notes,
    created_at: p.created_at,
    updated_at: p.updated_at,
    referralCount: attributions.length,
    freeReferralCount: attributions.length - paidReferralCount,
    paidReferralCount,
    grossReferredRevenueCents: earnings.reduce((sum, e) => sum + e.gross_amount_cents, 0),
    earnedCommissionCents: earnings.reduce((sum, e) => sum + e.commission_amount_cents, 0),
    paidCommissionCents: earnings.filter((e) => e.status === "paid").reduce((sum, e) => sum + e.commission_amount_cents, 0),
    availableCommissionCents: earnings
      .filter((e) => e.status === "available")
      .reduce((sum, e) => sum + e.commission_amount_cents, 0),
  };
}

/** Compact list for /admin/referrals — every partner with its own
 * summary counts/totals computed here (not a large analytics dashboard,
 * just the operational numbers this pass asks for). Fine to filter in
 * JS across a modest per-partner row set for a V1 admin tool; this is
 * not a public or high-traffic path. */
export async function getAdminReferralPartners(): Promise<AdminReferralPartner[]> {
  const supabase = getAdminSupabase();
  if (!supabase) return [];

  const { data: partners } = await supabase
    .from("referral_partners")
    .select("*, business:businesses(name)")
    .order("created_at", { ascending: false });
  if (!partners || partners.length === 0) return [];

  const partnerIds = partners.map((p) => p.id);
  const [{ data: attributions }, { data: earnings }] = await Promise.all([
    supabase.from("referral_attributions").select("referral_partner_id, status").in("referral_partner_id", partnerIds),
    supabase
      .from("referral_earnings")
      .select("referral_partner_id, gross_amount_cents, commission_amount_cents, status")
      .in("referral_partner_id", partnerIds),
  ]);

  return (partners as RawPartnerRow[]).map((p) =>
    summarizePartner(
      p,
      (attributions ?? []).filter((a) => a.referral_partner_id === p.id),
      (earnings ?? []).filter((e) => e.referral_partner_id === p.id)
    )
  );
}

export interface OwnedReferralPartner extends AdminReferralPartner {
  /** Every currently-active code under this partner, own codes only —
   * for the partner-facing Referral tab's shareable link(s). Never
   * exposes any other partner's codes or any referred business's
   * identity/contact info. */
  activeCodes: string[];
}

/** The one partner record for a specific business, if any — used by the
 * owner-facing Referral tab (account/business/[id]/page.tsx) to decide
 * whether to show it at all. unique(business_id) on referral_partners
 * guarantees at most one row. */
export async function getReferralPartnerByBusinessId(businessId: string): Promise<OwnedReferralPartner | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const { data: partner } = await supabase
    .from("referral_partners")
    .select("*, business:businesses(name)")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!partner) return null;

  const [{ data: attributions }, { data: earnings }, { data: codes }] = await Promise.all([
    supabase.from("referral_attributions").select("status").eq("referral_partner_id", partner.id),
    supabase
      .from("referral_earnings")
      .select("gross_amount_cents, commission_amount_cents, status")
      .eq("referral_partner_id", partner.id),
    supabase.from("referral_codes").select("code").eq("referral_partner_id", partner.id).eq("is_active", true),
  ]);

  return {
    ...summarizePartner(partner as RawPartnerRow, attributions ?? [], earnings ?? []),
    activeCodes: (codes ?? []).map((c) => c.code),
  };
}

export interface AdminReferralCode {
  id: string;
  referral_partner_id: string;
  code: string;
  is_active: boolean;
  discount_type: string;
  discount_percent: number;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminReferralAttribution {
  id: string;
  business_id: string;
  business_name: string | null;
  referral_code_id: string;
  referred_at: string;
  initial_plan_selected: string | null;
  status: string;
  converted_to_pro_at: string | null;
  gross_amount_cents: number | null;
  discount_amount_cents: number | null;
}

export interface AdminReferralEarning {
  id: string;
  business_id: string;
  business_name: string | null;
  qualifying_payment_reference: string;
  gross_amount_cents: number;
  discount_amount_cents: number;
  commission_amount_cents: number;
  status: string;
  earned_at: string;
  payout_request_id: string | null;
}

export interface AdminReferralPayoutRequest {
  id: string;
  referral_partner_id: string;
  requested_amount_cents: number;
  status: string;
  created_at: string;
  processed_at: string | null;
  admin_note: string | null;
  payment_reference: string | null;
}

export interface AdminReferralPartnerDetail {
  partner: AdminReferralPartner;
  codes: AdminReferralCode[];
  attributions: AdminReferralAttribution[];
  earnings: AdminReferralEarning[];
  payoutRequests: AdminReferralPayoutRequest[];
}

/** Full detail for /admin/referrals/[id] — codes, referral/conversion
 * history, the earnings ledger, and payout requests, each read straight
 * off its own table (no denormalization) with just a business-name join
 * for display. */
export async function getAdminReferralPartnerDetail(id: string): Promise<AdminReferralPartnerDetail | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  const { data: partner } = await supabase
    .from("referral_partners")
    .select("*, business:businesses(name)")
    .eq("id", id)
    .maybeSingle();
  if (!partner) return null;

  const [{ data: codes }, { data: attributionRows }, { data: earningRows }, { data: payoutRows }] = await Promise.all([
    supabase.from("referral_codes").select("*").eq("referral_partner_id", id).order("created_at", { ascending: false }),
    supabase
      .from("referral_attributions")
      .select("*, business:businesses(name)")
      .eq("referral_partner_id", id)
      .order("referred_at", { ascending: false }),
    supabase
      .from("referral_earnings")
      .select("*, business:businesses(name)")
      .eq("referral_partner_id", id)
      .order("earned_at", { ascending: false }),
    supabase
      .from("referral_payout_requests")
      .select("*")
      .eq("referral_partner_id", id)
      .order("created_at", { ascending: false }),
  ]);

  type WithBusiness = { business: { name: string } | { name: string }[] | null };
  const attributions: AdminReferralAttribution[] = ((attributionRows ?? []) as (AdminReferralAttribution & WithBusiness)[]).map(
    (a) => {
      const business = Array.isArray(a.business) ? a.business[0] : a.business;
      return { ...a, business_name: business?.name ?? null };
    }
  );
  const earnings: AdminReferralEarning[] = ((earningRows ?? []) as (AdminReferralEarning & WithBusiness)[]).map((e) => {
    const business = Array.isArray(e.business) ? e.business[0] : e.business;
    return { ...e, business_name: business?.name ?? null };
  });

  return {
    partner: summarizePartner(
      partner as RawPartnerRow,
      attributions.map((a) => ({ status: a.status })),
      earnings.map((e) => ({
        gross_amount_cents: e.gross_amount_cents,
        commission_amount_cents: e.commission_amount_cents,
        status: e.status,
      }))
    ),
    codes: (codes ?? []) as AdminReferralCode[],
    attributions,
    earnings,
    payoutRequests: (payoutRows ?? []) as AdminReferralPayoutRequest[],
  };
}
