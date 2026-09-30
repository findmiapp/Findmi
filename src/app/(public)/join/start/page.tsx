import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import OnboardingProgress from "@/components/OnboardingProgress";

export const metadata: Metadata = {
  title: "How would you like to start?",
  robots: { index: false },
};
// Session-sensitive — must never be statically or ISR-cached.
export const dynamic = "force-dynamic";

const STEPS = ["Account", "Personalize", "Done"];

/**
 * Join / Universal Onboarding pass — "HOW WOULD YOU LIKE TO START?". This
 * choice is deliberately NOT a permanent account type: FindMi has one
 * universal account (see CLAUDE.md §1/§3), and a Passbook-path visitor can
 * add a business later from /account (and vice versa) — this page only
 * decides what the NEXT screen shows, nothing is written to the database
 * here.
 *
 * Not gated by middleware (only /admin and /account are — see
 * middleware.ts), so this checks auth the same manual way
 * account/business/new/page.tsx already does. Reached only right after
 * /signup?next=/join/start or /login?next=/join/start; a visitor who
 * somehow lands here signed out is bounced back through the same real
 * auth pages, never a fake client-only session.
 */
export default async function JoinStartPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signup?next=%2Fjoin%2Fstart");

  return (
    <div className="mx-auto max-w-lg px-6 py-12 sm:py-16">
      <OnboardingProgress step={1} total={3} labels={STEPS} />

      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        How would you like to start?
      </h1>
      <p className="mt-2 text-sm text-ink/60">You can always do both later from your account.</p>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href="/join/passbook"
          className="flex flex-col rounded-3xl border border-findmi/40 bg-white p-5 shadow-[0_4px_20px_rgba(20,176,188,0.10)] transition hover:border-findmi/60"
        >
          <p className="font-display text-lg font-bold tracking-tight text-ink">Build my Digital Passbook</p>
          <p className="mt-1 text-sm text-ink/60">
            Discover businesses and events, save what you love, and keep track of everywhere you go.
          </p>
          <span className="mt-3 flex items-center gap-1 text-sm font-bold text-findmi-700">
            Get started <span aria-hidden>→</span>
          </span>
        </Link>

        <Link
          href="/account/business/new"
          className="flex flex-col rounded-3xl border border-black/10 bg-white p-5 transition hover:border-black/20"
        >
          <p className="font-display text-lg font-bold tracking-tight text-ink">Add my business</p>
          <p className="mt-1 text-sm text-ink/60">
            Show customers who you are, what you offer, and where you&rsquo;ll be next.
          </p>
          <span className="mt-3 flex items-center gap-1 text-sm font-bold text-ink/70">
            Get started <span aria-hidden>→</span>
          </span>
        </Link>
      </div>

      <div className="mt-6 text-center">
        <Link href="/join/welcome" className="text-sm font-semibold text-ink/45 hover:text-ink/70">
          Skip for now
        </Link>
      </div>
    </div>
  );
}
