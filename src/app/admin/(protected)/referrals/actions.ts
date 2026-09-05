"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";

const LIST_PATH = "/admin/referrals";

function dollarsToCents(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100);
}

// ── Referral Partners ────────────────────────────────────────────────────

/** Creates a referral partner tied to one business. V1: at most one
 * primary partner record per business (unique(business_id) on
 * referral_partners itself is the real guard) — a collision surfaces as
 * a Postgres error, reported back below. */
export async function createReferralPartner(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const businessId = str(formData, "business_id");
  if (!businessId) redirect(errorRedirectUrl(LIST_PATH, "Choose a business."));

  const commissionDollars = num(formData, "default_commission_dollars");
  const commissionCents = dollarsToCents(commissionDollars) ?? 2000;
  if (commissionCents < 0) redirect(errorRedirectUrl(LIST_PATH, "Commission can't be negative."));

  const { data, error } = await supabase
    .from("referral_partners")
    .insert({
      business_id: businessId,
      label: str(formData, "label"),
      is_active: bool(formData, "is_active"),
      default_commission_cents: commissionCents,
      notes: str(formData, "notes"),
    })
    .select("id")
    .single();

  if (error || !data) {
    const message =
      error?.code === "23505" ? "That business already has a referral partner record." : (error?.message ?? "Couldn't create that partner.");
    redirect(errorRedirectUrl(LIST_PATH, message));
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${data.id}?saved=1`);
}

/** Edits an existing partner's label/commission/notes/active state. */
export async function updateReferralPartner(id: string, formData: FormData) {
  const detailPath = `${LIST_PATH}/${id}`;
  const supabase = await requireAdminSupabase();

  const commissionDollars = num(formData, "default_commission_dollars");
  const commissionCents = dollarsToCents(commissionDollars);
  if (commissionCents == null || commissionCents < 0) {
    redirect(errorRedirectUrl(detailPath, "Enter a valid commission amount."));
  }

  const { error } = await supabase
    .from("referral_partners")
    .update({
      label: str(formData, "label"),
      is_active: bool(formData, "is_active"),
      default_commission_cents: commissionCents,
      notes: str(formData, "notes"),
    })
    .eq("id", id);
  if (error) redirect(errorRedirectUrl(detailPath, error.message));

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath);
  redirect(`${detailPath}?saved=1`);
}

// ── Referral Codes ───────────────────────────────────────────────────────

/** Creates a code under an existing partner. discount_percent is
 * admin-chosen — never hard-coded anywhere in code (the STEREOTYPE20/20%
 * example is just data an admin enters here). */
export async function createReferralCode(partnerId: string, formData: FormData) {
  const detailPath = `${LIST_PATH}/${partnerId}`;
  const supabase = await requireAdminSupabase();

  const code = str(formData, "code");
  if (!code) redirect(errorRedirectUrl(detailPath, "A code is required."));

  const discountPercent = num(formData, "discount_percent");
  if (discountPercent == null || discountPercent < 0 || discountPercent > 100) {
    redirect(errorRedirectUrl(detailPath, "Discount percent must be between 0 and 100."));
  }

  const maxUses = num(formData, "max_uses");
  if (maxUses !== null && maxUses <= 0) {
    redirect(errorRedirectUrl(detailPath, "Maximum uses must be a positive number, or left blank for unlimited."));
  }

  const { error } = await supabase.from("referral_codes").insert({
    referral_partner_id: partnerId,
    code,
    discount_percent: discountPercent,
    max_uses: maxUses,
    expires_at: str(formData, "expires_at") ? new Date(str(formData, "expires_at")!).toISOString() : null,
    is_active: bool(formData, "is_active"),
  });

  if (error) {
    const message = error.code === "23505" ? `Code "${code}" is already in use — choose a different code.` : error.message;
    redirect(errorRedirectUrl(detailPath, message));
  }

  revalidatePath(detailPath);
  redirect(`${detailPath}?saved=1`);
}

/** Activate/deactivate a code. Never affects an already-attributed
 * business's locked-in discount at checkout time going forward from
 * this toggle alone changes future checkouts only — see
 * getActiveReferralDiscount()'s own comment. */
export async function setReferralCodeActive(partnerId: string, codeId: string, isActive: boolean) {
  const detailPath = `${LIST_PATH}/${partnerId}`;
  const supabase = await requireAdminSupabase();
  const { error } = await supabase.from("referral_codes").update({ is_active: isActive }).eq("id", codeId);
  if (error) redirect(errorRedirectUrl(detailPath, error.message));
  revalidatePath(detailPath);
}

// ── Payout Requests ──────────────────────────────────────────────────────

/** Marks a requested/approved payout as approved (a lightweight status
 * step before actually paying) — no funds movement. */
export async function approveReferralPayout(partnerId: string, payoutId: string) {
  const detailPath = `${LIST_PATH}/${partnerId}`;
  const supabase = await requireAdminSupabase();
  const { error } = await supabase
    .from("referral_payout_requests")
    .update({ status: "approved" })
    .eq("id", payoutId)
    .eq("status", "requested");
  if (error) redirect(errorRedirectUrl(detailPath, error.message));
  revalidatePath(detailPath);
  redirect(`${detailPath}?saved=1`);
}

/** Rejects or cancels a payout request — either way, releases every
 * earning it bundled back to 'available' (payout_request_id cleared) so
 * the partner can request it again later. Never deletes the earning
 * rows themselves. */
async function releaseReferralPayout(partnerId: string, payoutId: string, status: "rejected" | "cancelled", note: string | null) {
  const detailPath = `${LIST_PATH}/${partnerId}`;
  const supabase = await requireAdminSupabase();

  const { data: updated, error } = await supabase
    .from("referral_payout_requests")
    .update({ status, processed_at: new Date().toISOString(), admin_note: note })
    .eq("id", payoutId)
    .in("status", ["requested", "approved"])
    .select("id")
    .maybeSingle();
  if (error) redirect(errorRedirectUrl(detailPath, error.message));
  // Guards against resetting an already-paid payout's earnings back to
  // 'available' (e.g. a stale page re-submitting reject/cancel after
  // markReferralPayoutPaid already ran) — without this check, the
  // unconditional update below would match on payout_request_id alone
  // and undo a completed payout, making its earnings requestable again.
  if (!updated) redirect(errorRedirectUrl(detailPath, "That payout request is no longer pending."));

  await supabase
    .from("referral_earnings")
    .update({ status: "available", payout_request_id: null })
    .eq("payout_request_id", payoutId);

  revalidatePath(detailPath);
  redirect(`${detailPath}?saved=1`);
}

export async function rejectReferralPayout(partnerId: string, payoutId: string, formData: FormData) {
  await releaseReferralPayout(partnerId, payoutId, "rejected", str(formData, "admin_note"));
}

export async function cancelReferralPayout(partnerId: string, payoutId: string) {
  await releaseReferralPayout(partnerId, payoutId, "cancelled", null);
}

/** Marks a payout as actually paid — a manual record only, no funds
 * movement. Flips every earning it bundled from 'included_in_payout' to
 * 'paid', so the same earning can never be paid out twice (it's no
 * longer 'available' for a future request_referral_payout() call
 * either). */
export async function markReferralPayoutPaid(partnerId: string, payoutId: string, formData: FormData) {
  const detailPath = `${LIST_PATH}/${partnerId}`;
  const supabase = await requireAdminSupabase();

  const paymentReference = str(formData, "payment_reference");
  const adminNote = str(formData, "admin_note");

  const { data: updated, error } = await supabase
    .from("referral_payout_requests")
    .update({
      status: "paid",
      processed_at: new Date().toISOString(),
      payment_reference: paymentReference,
      admin_note: adminNote,
    })
    .eq("id", payoutId)
    .in("status", ["requested", "approved"])
    .select("id")
    .maybeSingle();
  if (error) redirect(errorRedirectUrl(detailPath, error.message));
  if (!updated) redirect(errorRedirectUrl(detailPath, "That payout request is no longer pending."));

  const { error: earningsError } = await supabase
    .from("referral_earnings")
    .update({ status: "paid" })
    .eq("payout_request_id", payoutId);
  if (earningsError) redirect(errorRedirectUrl(detailPath, earningsError.message));

  revalidatePath(detailPath);
  redirect(`${detailPath}?saved=1`);
}

// ── Admin-only attribution correction ────────────────────────────────────

/** The explicit admin-only correction mechanism this pass requires: lets
 * a founder re-point an existing attribution at a different partner/code
 * (e.g. a data-entry mistake at signup) — never reachable from any
 * owner-facing surface. Does NOT touch status/converted_to_pro_at/
 * gross_amount_cents/discount_amount_cents or any existing
 * referral_earnings row — a correction changes who gets credit for
 * FUTURE qualification only; it never rewrites history already paid out
 * or already earned under the previous partner. */
export async function correctReferralAttribution(attributionId: string, formData: FormData) {
  const redirectPath = str(formData, "return_to") || LIST_PATH;
  const supabase = await requireAdminSupabase();

  // Looked up by the CODE itself (case-insensitive, same convention as
  // attribute_referral()'s own upper(code) match) — an admin correcting a
  // mistaken attribution has the code, not an internal referral_code_id,
  // to hand.
  const newCode = str(formData, "code");
  if (!newCode) redirect(errorRedirectUrl(redirectPath, "Enter the correct referral code."));

  const { data: code } = await supabase
    .from("referral_codes")
    .select("id, referral_partner_id")
    .ilike("code", newCode)
    .maybeSingle();
  if (!code) redirect(errorRedirectUrl(redirectPath, "That referral code doesn't exist."));

  const { error } = await supabase
    .from("referral_attributions")
    .update({ referral_partner_id: code.referral_partner_id, referral_code_id: code.id })
    .eq("id", attributionId);
  if (error) redirect(errorRedirectUrl(redirectPath, error.message));

  revalidatePath(redirectPath);
  redirect(`${redirectPath}?saved=1`);
}
