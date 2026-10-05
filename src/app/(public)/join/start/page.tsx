import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import OnboardingProgress from "@/components/OnboardingProgress";
import ChevronIcon from "@/components/ChevronIcon";

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
 *
 * Signup Repair + Join Card Intent micro-pass — an optional `?intent=`
 * (passbook|business) may ride in on this page's own URL, carried here
 * from one of /join's two value cards via the `next` query string (see
 * that page's own doc comment on the exact mechanism — nothing new reads
 * or writes it beyond this one query param). It only adds a small,
 * non-binding "Suggested for you" badge to the matching card below —
 * convenience, never identity: both cards stay fully clickable/
 * switchable, nothing is preselected in a way that blocks the other
 * choice, "Skip for now" is untouched, and nothing is persisted anywhere
 * (no account_type/role/consumer/business column, no schema change).
 * Any value other than exactly "passbook"/"business" is ignored.
 */
export default async function JoinStartPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { intent: rawIntent } = await searchParams;
  const intent = rawIntent === "passbook" || rawIntent === "business" ? rawIntent : null;

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
          {intent === "passbook" && <SuggestedBadge />}
          <p className="font-display text-lg font-bold tracking-tight text-ink">Build My Digital Passbook</p>
          <p className="mt-1 text-sm text-ink/60">
            Discover businesses and events, save what you love, and keep track of everywhere you go.
          </p>
          <span className="mt-3 flex items-center gap-1 text-sm font-bold text-findmi-700">
            Get Started <ChevronIcon direction="right" className="h-3.5 w-3.5" />
          </span>
        </Link>

        <Link
          href="/account/business/new"
          className="flex flex-col rounded-3xl border border-black/10 bg-white p-5 transition hover:border-black/20"
        >
          {intent === "business" && <SuggestedBadge />}
          <p className="font-display text-lg font-bold tracking-tight text-ink">Add My Business</p>
          <p className="mt-1 text-sm text-ink/60">
            Show customers who you are, what you offer, and where you&rsquo;ll be next.
          </p>
          <span className="mt-3 flex items-center gap-1 text-sm font-bold text-ink/70">
            Get Started <ChevronIcon direction="right" className="h-3.5 w-3.5" />
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

function SuggestedBadge() {
  return (
    <span className="mb-2 inline-flex w-fit items-center rounded-full bg-findmi-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-findmi-700">
      Suggested for you
    </span>
  );
}
