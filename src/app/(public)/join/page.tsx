import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Join / Universal Onboarding pass — this route is now the ONE universal
 * FindMi account-creation entry point (consumer and business both start
 * here), replacing the former business-acquisition/Free-Pro pricing page
 * that used to live at this exact path. That page's full content (CMS
 * sections, Free/Pro pricing, Stripe checkout, invite redemption, sales
 * contact) is fully preserved, byte-for-byte, at its new home:
 * /join/business (src/app/(public)/join/business/page.tsx) — every
 * existing link that specifically meant "the business pricing page" was
 * repointed there as part of this same pass (see that pass's own report).
 *
 * FindMi has ONE universal account — no separate consumer/business/
 * creator accounts (see CLAUDE.md §1/§3 and this pass's own spec). This
 * page is a short, honest explainer, not a forced path choice: it never
 * asks a visitor to pick "consumer" or "business" here — that choice
 * happens once, after account creation, on /join/start. A visitor who
 * already knows they want the business/pricing page can still jump
 * straight there via the quiet link at the bottom.
 *
 * No pricing, no Stripe, no plan language anywhere on this page — see the
 * pass's own explicit "NO PRICING WALL during universal account
 * creation" constraint. /join/business still owns all of that.
 */
export const metadata: Metadata = {
  title: "Join Findmi",
  description: "Discover, save, and remember everywhere you go — all in one Findmi account.",
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  // Pro Invite / Complimentary Access Codes pass — findmi.app/join?invite=CODE
  // is still a real, live invite link shape. Preserved exactly as before:
  // hand off straight to the real redemption flow rather than growing
  // invite-aware UI on this now-consumer-facing page.
  const { invite } = await searchParams;
  if (invite) redirect(`/redeem/${encodeURIComponent(invite)}`);

  return (
    <div className="mx-auto max-w-lg px-6 py-14 sm:py-20">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Join Findmi</p>
      <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
        Your Digital Passbook for everywhere you go.
      </h1>
      <p className="mt-3 text-base text-ink/60">
        Discover businesses, events and places worth knowing about. Save what catches your eye, follow what you
        want to keep up with, and remember where you&rsquo;ve actually been.
      </p>

      <ul className="mt-6 flex flex-col gap-2.5 text-sm text-ink/70">
        <PassbookLine>Discover what&rsquo;s around you</PassbookLine>
        <PassbookLine>Save and follow the businesses and events you love</PassbookLine>
        <PassbookLine>Build your own Digital Passbook of everywhere you&rsquo;ve been</PassbookLine>
      </ul>

      <Link
        href="/signup?next=%2Fjoin%2Fstart"
        className="mt-8 flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        Create free account
      </Link>
      <p className="mt-2 text-center text-xs text-ink/40">Free to start · No credit card required</p>

      <p className="mt-5 text-center text-sm text-ink/50">
        Already have an account?{" "}
        <Link href="/login?next=%2Fjoin%2Fstart" className="font-semibold text-ink hover:underline">
          Log in
        </Link>
      </p>

      <div className="mt-10 border-t border-black/5 pt-5 text-center">
        <Link href="/join/business" className="text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink">
          Have a business or brand? Explore Findmi for Business →
        </Link>
      </div>
    </div>
  );
}

function PassbookLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700">
        <path
          d="M4 10.5l3.5 3.5L16 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}
