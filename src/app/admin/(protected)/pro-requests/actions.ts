"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { getAccountEmail } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";

const LIST_PATH = "/admin/pro-requests";

/** Decision notification — the requester, resolved through their real
 * authenticated account email (never a free-text field — this table has
 * none), mirroring notifyClaimant() in admin/claims/actions.ts exactly.
 * Re-reads the request row itself after the decision has already
 * committed, rather than threading extra data through the action
 * signatures — same shape as every other notification call site in this
 * codebase. Never includes admin_note — that field is admin-only and is
 * not selected here. */
async function notifyRequester(
  supabase: Awaited<ReturnType<typeof requireAdminSupabase>>,
  requestId: string,
  decision: "approved" | "declined"
): Promise<void> {
  const { data: request } = await supabase
    .from("business_pro_access_requests")
    .select("requested_by_user_id, business:businesses(id, name)")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return;

  const businessRaw = (request as { business: { id: string; name: string } | { id: string; name: string }[] | null }).business;
  const business = Array.isArray(businessRaw) ? businessRaw[0] : businessRaw;
  const businessName = business?.name ?? "your business";
  const email = await getAccountEmail(supabase, (request as { requested_by_user_id: string }).requested_by_user_id);
  if (!email) return;

  if (decision === "approved") {
    await sendProductNotification({
      type: "pro_access_request_approved",
      to: [email],
      subject: `Findmi Pro is enabled for ${businessName}`,
      heading: "Your Pro access request was approved",
      body: [`Great news — Findmi Pro has been enabled for ${businessName}.`],
      actionLabel: `Manage ${businessName}`,
      actionUrl: business ? `/account/business/${business.id}?tab=performance` : "/account",
    });
  } else {
    await sendProductNotification({
      type: "pro_access_request_declined",
      to: [email],
      subject: `Update on your Pro access request — ${businessName}`,
      heading: "Your Pro access request wasn't approved",
      body: [
        `Your request to enable Findmi Pro for ${businessName} wasn't approved this time.`,
        `You can keep using Findmi's free tools, and you're welcome to submit a new request later.`,
      ],
      actionLabel: "View Findmi",
      actionUrl: business ? `/account/business/${business.id}` : "/account",
    });
  }
}

// Matches the short exception messages raised by
// approve_pro_access_request() in the migration.
const FRIENDLY_ERROR: Record<string, string> = {
  request_not_found: "That request no longer exists.",
  request_not_pending: "That request has already been reviewed.",
  business_not_found: "The business on this request no longer exists.",
};

/** Approval is the one entitlement-granting event here, and (like
 * approveClaim) has to be atomic — request-still-pending + grant Pro +
 * mark approved, all together or not at all — done via a single
 * service-role-only Postgres function (see the migration) rather than a
 * multi-write sequence from here. p_plan_expires_at is optional and
 * admin-chosen (blank = permanent grant, same existing convention as
 * BusinessForm's own Plan Expires field) — this action invents no new
 * commercial term/duration. */
export async function approveProAccessRequest(requestId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();

  const expiresAtInput = str(formData, "plan_expires_at");
  const planExpiresAt = expiresAtInput ? new Date(expiresAtInput).toISOString() : null;
  const adminNote = str(formData, "admin_note");

  const { error } = await supabase.rpc("approve_pro_access_request", {
    p_request_id: requestId,
    p_plan_expires_at: planExpiresAt,
    p_admin_note: adminNote,
  });

  if (error) {
    const message = FRIENDLY_ERROR[error.message] ?? "Couldn't approve this request.";
    redirect(errorRedirectUrl(LIST_PATH, message));
  }

  await notifyRequester(supabase, requestId, "approved");

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?approved=1`);
}

/** Decline never touches businesses/plan_tier, so (like rejectClaim) it's
 * already atomic as a single guarded UPDATE — no RPC needed. */
export async function declineProAccessRequest(requestId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const adminNote = str(formData, "admin_note");

  const { data, error } = await supabase
    .from("business_pro_access_requests")
    .update({ status: "declined", reviewed_at: new Date().toISOString(), admin_note: adminNote })
    .eq("id", requestId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl(LIST_PATH, "Couldn't decline — the request may have already been reviewed."));
  }

  await notifyRequester(supabase, requestId, "declined");

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?declined=1`);
}
