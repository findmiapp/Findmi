import { sendOperationalNotification, type OperationalNotification } from "./send";

// Admin Action Email Notifications V1 — the one guarded entry point
// every admin-alert call site uses, so no Server Action/route handler
// has to hand-roll its own try/catch around email delivery. The primary
// mutation is always expected to have ALREADY succeeded before this is
// called (every call site awaits this only after its own DB write is
// confirmed) — a Resend failure here is caught, logged with context, and
// never rethrown, never rolls back anything, and never changes the
// caller's own redirect/response. Best-effort V1, exactly as audited.
export async function notifyAdmin(notification: Omit<OperationalNotification, "to">): Promise<void> {
  try {
    await sendOperationalNotification(notification);
  } catch (err) {
    console.error(`[notifications] admin notification failed: "${notification.subject}"`, err);
  }
}
