import type { Metadata } from "next";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { resendConfirmation } from "../actions";

export const metadata: Metadata = {
  title: "Confirmation Link Issue",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";
const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";

// Reached only from /auth/callback when a signup confirmation code
// couldn't be exchanged for a session — missing/expired/already-used
// code, or (until the Supabase "Confirm signup" email template is
// switched to a token_hash link — see the Signup + Email Confirmation UX
// Correction pass's own report) a link opened on a different browser/
// device than the one that started signup, since exchangeCodeForSession
// is PKCE-bound to that browser's own code-verifier cookie. Deliberately
// its own page rather than falling through to /login, so the actual
// cause (a confirmation problem, not a wrong password) is clear.
export default async function ConfirmFailedPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = getSafeRedirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-red-600">Link didn&rsquo;t work</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
        That confirmation link expired
      </h1>
      <p className="mt-3 text-sm text-ink/60">
        This can happen if the link was already used or has expired. Enter your email below and we&rsquo;ll send a
        fresh one.
      </p>

      <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6">
        <form action={resendConfirmation} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={safeNext} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">Email</span>
            <input type="email" name="email" required placeholder="you@example.com" className={inputClass} />
          </label>
          <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
            Send a new link
          </button>
        </form>
      </div>
    </div>
  );
}
