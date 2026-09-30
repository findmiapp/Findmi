import type { Metadata } from "next";
import Link from "next/link";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = {
  title: "Account Already Exists",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const primaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600";
const secondaryButtonClass =
  "flex h-12 w-full items-center justify-center rounded-2xl border border-black/10 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/20";

/**
 * Existing Email Signup UX — Final Correction pass. A deliberate product
 * decision (explicitly given, not inferred): FindMi accepts the
 * account-enumeration tradeoff for THIS ONE outcome of the real,
 * server-side signUp() call — clearer returning-user UX over maximum
 * membership privacy during an attempted signup. This is NOT a public
 * email-existence lookup: it is reached ONLY as the outcome of an actual
 * CREATE ACCOUNT submission through the real Supabase signUp() flow
 * (see signup/actions.ts's `user_already_exists` branch) — there is no
 * endpoint here a visitor can query with an arbitrary email without
 * going through that same real signup attempt, and the only fact ever
 * disclosed is that the submitted email is already registered. No
 * account ID, profile data, name, phone, confirmation timestamp, or any
 * other detail is read or shown.
 *
 * `error.code === "user_already_exists"` is GoTrue's own typed signal
 * for a CONFIRMED existing account specifically (verified against this
 * project's production auth logs in an earlier pass) — an existing but
 * still-UNCONFIRMED account re-submitting signup does not hit this
 * branch at all (GoTrue resends its confirmation email and returns no
 * error), so it still correctly falls through to /signup/check-email,
 * unaffected by this page's existence.
 */
export default async function AccountExistsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = getSafeRedirect(next);

  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-6 sm:py-16">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Account already exists</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">You already have a Findmi account</h1>
      <p className="mt-3 text-sm text-ink/60">
        An account is already registered with this email. Log in to continue, or reset your password if you
        don&rsquo;t remember it.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className={primaryButtonClass}>
          Log In
        </Link>
        <Link href={`/forgot-password?next=${encodeURIComponent(safeNext)}`} className={secondaryButtonClass}>
          Reset Password
        </Link>
      </div>
    </div>
  );
}
