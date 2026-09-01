import type { Metadata } from "next";
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
    <div className="mx-auto max-w-md px-6 py-14">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Almost there</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Check your email</h1>
      <p className="mt-3 text-sm text-ink/60">
        We sent a confirmation link to the address you signed up with. Click it on{" "}
        <span className="font-semibold text-ink">this same browser/device</span> to finish creating your account —
        a link opened somewhere else won&rsquo;t work.
      </p>

      {resent && !error && (
        <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          If that address has an account waiting to be confirmed, a new link is on its way.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-8 rounded-2xl border border-black/10 p-4">
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
            className="shrink-0 rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-black/20"
          >
            Resend link
          </button>
        </form>
      </div>
    </div>
  );
}
