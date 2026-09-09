"use server";

// TEMPORARY, ISOLATED diagnostic — Production Admin Email pipeline
// diagnosis pass. Tests ONLY: Vercel Production env vars -> Resend API ->
// ADMIN_NOTIFICATION_FROM -> ADMIN_NOTIFICATION_EMAILS, bypassing every
// real trigger (Area Picker, market_requests, Supabase triggers,
// business/event/product notifications) entirely. Deliberately does NOT
// import from src/lib/notifications/send.ts's own send/render pipeline —
// this reuses only the two existing, unchanged config primitives
// (getResendClient, getAdminRecipients) so a bug in send.ts's own
// composition/error-handling logic can never mask or distort this
// pipeline-only result. Delete this whole email-test/ directory once the
// diagnosis is done — it has no other purpose and nothing else references
// it.
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getResendClient } from "@/lib/notifications/resend";
import { getAdminRecipients } from "@/lib/notifications/send";

export async function runEmailTest() {
  // Admin-only gate — same check every other privileged Server Action in
  // this codebase uses (throws before any work happens if the caller
  // isn't a verified admin session); this page also lives under the
  // middleware-gated /admin/(protected) route group, so this is
  // defense-in-depth, not the only gate.
  await requireAdminSupabase();

  const params = new URLSearchParams();

  const to = getAdminRecipients();
  if (to.length === 0) {
    params.set("skipped", "ADMIN_NOTIFICATION_EMAILS is not configured.");
    redirect(`/admin/email-test?${params.toString()}`);
  }

  const resend = getResendClient();
  if (!resend) {
    params.set("skipped", "RESEND_API_KEY is not configured.");
    redirect(`/admin/email-test?${params.toString()}`);
  }

  // Same fallback the real sender uses (src/lib/notifications/send.ts) —
  // duplicated here as a single literal rather than importing/modifying
  // that file, so this diagnostic stays fully self-contained and
  // removable without touching production notification code at all.
  const from = process.env.ADMIN_NOTIFICATION_FROM?.trim() || "Findmi <notifications@findmi.app>";

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: "Findmi email system test",
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;">
  <h1 style="margin:0 0 16px;font-size:19px;font-weight:700;color:#111111;">Findmi email is working</h1>
  <p style="margin:0;color:#333333;font-size:14px;line-height:1.6;">This is a production test of Findmi admin notifications.</p>
</div>`,
    text: "Findmi email is working\n\nThis is a production test of Findmi admin notifications.",
  });

  if (error) {
    params.set("success", "0");
    params.set("errorName", error.name ?? "");
    params.set("errorStatus", String(error.statusCode ?? ""));
    params.set("errorMessage", error.message ?? "");
  } else {
    params.set("success", "1");
    params.set("resendId", data?.id ?? "");
  }

  redirect(`/admin/email-test?${params.toString()}`);
}
