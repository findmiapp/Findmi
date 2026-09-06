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

  let membership;
  try {
    membership = await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(`/account/business/${businessId}`, { tab: "inquiries", error: message }));
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(appendQuery(tabPath, { error: "Enter a message." }));

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (membership.viaAdmin) {
    // Admin Manage-As V1 — no real business_members row backs this
    // session, so the RLS policy the real-member path below relies on
    // (inquiry_messages_insert_business_member, which requires
    // sender_user_id = auth.uid() AND a matching business_members row)
    // can never be satisfied here. This is a genuinely entity-scoped
    // action (replying AS the business — the customer only ever sees the
    // business's name, never this column, per this table's own schema
    // comment), so it's elevated via the service-role client instead of
    // being blocked outright. sender_user_id records the admin's OWN real
    // Supabase user id when they happen to have a personal session
    // (an honest, non-fabricated actor), or null when they don't — never
    // the owner's id, which would misattribute the reply as the owner's
    // own action.
    const admin = getAdminSupabase();
    if (!admin) redirect(appendQuery(tabPath, { error: "Server isn't configured." }));

    const { error } = await admin.from("inquiry_messages").insert({
      inquiry_id: inquiryId,
      sender_type: "business",
      sender_user_id: user?.id ?? null,
      body,
    });
    if (error) redirect(appendQuery(tabPath, { error: error.message }));

    // set_inquiry_status()/mark_inquiry_read() are SECURITY DEFINER RPCs
    // that hard-require a real business_members row matched to auth.uid()
    // INSIDE their own function body (see the native-inquiries migration)
    // — there is no admin-safe way to satisfy that check without a schema
    // change, which is out of scope for this pass. Both only ever touch
    // plain, non-identity columns (status, business_last_read_at), so
    // their exact effect is mirrored here directly through the
    // service-role client instead of calling them.
    const { data: inquiry } = await admin.from("inquiries").select("status").eq("id", inquiryId).maybeSingle();
    if ((inquiry as { status: string } | null)?.status === "new") {
      await admin.from("inquiries").update({ status: "replied" }).eq("id", inquiryId).eq("business_id", businessId);
    }
    await admin
      .from("inquiries")
      .update({ business_last_read_at: new Date().toISOString() })
      .eq("id", inquiryId)
      .eq("business_id", businessId);
  } else {
    const { error } = await supabase.from("inquiry_messages").insert({
      inquiry_id: inquiryId,
      sender_type: "business",
      sender_user_id: user!.id,
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
  }

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

  // Admin Manage-As V1 — no premature personal-session check; the write
  // below already goes through the service-role client and touches no
  // identity column, so requireBusinessMember() alone is sufficient
  // authorization for both a real member and an admin-elevated session.
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

const INQUIRY_STATUSES = ["new", "replied", "contacted", "booked", "closed"] as const;

export async function updateInquiryStatus(businessId: string, inquiryId: string, formData: FormData) {
  const tabPath = appendQuery(`/account/business/${businessId}`, { tab: "inquiries", open: inquiryId });

  let membership;
  try {
    membership = await requireBusinessMember(businessId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "You don't have access to this business.";
    redirect(appendQuery(`/account/business/${businessId}`, { tab: "inquiries", error: message }));
  }

  const status = String(formData.get("status") ?? "");
  if (!(INQUIRY_STATUSES as readonly string[]).includes(status)) {
    redirect(appendQuery(tabPath, { error: "Invalid status." }));
  }

  if (membership.viaAdmin) {
    // Admin Manage-As V1 — set_inquiry_status() is a SECURITY DEFINER RPC
    // that hard-requires a real business_members row matched to auth.uid()
    // inside its own body (see the native-inquiries migration); there is
    // no admin-safe way to satisfy that without a schema change, which is
    // out of scope for this pass. It only ever touches the plain `status`
    // column (validated above against the exact same allowed values that
    // RPC enforces), so that one column write is mirrored directly through
    // the service-role client instead of calling the RPC.
    const admin = getAdminSupabase();
    if (!admin) redirect(appendQuery(tabPath, { error: "Server isn't configured." }));
    const { error } = await admin.from("inquiries").update({ status }).eq("id", inquiryId).eq("business_id", businessId);
    if (error) redirect(appendQuery(tabPath, { error: error.message }));
  } else {
    const supabase = await getServerSupabase();
    const { error } = await supabase.rpc("set_inquiry_status", { p_inquiry_id: inquiryId, p_status: status });
    if (error) redirect(appendQuery(tabPath, { error: error.message }));
  }

  revalidatePath(`/account/business/${businessId}`);
  redirect(tabPath);
}
