import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessShowcaseCarousel from "@/components/BusinessShowcaseCarousel";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
import ChevronIcon from "@/components/ChevronIcon";
import NavIcon from "@/components/NavIcon";
import {
  getJoinPageSections,
  resolveJoinClaimBusiness,
  resolveJoinHero,
  resolveJoinInviteSection,
  type ResolvedJoinClaimBusiness,
  type ResolvedJoinInviteSection,
} from "@/lib/join-page";

// Join / Universal Onboarding pass — this is the exact business-acquisition
// page that used to live at the bare /join route, relocated to /join/business
// verbatim (same CMS binding, page_key "join" in lib/join-page.ts — unchanged
// — a physical route move, never a content/schema change). /join itself is
// now the universal FindMi account-creation entry point (see that route's
// own file): a stranger arriving with generic signup intent lands there
// first, while every existing business-acquisition surface (Footer's "For
// Business" links, the admin Join editor, Stripe membership checkout's
// success/cancel URLs, the /join/sales inquiry form, /join/success) was
// repointed at this new path — see this pass's own report for the full list.
//
// Launch-simplification pass — Stripe checkout/onboarding is intentionally
// disabled from this public page for the first few days after launch (see
// the pass report). PlanCheckoutForm, join/actions.ts's
// startMembershipCheckout, lib/commerce/membershipCheckout.ts/
// membershipActivation.ts, and /join/success are all preserved untouched
// and fully working — this page just no longer imports or links to them.
//
// Founder Site Editor pass — Hero/What You Get/Invite/Claim text below
// still comes from lib/join-page.ts's resolve*() helpers (founder
// overrides via site_sections, page_key "join", falling back to
// hardcoded defaults). The Pro/Free/Regional card content model
// (JOIN_CARD_DEFAULTS, JOIN_FREE_CARD_DEFAULTS, resolveJoinCard,
// resolveJoinFreeCard, resolveJoinProExtra, resolveJoinGlobal) is left
// fully intact in lib/join-page.ts and the admin Join editor for when
// paid products return — this page just no longer calls or renders any
// of it (see the For Business Page Cleanup pass below).
//
// For Business Page Cleanup pass — Findmi Business Pages are free right
// now, and this public landing page must say so without contradiction:
// removed the Free/Pro decision entirely (ChoosePathTiles, FreeSection,
// ProCard, and their $20/month Pro / $49/month Managed Pro / "Explore
// Pro" copy) and replaced it with ValuePillars, a single connected-
// presence narrative (Business Page -> Where To Find You -> What's
// Happening Next -> Discovery) plus one plain "Free. No trial. No
// credit card." confirmation. There is now exactly one creation path
// (Get Started Free -> the canonical /account/business/new flow) and
// one preserved secondary path for an existing Business (the unchanged
// Claim Your Business link, still -> /businesses, same as before this
// pass). The Pro Invite Code disclosure is kept: it's a redemption
// utility for a complimentary grant already in motion, not a sales
// section, the exact same reasoning the live Business creation form
// itself uses for its own hasInvite banner.
//
// Join Page Conversion Rebuild pass, /Join Final Visual Conversion pass,
// Join Native Rose Showcase Upgrade pass — the Native Rose showcase
// carousel (real screenshots, same component the homepage's own
// business_showcase row renders) and the "What You Get" real compact
// previews (CompactCard for the real business, ProductCard for a real
// product) are both kept as concrete, truthful proof — neither mentions
// price or plan tier, so neither needed to change for this pass.
// getNextAppearanceHints() is still fetched below for the "Findmi Here"
// preview tile.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Findmi for Business",
  description: "Show customers who you are, what you offer and where you'll be next, all in one Findmi page.",
};

// The one real profile used as this page's "show, don't tell" proof —
// same destination the page has always used. Fetched once here and reused
// for both the Real Findmi Proof module and the "What You Get" Business
// Profile / Findmi Here tiles, rather than querying it more than once.
const PROOF_BUSINESS_SLUG = "the-native-rose";

