"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireBusinessMember } from "@/lib/permissions";

function appendQuery(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${new URLSearchParams(params).toString()}`;
}

/** Business Manager Inquiries tab — every action here re-derives real
 * membership via requireBusinessMember(businessId) from the caller's own
 * session (never trusts the businessId/inquiryId route params alone),
 * same authorize-then-elevate shape as every other business Server
 * Action in this app. The actual write always goes through the session
 * client (not admin), so inquiries_select_business_member /
 * inquiry_messages_insert_business_member RLS is the real second-layer
 * enforcement, not just this check. */
export async function sendBusinessReply(businessId: string, inquiryId: string, formData: FormData) {
  const tabPath = appendQuery(`/account/business/${businessId}`, { tab: "inquiries", open: inquiryId });
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(tabPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(`/account/business/${businessId}`, { tab: "inquiries", error: message }));
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(appendQuery(tabPath, { error: "Enter a message." }));

  const { error } = await supabase.from("inquiry_messages").insert({
    inquiry_id: inquiryId,
    sender_type: "business",
    sender_user_id: user.id,
    body,
  });
  if (error) redirect(appendQuery(tabPath, { error: error.message }));

  // A first reply moves a brand-new inquiry to "replied" — never
  // downgrades a status the owner has already moved further along
  // (contacted/booked/closed) by replying again later.
  const { data: inquiry } = await supabase.from("inquiries").select("status").eq("id", inquiryId).maybeSingle();
  if ((inquiry as { status: string } | null)?.status === "new") {
    await supabase.rpc("set_inquiry_status", { p_inquiry_id: inquiryId, p_status: "replied" });
  }

  await supabase.rpc("mark_inquiry_read", { p_inquiry_id: inquiryId, p_as: "business" });

  revalidatePath(`/account/business/${businessId}`);
  redirect(tabPath);
}

/** Owner-facing on/off switch for the native inquiry entry points on
 * this business's public Business/Product pages (see
 * business/[slug]/page.tsx and product/[slug]/page.tsx's own
 * `native_inquiries_enabled` gate). Off by default for every business;
 * this is the only write path that ever changes it. */
export async function setNativeInquiriesEnabled(businessId: string, formData: FormData) {
  const tabPath = `/account/business/${businessId}?tab=inquiries`;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(tabPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(tabPath, { error: message }));
  }

  // businesses is admin-write-only (same authorize-then-elevate shape as
  // every other business field update in account/business/actions.ts) —
  // requireBusinessMember() above is the real authorization; this client
  // only performs the write once that's already confirmed.
  const admin = getAdminSupabase();
  if (!admin) redirect(appendQuery(tabPath, { error: "Server isn't configured." }));

  const enabled = formData.get("native_inquiries_enabled") === "on";
  const { error } = await admin.from("businesses").update({ native_inquiries_enabled: enabled }).eq("id", businessId);
  if (error) redirect(appendQuery(tabPath, { error: error.message }));

  revalidatePath(`/account/business/${businessId}`);
  redirect(tabPath);
}

export async function updateInquiryStatus(businessId: string, inquiryId: string, formData: FormData) {
  const tabPath = appendQuery(`/account/business/${businessId}`, { tab: "inquiries", open: inquiryId });
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(tabPath)}`);

  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(`/account/business/${businessId}`, { tab: "inquiries", error: message }));
  }

  const status = String(formData.get("status") ?? "");
  const { error } = await supabase.rpc("set_inquiry_status", { p_inquiry_id: inquiryId, p_status: status });
  if (error) redirect(appendQuery(tabPath, { error: error.message }));

  revalidatePath(`/account/business/${businessId}`);
  redirect(tabPath);
}
