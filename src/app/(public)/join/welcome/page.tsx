import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Welcome to Findmi",
  robots: { index: false },
};
// Session-sensitive — must never be statically or ISR-cached.
export const dynamic = "force-dynamic";

/**
 * Join / Universal Onboarding pass — the concise completion screen, the
 * end of the /join → /join/start → /join/passbook (or Skip) sequence.
 * Real, existing routes only — no invented destinations. The Business
 * path never lands here: /account/business/new has its own real
 * post-create destination (Business Manager / Stripe), so this screen is
 * only reached via the Passbook path or "Skip for now".
 */
export default async function JoinWelcomePage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup?next=%2Fjoin%2Fwelcome");

  return (
    <div className="mx-auto max-w-lg px-6 py-14 sm:py-20 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">You&rsquo;re all set</p>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">Welcome to Findmi.</h1>
      <p className="mx-auto mt-3 max-w-sm text-base text-ink/60">
        Start discovering businesses and events, and build your own Digital Passbook as you go.
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/my-world"
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Start Building Your Passbook
        </Link>
        <Link
          href="/find"
          className="flex h-12 w-full items-center justify-center rounded-2xl border border-black/10 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
        >
          See What&rsquo;s Happening Near You
        </Link>
        <Link href="/account" className="mt-1 text-sm font-semibold text-ink/50 hover:text-ink/70">
          Go to my account
        </Link>
      </div>

      <div className="mt-10 border-t border-black/5 pt-5">
        <p className="text-sm text-ink/50">
          Have a business?{" "}
          <Link href="/account/business/new" className="font-semibold text-ink underline underline-offset-2 hover:text-ink/80">
            Add it anytime
          </Link>
        </p>
      </div>
    </div>
  );
}
