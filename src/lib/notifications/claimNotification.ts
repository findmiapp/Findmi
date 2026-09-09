import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyAdmin } from "./adminNotify";

/** Admin notification for a newly-PAID claim — called once, right after
 * the payment webhook records payment_status='paid' (never before; a
 * claim is never "worth notifying about" until real money has actually
 * been verified). The caller (src/app/api/webhooks/tally/route.ts) only
 * reaches this after its own compare-and-swap UPDATE
 * (.eq("payment_status", "unpaid")) actually matched a row — that's the
 * real idempotency guard against Tally's own webhook redelivery; this
 * function itself has no dedup logic of its own and doesn't need any,
 * since it's simply never called a second time for the same payment.
 * Deliberately best-effort via notifyAdmin(): a notification failure can
 * never roll back or hide an already-successful payment record.
 *
 * Admin Action Email Notifications V1 — previously logged the intended
 * email content server-side because no provider existed; now sends for
 * real through the shared generic sender (see src/lib/notifications/
 * send.ts), addressed to ADMIN_NOTIFICATION_EMAILS. */
export async function notifyFounderOfPaidClaim(params: {
  supabase: SupabaseClient;
  claimType: "business" | "event";
  claimId: string;
  entityTable: "businesses" | "events";
  entityId: string;
  fullName: string;
  email: string;
  phone: string;
  submittedAt: string;
}): Promise<void> {
  const { supabase, claimType, claimId, entityTable, entityId, fullName, email, phone, submittedAt } = params;

  const { data: entity } = await supabase.from(entityTable).select("name").eq("id", entityId).maybeSingle();
  const entityName = (entity as { name: string } | null)?.name ?? "Unknown";

  await notifyAdmin({
    subject: `New Paid Findmi Claim — ${entityName}`,
    heading: "New paid Findmi claim",
    body: [
      `${claimType === "business" ? "Business" : "Event"}: ${entityName}`,
      `Claimant: ${fullName || "—"}`,
      `Email: ${email || "—"}`,
      `Phone: ${phone || "—"}`,
      `Amount paid: $20.00`,
      `Submitted: ${submittedAt}`,
      `claim_id: ${claimId}`,
    ],
    actionLabel: "Review Claims",
    actionUrl: "/admin/claims",
  });
}
