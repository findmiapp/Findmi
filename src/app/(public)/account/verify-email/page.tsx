import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { requestEmailVerification, confirmEmailVerification } from "./actions";

export const metadata: Metadata = {
  title: "Verify Your Email",
  robots: { index: false },
};
// Authenticated, per-user content — must never be statically or
// ISR-cached.
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
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
            We&rsquo;ll send a verification code to <span className="font-semibold text-ink">{user.email}</span>.
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
                Send Verification Code
              </button>
            </form>
          ) : (
            <>
              <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
                Verification code sent. Check your inbox and enter the code below.
              </p>
              <form action={confirmEmailVerification} className="mt-4 flex flex-col gap-3">
                <input type="hidden" name="next" value={next} />
                <input
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="6-digit code"
                  className={inputClass}
                />
                <button type="submit" className={primaryButtonClass}>
                  Verify Email
                </button>
              </form>
              <form action={requestEmailVerification} className="mt-3">
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="text-sm font-semibold text-ink/50 transition hover:text-ink">
                  Resend code
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
