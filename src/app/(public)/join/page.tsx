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
 * compact entry screen: a short title/subhead, two INFORMATIONAL value
 * cards (Passbook, Business), and the Create Free Account CTA. Neither
 * card navigates anywhere — actual path selection still only happens
 * after account creation, at /join/start (untouched). The focused
 * onboarding header (logo + back, no search/bag/create/hamburger) is
 * handled by SiteChrome swapping in OnboardingHeader for this exact
 * route — see that component's own comment; MobileHeader/NavDesktop/
 * HamburgerMenu themselves are untouched.
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
          icon={<NavIcon name="bookmark" className="h-5 w-5 text-findmi-700" />}
          iconBg="bg-findmi-50"
          border="border-findmi/30"
          title="Build your digital passbook"
          description="Discover what you love, save what you want to do, and document the places, products and experiences that become part of your world."
        />
        <ValueCard
          icon={<NavIcon name="storefront" className="h-5 w-5 text-ink/70" />}
          iconBg="bg-mist/60"
          border="border-black/10"
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

/** Informational only — neither card is a Link/button, by design: this
 * page never forks the visitor down a path (see this page's own doc
 * comment). Just explains what the one free account includes. */
function ValueCard({
  icon,
  iconBg,
  border,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconBg: string;
  border: string;
  title: string;
  description: string;
}) {
  return (
    <div className={`rounded-3xl border ${border} bg-white p-4 sm:p-5`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
      <p className="mt-3 font-display text-base font-bold tracking-tight text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink/60">{description}</p>
    </div>
  );
}
