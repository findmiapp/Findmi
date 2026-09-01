"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, str } from "@/lib/admin/form-helpers";

function marketIdsFromForm(formData: FormData): string[] {
  return formData.getAll("market_ids").map(String).filter(Boolean);
}

async function syncMarkets(membershipId: string, marketIds: string[]) {
  const supabase = getAdminSupabase();
  if (!supabase) return;
  await supabase.from("membership_markets").delete().eq("membership_id", membershipId);
  if (marketIds.length > 0) {
    await supabase.from("membership_markets").insert(marketIds.map((market_id) => ({ membership_id: membershipId, market_id })));
  }
}

/** Path A — founder invites a vendor. Creates a comped, pending membership
 * and hands back its detail page, which shows the generated private
 * intake link (lib/tally.ts's getOnboardingFormUrl with source=invited). */
export async function createInviteMembership(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const businessName = str(formData, "intended_business_name");
  const contactName = str(formData, "contact_name");
  const contactEmail = str(formData, "contact_email");
  const planId = str(formData, "plan_id");
  if (!businessName || !contactEmail || !planId) {
    redirect(errorRedirectUrl("/admin/onboarding/new", "Business name, contact email, and plan are required."));
  }

  const { data: plan } = await supabase.from("membership_plans").select("slug").eq("id", planId).maybeSingle();

  const { data: membership, error } = await supabase
    .from("memberships")
    .insert({
      plan_id: planId,
      billing_status: "comped",
      onboarding_status: "not_started",
      publication_status: "draft",
      intended_business_name: businessName,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: str(formData, "contact_phone"),
      existing_business_id: str(formData, "existing_business_id"),
      founding_price_locked: plan?.slug === "founding-500",
      admin_notes: str(formData, "admin_notes"),
    })
    .select("id")
    .single();
  if (error || !membership) {
    redirect(errorRedirectUrl("/admin/onboarding/new", error?.message ?? "Could not create invite."));
  }

  await syncMarkets(membership.id, marketIdsFromForm(formData));

  revalidatePath("/admin/onboarding");
  redirect(`/admin/onboarding/${membership.id}?invited=1`);
}

export async function updateMembership(id: string, formData: FormData) {
  const editPath = `/admin/onboarding/${id}`;
  const supabase = await requireAdminSupabase();

  const planId = str(formData, "plan_id");
  const { data: plan } = planId
    ? await supabase.from("membership_plans").select("slug").eq("id", planId).maybeSingle()
    : { data: null };

  const payload = {
    plan_id: planId,
    contact_name: str(formData, "contact_name"),
    contact_email: str(formData, "contact_email"),
    contact_phone: str(formData, "contact_phone"),
    intended_business_name: str(formData, "intended_business_name"),
    existing_business_id: str(formData, "existing_business_id"),
    billing_status: str(formData, "billing_status") ?? "pending_payment",
    founding_price_locked: plan?.slug === "founding-500" ? true : bool(formData, "founding_price_locked"),
    admin_notes: str(formData, "admin_notes"),
  };

  const { error } = await supabase.from("memberships").update(payload).eq("id", id);
  if (error) redirect(errorRedirectUrl(editPath, error.message));

  await syncMarkets(id, marketIdsFromForm(formData));

  revalidatePath("/admin/onboarding");
  revalidatePath(editPath);
  redirect(`${editPath}?saved=1`);
}

/** APPROVE moves the business live (Part 13/15) — the one gate that makes
 * a profile public, independent of billing status. */
export async function approveMembership(id: string) {
  const supabase = await requireAdminSupabase();

  const { data: membership } = await supabase.from("memberships").select("business_id").eq("id", id).maybeSingle();
  if (!membership?.business_id) {
    redirect(errorRedirectUrl(`/admin/onboarding/${id}`, "Link or create a business before approving."));
  }

  await supabase
    .from("memberships")
    .update({ publication_status: "live", onboarding_status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id);
  await supabase
    .from("businesses")
    .update({ publication_status: "live" })
    .eq("id", membership.business_id);

  revalidatePath("/admin/onboarding");
  revalidatePath(`/admin/onboarding/${id}`);
  revalidatePath("/admin/businesses");
  revalidatePath("/");
  redirect(`/admin/onboarding/${id}?saved=1`);
}

// Not exported itself, but both callers below (rejectMembership,
// pauseMembership) ARE exported Server Actions with no other check of
// their own — the auth check has to live here, the one place both funnel
// through, rather than being duplicated in each thin wrapper.
async function setPublicationStatus(id: string, status: "rejected" | "paused" | "draft") {
  const supabase = await requireAdminSupabase();

  const { data: membership } = await supabase.from("memberships").select("business_id").eq("id", id).maybeSingle();
  await supabase.from("memberships").update({ publication_status: status, updated_at: new Date().toISOString() }).eq("id", id);
  if (membership?.business_id) {
    await supabase.from("businesses").update({ publication_status: status }).eq("id", membership.business_id);
  }

  revalidatePath("/admin/onboarding");
  revalidatePath(`/admin/onboarding/${id}`);
  revalidatePath("/admin/businesses");
  revalidatePath("/");
  redirect(`/admin/onboarding/${id}?saved=1`);
}

export async function rejectMembership(id: string) {
  await setPublicationStatus(id, "rejected");
}

export async function pauseMembership(id: string) {
  await setPublicationStatus(id, "paused");
}

export async function markComped(id: string) {
  const supabase = await requireAdminSupabase();
  await supabase.from("memberships").update({ billing_status: "comped", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/admin/onboarding/${id}`);
  redirect(`/admin/onboarding/${id}?saved=1`);
}