/** Pro Invite / Complimentary Access Codes pass — findmi.app/join?invite=CODE
 * is the invite link's public entry point. This page has no other use for
 * that param, so it just hands off straight to the real redemption flow
 * (/redeem/[code], which handles auth/business-selection/redemption
 * itself) rather than growing invite-aware UI here.
 *
 * Referral Partner + Discount Foundation — findmi.app/join?ref=CODE is
 * the referral link's own entry point, deliberately handled completely
 * differently from ?invite= above: a referral code is never redeemed
 * here — it's carried straight through into the Get Started Free CTA
 * below as ?ref=, so it survives into account/business/new's create
 * form, which is the only place attribution is ever actually recorded
 * (createMemberBusiness -> attribute_referral()).
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; ref?: string }>;
}) {
  const { invite, ref } = await searchParams;
  if (invite) redirect(`/redeem/${encodeURIComponent(invite)}`);

  const overrides = await getJoinPageSections();

  const hero = resolveJoinHero(overrides);

  // For Business Page Cleanup pass — the one remaining creation path.
  // ?ref=CODE still survives into account/business/new's create form the
  // same way it always did (attribution is recorded there, independent
  // of plan — see createMemberBusiness -> attribute_referral()).
  const freeCtaHref = ref ? `/account/business/new?ref=${encodeURIComponent(ref)}` : "/account/business/new";

  const inviteSection = resolveJoinInviteSection(overrides);
  const claim = resolveJoinClaimBusiness(overrides);

  // Real product proof — fetched once, reused by both the Proof module and
  // the "What You Get" tiles below. Never fabricated: a missing business/
  // appearance/product (e.g. this exact sandbox, which can't reach
  // production Supabase — see CLAUDE.md) degrades to the existing generic
  // presentation for that one piece, nothing invented in its place.

  return (
    <div>
      {/* HERO — For Business Page Cleanup pass: PROMISE -> ONE FREE ACTION
          -> PROOF. No Free/Pro decision — "Get Started Free" is the only
          creation CTA on the page, with the current offer stated plainly
          right under it (no mention of future paid plans). "Explore
          Findmi" is a quiet secondary CTA into the existing public
          discovery experience (/discover) — not a new destination. The
          quiet claim link below it preserves the one legitimate path for
          a Business that already exists, same destination as before. */}
      <div className="mx-auto max-w-4xl px-6 pt-10 sm:pt-14">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">For Business</p>
          <h1 className="mt-1 font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            <HeroHeadline heading={hero.heading} />
          </h1>
          <p className="mt-3 text-base text-ink/60">{hero.body}</p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={freeCtaHref}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 sm:w-auto"
            >
              Get Started Free
            </Link>
            <Link
              href="/discover"
              className="flex h-12 w-full items-center justify-center rounded-2xl border border-black/10 px-6 text-sm font-bold uppercase tracking-wide text-ink transition hover:border-black/20 sm:w-auto"
            >
              Explore Findmi
            </Link>
          </div>
          <p className="mt-2.5 text-xs text-ink/40">Free. No trial. No credit card.</p>

          {/* Single quiet claim action — reuses the exact same
              claim.body/ctaLabel/ctaUrl the rest of the page already
              resolves (unchanged by this pass — still /businesses). */}
          <Link
            href={claim.ctaUrl}
            className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
          >
            {claim.body} {claim.ctaLabel} <ChevronIcon direction="right" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* NATIVE ROSE SHOWCASE — Join Native Rose Showcase Upgrade pass.
          Reuses the homepage's own BusinessShowcaseCarousel unmodified
          (same real screenshots, same component, no second carousel to
          maintain). Tightened top spacing (pt-10/sm:pt-12 -> pt-7/sm:pt-8)
          so this reads as evidence right under the new hero decision
          module rather than a separate, unrelated section. The carousel
          itself stays a plain horizontally-swipeable row (native
          scroll-snap, no JS drag state) — wrapping it in a link would
          fight that on touch, so clickability lives in the existing
          "View live profile" link below instead, same destination/label
          this section already used before this pass. */}
      <div className="mx-auto max-w-4xl px-6 pt-7 sm:pt-8">
        {/* Public Experience Consolidation pass — this heading used a
            small, faint, all-caps eyebrow treatment for what's actually
            this section's real heading (not a label above one), which
            read as gray-on-gray with no clear hierarchy against the body
            line under it. Reuses the exact same font-display/size/weight
            pattern this same page already uses for its other real
            section headings (see "Your page is only the beginning."
            below) — a real heading, sentence case, no uppercase. */}
        <h2 className="text-center font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          See what your Findmi can become.
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-center text-sm text-ink/60">
          One page. Your business, products and everywhere you&rsquo;ll be next.
        </p>
        <div className="mt-4">
          <BusinessShowcaseCarousel />
        </div>
        <div className="mt-3 flex justify-center">
          <a
            href={`/business/${PROOF_BUSINESS_SLUG}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
          >
            View Live Profile <ChevronIcon direction="right" className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* HOW YOUR BUSINESS SHOWS UP — For Business Page Cleanup pass.
          Replaces the former Free/Pro decision (FreeSection/ProCard) with
          the connected-presence narrative: a Business isn't just creating
          a profile, it's creating a living presence across the places,
          events, products and experiences where it exists. Fixed page
          copy (same convention as "Your page is only the beginning."
          below) — only truthful, currently-Free capabilities are named;
          nothing here is Pro-gated (see account/business/new's own
          verified Free value section for the same underlying audit). */}
      <div className="mx-auto max-w-4xl px-6 pb-10 pt-8 sm:pt-10">
        <ValuePillars />
      </div>

      {/* Page Density pass — the separate Free confirmation, the four-tile
          demo grid and the "only the beginning" section repeated what the
          connected-presence section above already says; Free is stated in
          the Hero and the Final CTA. */}

      {/* Pricing UX Cleanup pass — the Regional/National Brands sales card
          (previously rendered here via RegionalSection, linking to
          /join/sales) is removed from this customer-facing flow: FindMi
          now has a coherent self-service Free -> Pro -> Managed Pro path,
          so this page should never imply a separate regional/national
          sales product exists when it doesn't. The underlying content
          model (card_multi_region in join-page.ts), its admin editor, and
          the /join/sales route are all left fully intact — only this
          page's own render of the card (and its now-unused
          RegionalSection component) is removed. */}

      {/* PRO INVITE CODE — quiet utility, collapsed by default. */}
      {inviteSection.visible && (
        <div className="mx-auto max-w-xl px-4 pb-10 sm:px-6">
          <InviteDisclosure section={inviteSection} />
        </div>
      )}

      {/* FINAL CONVERSION SECTION — the page always ends on a conversion
          action. */}
      <FinalCta freeCtaHref={freeCtaHref} claim={claim} />
    </div>
  );
}

/** Final Join Conversion Story pass — forces a deliberate two-line break
 * on mobile (rather than letting the browser wrap wherever it likes) AND
 * accents the second line in the existing Findmi teal, so "Make it easy
 * to find." reads as the actual promise, not just a continuation of the
 * first line. Splits on the current default heading's own natural
 * sentence break ("Your business moves." / "Make it easy to find.") into
 * two `block sm:inline` spans — block stacks them on mobile, sm:inline
 * lets the heading flow as one line again at larger widths where there's
 * room; the accent color applies at every width, not just mobile. This is
 * presentation-only: the CMS-editable string itself (hero.heading) is
 * untouched, and no new color is introduced — text-findmi-700 is the same
 * accent already used for eyebrows/links elsewhere on this page. If a
 * founder ever edits the headline to something that doesn't contain that
 * substring, this quietly falls back to plain, unsplit, unaccented text —
 * no crash, no assumption enforced on future copy. */
function HeroHeadline({ heading }: { heading: string }) {
  const breakAt = " Make";
  const idx = heading.indexOf(breakAt);
  if (idx === -1) return <>{heading}</>;
  const before = heading.slice(0, idx);
  const after = heading.slice(idx + 1); // drop the leading space; keep "Make it easy to find."
  return (
    <>
      <span className="block sm:inline">{before}</span>{" "}
      <span className="block text-findmi-700 sm:inline">{after}</span>
    </>
  );
}

/** For Business Page Cleanup pass — the connected-presence narrative that
 * replaces the former Free/Pro decision. A Business isn't merely creating
 * a profile; it's creating a living presence across the places, events,
 * products and experiences where it exists. Four fixed pillars (same
 * "hardcoded page copy" convention as the "Your page is only the
 * beginning." section below — no new CMS concept, no migration), each a
 * truthful, currently-Free capability (verified against the same Free
 * entitlement audit as account/business/new's own value section:
 * requireBusinessMemberWithDetails / location-actions.ts /
 * qr-manager-actions.ts / moment-authorship.ts, none of which gate on
 * isBusinessPro). Uses current Findmi terminology (Where I'll Be, not
 * "Appearance") and makes no traffic/audience/growth/AI claim. */
function ValuePillars() {
  // One Business presence, connected across Findmi — every row is a
  // capability that exists today (no metrics, no implied features).
  const pillars: { heading: string; body: string; icon: "storefront" | "tag" | "pin" | "calendar" | "moments" | "compass" | "target" }[] = [
    { heading: "Your Business Page", body: "Your story, photos, links and essentials in one place.", icon: "storefront" },
    { heading: "Products", body: "What you make, sell or offer — discoverable from your page.", icon: "tag" },
    { heading: "Where Customers Can Find You", body: "Your own locations, plus the stockists, cafés and venues that carry you.", icon: "pin" },
    { heading: "Events", body: "Events you host, and the markets, pop-ups and festivals you’re Appearing At.", icon: "calendar" },
    { heading: "Moments", body: "Real experiences from your Business and your customers, connected to your page.", icon: "moments" },
    { heading: "Discovery", body: "Show up across Findmi’s places, events and search wherever you’re connected.", icon: "compass" },
    { heading: "Connections & Growth", body: "Set goals, track the places you’re pursuing and respond to Opportunities.", icon: "target" },
  ];
  return (
    <section aria-labelledby="one-presence">
      <h2 id="one-presence" className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
        One Business Presence, Connected Across Findmi
      </h2>
      <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {pillars.map((p) => (
          <li key={p.heading} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
              <NavIcon name={p.icon} className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{p.heading}</span>
              <span className="block text-sm text-ink/60">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChevronGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 shrink-0 text-ink/40 ${className}`}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}







