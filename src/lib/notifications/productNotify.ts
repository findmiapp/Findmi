import { sendOperationalNotification, type OperationalNotification } from "./send";

/** Resend Transactional Notification System pass — the one guarded entry
 * point every USER-facing product notification (claim decisions, review
 * decisions, invitations, applications, messages, inquiries, Marketplace
 * decisions — see this pass's own notification matrix) goes through.
 * Mirrors notifyAdmin()'s (./adminNotify) exact best-effort contract:
 * the caller's own primary database action is ALWAYS assumed already-
 * committed before this is called — a Resend failure here is caught,
 * logged with safe (non-content) context, and NEVER rethrown, never
 * rolls back anything, never changes the caller's own redirect/response
 * (see this pass's own Core Architectural Rule — the product action is
 * authoritative, email is a side effect).
 *
 * `to` is required and never falls back to the admin recipient list
 * (unlike sendOperationalNotification's own default) — a caller with no
 * resolved recipients (e.g. an entity with zero managers left after
 * excluding the acting user) should pass an empty array and get a clean,
 * logged no-op, never accidentally page the founder instead. `type` is a
 * short machine-readable category (e.g. "claim_approved",
 * "message_new") logged for observability only — never user-facing,
 * never message/inquiry content. */
export interface ProductNotification extends Omit<OperationalNotification, "footerLabel" | "footerNote"> {
  to: string[];
  type: string;
}

export async function sendProductNotification(notification: ProductNotification): Promise<void> {
  const { type, to, ...rest } = notification;
  if (to.length === 0) {
    console.log("[notifications] product notification skipped — no resolved recipients", { type, subject: rest.subject });
    return;
  }
  try {
    await sendOperationalNotification({
      ...rest,
      to,
      footerLabel: "Findmi Notification",
      footerNote: "Sent automatically because of activity related to your Findmi account.",
    });
  } catch (err) {
    console.error("[notifications] product notification failed", {
      type,
      subject: rest.subject,
      recipientCount: to.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
