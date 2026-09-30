import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import NavIcon from "@/components/NavIcon";

/**
 * Join / Universal Onboarding pass — this route is the ONE universal
 * FindMi account-creation entry point (consumer and business both start
 * here), replacing the former business-acquisition/Free-Pro pricing page
 * that used to live at this exact path. That page's full content is
 * preserved, byte-for-byte, at its new home: /join/business (see that
 * pass's own report for the full list of relocated references).
 *
 * /Join Visual Convergence pass — this is a presentation-only correction
 * on top of that approved architecture (commit 63c4476), not another
 * onboarding-architecture pass. Live QA found the previous version of
 * this page read as a marketing landing page (giant headline, long
 * paragraph, three checkmark rows, business treated as a footer link).
 * Rebuilt around one question — "why create a FindMi account?" — as a
 * compact entry screen: a short title/subhead, two value cards
 * (Passbook, Business — see the Signup Repair + Join Card Intent
 * micro-pass note below for what tapping one now does), and the Create
 * Free Account CTA. The focused
 * onboarding header (logo + back, no search/bag/create/hamburger) is
 * handled by SiteChrome swapping in OnboardingHeader for this exact
 * route — see that component's own comment; MobileHeader/NavDesktop/
 * HamburgerMenu themselves are untouched.
 *
 * Signup Repair + Join Card Intent micro-pass — live QA found these two
 * cards LOOKED tappable but did nothing. They're now full Links, but
 * still never create a business or classify the account: each just
 * carries a non-binding, temporary `intent` through the exact same real
 * signup flow the neutral "Create free account" button already uses.
 * Encoded as the onboarding destination itself
 * (`next=/join/start?intent=passbook`, not a second query param on
 * /signup) — getSafeRedirect() already reconstructs a `next` value's own
 * pathname+search+hash verbatim (see its own implementation), so this
 * needs no change to it, to /auth/callback, or to signup/actions.ts's
 * `next` handling: intent just rides inside the one value that already
 * flows untouched through signup -> email verification -> /auth/callback
 * -> the final redirect. /join/start reads `intent` as an ordinary query
 * param on its OWN real URL once the visitor actually lands there — no
 * invented nested-redirect parsing. No account_type/role/consumer/
 * business flag is ever written anywhere.
 */
export const metadata: Metadata = {
  title: "Join Findmi",
  description: "One free Findmi account: your Digital Passbook, and the ability to add or claim your brand.",
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
    <div className="mx-auto max-w-lg px-6 py-8 sm:py-12">
      <h1 className="font-display text-page-title font-bold tracking-tight text-ink">Join Findmi</h1>
      <p className="mt-1.5 text-sm text-ink/60">
        Your places, brands, products and experiences — all in one place.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <ValueCard
          href={`/signup?next=${encodeURIComponent("/join/start?intent=passbook")}`}
          icon={<NavIcon name="bookmark" className="h-5 w-5 text-findmi-700" />}
          iconBg="bg-findmi-50"
          border="border-findmi/30"
          hoverBorder="hover:border-findmi/60"
          title="Build your digital passbook"
          description="Discover what you love, save what you want to do, and document the places, products and experiences that become part of your world."
        />
        <ValueCard
          href={`/signup?next=${encodeURIComponent("/join/start?intent=business")}`}
          icon={<NavIcon name="storefront" className="h-5 w-5 text-ink/70" />}
          iconBg="bg-mist/60"
          border="border-black/10"
          hoverBorder="hover:border-black/20"
          title="Add or claim your brand"
          description="Create or claim your business presence, add products, publish where you're showing up and manage your presence on Findmi."
        />
      </div>

      <Link
        href="/signup?next=%2Fjoin%2Fstart"
        className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
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
    </div>
  );
}

/** Each card is a single, fully-tappable Link carrying a non-binding
 * onboarding `intent` (see this page's own doc comment) — never a form
 * or a fork with its own confirm step, and never anything that creates a
 * business or classifies the account. Same approved card geometry/colors
 * as before (border/iconBg are passed in unchanged per card); the only
 * addition is the chevron affordance and the Link semantics/focus ring
 * needed to make the whole card behave like the tappable control it
 * already looked like. */
function ValueCard({
  href,
  icon,
  iconBg,
  border,
  hoverBorder,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  border: string;
  hoverBorder: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-start gap-3 rounded-3xl border ${border} bg-white p-4 transition ${hoverBorder} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/50 sm:p-5`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
      <span className="flex-1">
        <span className="block font-display text-base font-bold tracking-tight text-ink">{title}</span>
        <span className="mt-1 block text-sm text-ink/60">{description}</span>
      </span>
      <ChevronGlyph className="mt-1 h-4 w-4 shrink-0 text-ink/30" />
    </Link>
  );
}

function ChevronGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M7.5 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