/** Pro Invite — a quiet, collapsed-by-default utility, not a giant
 * always-open pricing-style card. The redemption flow itself
 * (ProInviteCodeEntry -> goToRedeemCode -> /redeem/[code]) is completely
 * unchanged; this only wraps it in a native <details>/<summary>
 * disclosure (no client JS needed). heading="" suppresses
 * ProInviteCodeEntry's own internal heading paragraph since the
 * <summary> below already serves as the heading. */
function InviteDisclosure({ section }: { section: ResolvedJoinInviteSection }) {
  return (
    <details className="group">
      {/* /Join micro UI fixes pass — justify-center added so text+chevron
          move as one centered unit (was flush-left) to match the centered
          composition around it; gap-1.5 keeps them together, expand/
          collapse and the form below are otherwise untouched. */}
      <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 text-sm font-semibold text-ink/60 [&::-webkit-details-marker]:hidden">
        {section.heading}
        <ChevronGlyph className="transition-transform group-open:rotate-180" />
      </summary>
      {section.helperText && <p className="mt-1.5 text-xs text-ink/45">{section.helperText}</p>}
      <div className="mt-3">
        <ProInviteCodeEntry returnTo="/join/business" heading="" />
      </div>
    </details>
  );
}

/** Final Conversion Section — the page always ends on a conversion
 * action. Reuses the exact same CTA destinations as the Hero: the
 * canonical creation flow as the one primary action, plus the one
 * preserved secondary path for a Business that already exists
 * (unchanged claim.ctaUrl -> /businesses). For Business Page Cleanup
 * pass — no second "Explore Pro" action belongs here anymore: the page
 * no longer sells Pro, so a secondary action pointing back at it would
 * contradict the "Free right now" offer this button already states. */
function FinalCta({ freeCtaHref, claim }: { freeCtaHref: string; claim: ResolvedJoinClaimBusiness }) {
  return (
    <div className="border-t border-black/5 bg-mist/30">
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Give customers one place to find you.
        </h2>
        <p className="mt-2 text-sm text-ink/60">Your business, what you offer and everywhere you&rsquo;ll be next.</p>

        <div className="mt-6 flex flex-col items-center gap-4">
          <Link
            href={freeCtaHref}
            className="flex h-12 w-full max-w-xs items-center justify-center rounded-2xl bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Get Started Free
          </Link>
          <p className="text-xs text-ink/40">No credit card required.</p>
          <Link
            href={claim.ctaUrl}
            className="text-sm font-semibold text-ink/70 underline underline-offset-2 hover:text-ink"
          >
            Already on Findmi? {claim.ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
