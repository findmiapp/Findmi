import { getPublicOrigin } from "@/lib/site-url";
import { getResendClient } from "./resend";

// Admin Action Email Notifications V1 — the one generic transactional
// send function every operational notification (admin today, a real
// user's own email later — organizer invites, claim decisions, etc.)
// goes through. Deliberately NOT named/shaped around claims or "founder"
// — `to` is just a list of addresses; who those addresses belong to is
// entirely the caller's business. Resend is the only provider this talks
// to, isolated in ./resend so swapping providers later never touches
// call sites.
export interface OperationalNotification {
  /** Explicit recipient(s). Omitted/empty falls back to the configured
   * admin recipient list (see getAdminRecipients) — the only case V1
   * actually uses, but a future user-facing notification passes its own
   * real recipient here instead. */
  to?: string[];
  subject: string;
  /** Bold headline inside the email body — usually close to (not
   * necessarily identical to) the subject line. */
  heading: string;
  /** Plain lines of detail/context, rendered as separate short
   * paragraphs — never raw HTML from a caller. */
  body: string[];
  /** CTA button label, e.g. "Review Business". Only rendered when
   * actionUrl is also present. */
  actionLabel?: string;
  /** Site-relative path (e.g. "/admin/businesses/123") — resolved
   * against the app's real public origin via getPublicOrigin(), the
   * same helper Stripe Checkout already relies on for absolute URLs.
   * Never expected to be a full URL already. */
  actionUrl?: string;
}

/** Centralized parsing for the one V1 recipient source — comma-separated
 * ADMIN_NOTIFICATION_EMAILS, trimmed, empties dropped. The only place
 * this env var is read. */
export function getAdminRecipients(): string[] {
  return (process.env.ADMIN_NOTIFICATION_EMAILS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function resolveActionUrl(actionUrl?: string): string | undefined {
  if (!actionUrl) return undefined;
  return `${getPublicOrigin()}${actionUrl.startsWith("/") ? "" : "/"}${actionUrl}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Restrained, single-column HTML — no template framework, just one
// small render function. Findmi Aqua (#14B0BC) used scarcely (eyebrow +
// CTA button only), matching the brand's own "used scarcely and
// intentionally" rule.
function renderHtml(n: OperationalNotification, resolvedUrl?: string): string {
  const paragraphs = n.body
    .map((line) => `<p style="margin:0 0 10px;color:#333333;font-size:14px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("");
  const cta =
    resolvedUrl && n.actionLabel
      ? `<p style="margin:24px 0 0;"><a href="${resolvedUrl}" style="display:inline-block;background:#14B0BC;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.03em;text-transform:uppercase;padding:12px 22px;border-radius:999px;">${escapeHtml(n.actionLabel)} →</a></p>`
      : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;">
  <p style="margin:0 0 18px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#14B0BC;">Findmi</p>
  <h1 style="margin:0 0 16px;font-size:19px;font-weight:700;color:#111111;">${escapeHtml(n.heading)}</h1>
  ${paragraphs}
  ${cta}
</div>`;
}

function renderText(n: OperationalNotification, resolvedUrl?: string): string {
  const lines = [n.heading, "", ...n.body];
  if (resolvedUrl && n.actionLabel) lines.push("", `${n.actionLabel}: ${resolvedUrl}`);
  return lines.join("\n");
}

/** Sends one operational email via Resend. Resolves recipients (explicit
 * `to`, or the admin list when omitted), skips safely with a console
 * warning when unconfigured (no RESEND_API_KEY, or no recipients to send
 * to) rather than throwing — callers that need guaranteed non-throwing
 * behavior regardless of Resend API errors should go through
 * notifyAdmin() (./adminNotify) instead of calling this directly. */
export async function sendOperationalNotification(n: OperationalNotification): Promise<void> {
  const to = n.to && n.to.length > 0 ? n.to : getAdminRecipients();
  if (to.length === 0) {
    console.warn(`[notifications] no recipients configured — skipping "${n.subject}"`);
    return;
  }

  const resend = getResendClient();
  if (!resend) {
    console.warn(`[notifications] RESEND_API_KEY not set — skipping "${n.subject}"`);
    return;
  }

  const from = process.env.ADMIN_NOTIFICATION_FROM?.trim() || "Findmi <notifications@findmi.app>";
  const resolvedUrl = resolveActionUrl(n.actionUrl);

  await resend.emails.send({
    from,
    to,
    subject: n.subject,
    html: renderHtml(n, resolvedUrl),
    text: renderText(n, resolvedUrl),
  });
}
