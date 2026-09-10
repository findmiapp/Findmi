import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { requestEmailVerification } from "./actions";

export const metadata: Metadata = {
  title: "Verify Your Email",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached.
export const dynamic = "force-dynamic";

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

/**
 * Progressive Email Verification pass — a small, dedicated verification
 * screen reachable from the Account Hub's non-blocking reminder. This is
 * always OPTIONAL to visit: nothing in the app redirects a visitor here
 * automatically (see this pass's own "do not block Account Hub, do not
 * redirect them automatically" instruction) — it's only reached by an
 * explicit "Verify Email" click, or by the claim-submission gate handing
 * `next` back to wherever the visitor was trying to claim.
 *
 * Callback/Link Fix — this is now a pure link-based flow end to end,
 * matching what Supabase actually sends for signInWithOtp() (confirmed
 * live: auth_logs shows mail_type "magic_link", never a bare code — see
 * actions.ts's own doc comment for the full root-cause trace). Sending
 * the link and completing it are two different requests, so there is no
 * "just clicked it" state to render here — after a real click,
 * /auth/callback establishes the session, syncs
 * profiles.email_verified_at, and redirects straight to `next`, bypassing
 * this page entirely on success. A failed/expired click comes back HERE
 * with `error` set (see /auth/callback's own emailVerificationFailUrl).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  const { next: nextParam, sent, error } = await searchParams;
  const next = getSafeRedirect(nextParam);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  // Progressive Email Verification Correctness pass — the unconditional
  // page-load self-heal that used to live here (calling
  // syncEmailVerifiedAt(user) on every visit) has been REMOVED. With
  // Supabase's Confirm Email setting intentionally OFF, auth.users.
  // email_confirmed_at gets populated automatically at signup — it is
  // NOT proof the visitor ever clicked a Findmi verification link. That
  // self-heal could therefore mark someone verified merely because they
  // loaded this page while signed in. profiles.email_verified_at is now
  // set ONLY from the callback side (/auth/callback), after a real
  // magic-link exchange succeeds — see this pass's own report for the
  // full call-site list. This page only ever READS the current value
  // below; it never writes it.
  //
  // Deliberately not part of the shared Profile type (lib/types.ts) —
  // that interface also backs the PUBLIC profile view once a username is
  // set, and its own comment is explicit: never add auth-adjacent
  // metadata to it. This is a private, account-scoped read only.
  const { data: profile } = await supabase
    .from("profiles")
    .select("email_verified_at")
    .eq("id", user.id)
    .maybeSingle<{ email_verified_at: string | null }>();
  const alreadyVerified = Boolean(profile?.email_verified_at);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50">
        <MailGlyph />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-findmi-700">Account security</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Verify your email</h1>

      {alreadyVerified ? (
        <>
          <p className="mt-3 text-sm text-ink/60">
            {user.email} is verified. You&rsquo;re all set for ownership actions like claiming a listing.
          </p>
          <Link href={next} className={`mt-6 ${primaryButtonClass}`}>
            Continue
          </Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink/60">
            We&rsquo;ll send a verification link to <span className="font-semibold text-ink">{user.email}</span>.
            Verification is required for certain ownership actions, like claiming an existing listing — it&rsquo;s
            never required to keep building your Findmi profile.
          </p>

          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}

          {!sent ? (
            <form action={requestEmailVerification} className="mt-6">
              <input type="hidden" name="next" value={next} />
              <button type="submit" className={primaryButtonClass}>
                Send Verification Email
              </button>
            </form>
          ) : (
            <>
              <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
                Verification link sent. Open that email on this device and tap the link to verify your account —
                you&rsquo;ll be brought right back here, signed in.
              </p>
              <form action={requestEmailVerification} className="mt-3">
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="text-sm font-semibold text-ink/50 transition hover:text-ink">
                  Resend email
                </button>
              </form>
            </>
          )}

          <Link href={next} className="mt-6 block text-center text-sm font-semibold text-ink/50 transition hover:text-ink">
            Do this later
          </Link>
        </>
      )}
    </div>
  );
}

function MailGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 text-findmi-700">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 5.5l7 5.5 7-5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
