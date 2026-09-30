import type { Metadata } from "next";
import Link from "next/link";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { resendConfirmation } from "../actions";

export const metadata: Metadata = {
  title: "Check Your Email",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; resent?: string; error?: string }>;
}) {
  const { next, resent, error } = await searchParams;
  const safeNext = getSafeRedirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50">
        <MailGlyph />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-findmi-700">Almost there</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Check your email</h1>
      {/* Signup/Email Confirmation Hardening pass — this line used to
          unconditionally claim a confirmation email was sent. It wasn't:
          an already-confirmed existing account can also land here (see
          signup/actions.ts's user_already_exists handling), and GoTrue
          genuinely sends nothing in that case (verified against
          production auth logs — no mail.send event for that path).
          Rephrased to never promise a send happened, while never
          revealing account existence either — this exact wording renders
          identically for a brand-new signup and an already-confirmed
          existing account, so it stays enumeration-safe. */}
      <p className="mt-3 text-sm text-ink/60">
        If this address needs to be confirmed, you&rsquo;ll receive an email with a link to finish setting up your
        account.
      </p>

      {resent && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          If that address has an account waiting to be confirmed, a new link is on its way.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-ink">Didn&rsquo;t get it, or the link expired?</p>
        <form action={resendConfirmation} className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input type="hidden" name="next" value={safeNext} />
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            className="flex h-12 shrink-0 items-center justify-center rounded-full border border-black/10 px-5 text-sm font-semibold text-ink transition hover:border-black/20"
          >
            Resend link
          </button>
        </form>
      </div>

      {/* Signup Repair pass — this page is now reached only by a
          genuinely new signup or an existing-but-UNCONFIRMED account
          (GoTrue silently resends its own confirmation email for that
          second case and returns no error at all — see signup/
          actions.ts's own doc comment). An existing CONFIRMED account no
          longer lands here at all: that's the Existing Email Signup UX —
          Final Correction pass's dedicated /signup/account-exists screen
          instead (an explicit, accepted product tradeoff — see that
          page's own doc comment). These two links stay a plain courtesy
          for the two audiences that DO still land here (a new visitor
          who mistyped, or someone still unconfirmed who'd rather just
          log in once confirmed) — not an enumeration mechanism, since
          nothing here varies by outcome.

          Existing Email Signup UX — Final Correction pass — split onto
          two explicit rows (a bare "Already have an account?" line, then
          the two links below it) instead of one wrapping inline
          sentence, which wrapped awkwardly at narrow widths. */}
      <div className="mt-6 text-center text-sm">
        <p className="text-ink/50">Already have an account?</p>
        <p className="mt-1">
          <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className="font-semibold text-ink hover:underline">
            Log in
          </Link>{" "}
          &middot;{" "}
          <Link
            href={`/forgot-password?next=${encodeURIComponent(safeNext)}`}
            className="font-semibold text-ink hover:underline"
          >
            Forgot your password?
          </Link>
        </p>
      </div>
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
