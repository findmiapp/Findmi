import { runEmailTest } from "./actions";

// TEMPORARY, ISOLATED diagnostic page — Production Admin Email pipeline
// diagnosis pass. Protected by the existing /admin middleware gate (this
// route lives under the same admin/(protected) route group every other
// founder-only admin page uses) plus requireAdminSupabase() inside the
// action itself (defense-in-depth, same as every other privileged
// Server Action in this codebase). Not linked from any admin nav — reach
// it by typing /admin/email-test directly while signed in to /admin.
// Delete this file + ./actions.ts once the diagnosis is done.
export const dynamic = "force-dynamic";

export default async function EmailTestPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    resendId?: string;
    skipped?: string;
    errorName?: string;
    errorStatus?: string;
    errorMessage?: string;
  }>;
}) {
  const { success, resendId, skipped, errorName, errorStatus, errorMessage } = await searchParams;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Email Pipeline Test</h1>
      <p className="mt-1 text-sm text-ink/60">
        Sends exactly one real email directly through Resend, using the exact same RESEND_API_KEY,
        ADMIN_NOTIFICATION_FROM, and ADMIN_NOTIFICATION_EMAILS this environment is configured with — bypassing
        every notification trigger (Area Picker, Market Requests, business/event/product notifications) entirely.
        This isolates whether Vercel Production → Resend is working at all.
      </p>

      <form action={runEmailTest} className="mt-5">
        <button
          type="submit"
          className="rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Send Test Email
        </button>
      </form>

      {skipped && (
        <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-bold uppercase tracking-wide text-xs">Skipped — not sent</p>
          <p className="mt-1">{skipped}</p>
        </div>
      )}

      {success === "1" && (
        <div className="mt-5 rounded-2xl border border-findmi/30 bg-findmi-50 p-4 text-sm text-findmi-700">
          <p className="font-bold uppercase tracking-wide text-xs">Success</p>
          <p className="mt-1">
            Resend accepted the send. Resend email id: <span className="font-mono">{resendId || "(none returned)"}</span>
          </p>
          <p className="mt-2 text-ink/60">
            Resend configuration is good. If real notification emails still aren&rsquo;t arriving, the bug is in
            Findmi&rsquo;s own notification trigger/runtime path, not Resend/env configuration.
          </p>
        </div>
      )}

      {success === "0" && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-bold uppercase tracking-wide text-xs">Failure — Resend rejected the send</p>
          <p className="mt-1">Name: {errorName || "(none)"}</p>
          <p>Status: {errorStatus || "(none)"}</p>
          <p>Message: {errorMessage || "(none)"}</p>
        </div>
      )}
    </div>
  );
}
