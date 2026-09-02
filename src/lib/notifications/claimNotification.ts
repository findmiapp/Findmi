import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicOrigin } from "@/lib/site-url";

/** Founder notification for a newly-PAID claim — called once, right after
 * the payment webhook records payment_status='paid' (never before; a
 * claim is never "worth notifying about" until real money has actually
 * been verified). Deliberately best-effort: the caller wraps this in its
 * own try/catch so a notification failure can never roll back or hide an
 * already-successful payment record.
 *
 * NO TRANSACTIONAL EMAIL PROVIDER EXISTS IN THIS PROJECT (checked:
 * package.json, every route/lib file, .env.example — no Resend/SendGrid/
 * Postmark/Nodemailer/SES/SMTP reference anywhere). Per this pass's
 * explicit instruction not to arbitrarily add one, this function builds
 * the exact subject/body content and logs it server-side (so a payment
 * is never silently invisible to the founder even before a provider is
 * wired up) instead of actually sending anything. See the claim payment
 * pass's report for the recommended smallest integration
 * (Resend — one `resend` package, one RESEND_API_KEY, no SMTP config) —
 * swapping the console.log below for a real send call is the entire
 * remaining integration once that's approved. */
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
  const destination = process.env.CLAIM_NOTIFICATION_EMAIL?.trim();
  if (!destination) {
    console.warn("[claim-notification] CLAIM_NOTIFICATION_EMAIL is unset — skipping founder notification.");
    return;
  }

  const { supabase, claimType, claimId, entityTable, entityId, fullName, email, phone, submittedAt } = params;

  const { data: entity } = await supabase.from(entityTable).select("name").eq("id", entityId).maybeSingle();
  const entityName = (entity as { name: string } | null)?.name ?? "Unknown";

  const subject = `New Paid FindMi Claim — ${entityName}`;
  const body = [
    `${claimType === "business" ? "Business" : "Event"}: ${entityName}`,
    `Claimant: ${fullName || "—"}`,
    `Email: ${email || "—"}`,
    `Phone: ${phone || "—"}`,
    `Amount paid: $20.00`,
    `Submitted: ${submittedAt}`,
    // No evidence-upload feature exists yet — message is a separate,
    // optional claim field and is never treated as evidence. Always "No"
    // until a real evidence-upload feature is built.
    `Evidence attached: No`,
    `Review: ${getPublicOrigin()}/admin/claims`,
  ].join("\n");

  // TODO(approval pending): replace this log with a real send once a
  // provider is approved — see this function's doc comment.
  console.log(`[claim-notification] EMAIL NOT SENT (no provider configured) — to: ${destination}`);
  console.log(`[claim-notification] Subject: ${subject}`);
  console.log(`[claim-notification] Body:\n${body}`);
  console.log(`[claim-notification] claim_id: ${claimId}`);
}
