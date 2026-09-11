import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
import {
  getJoinPageSections,
  resolveJoinCard,
  resolveJoinClaimBusiness,
  resolveJoinFreeCard,
  resolveJoinGlobal,
  resolveJoinHero,
  resolveJoinInviteSection,
  resolveJoinProExtra,
  resolveJoinWhatYouGet,
  type ResolvedJoinCard,
  type ResolvedJoinClaimBusiness,
  type ResolvedJoinFreeCard,
  type ResolvedJoinInviteSection,
  type ResolvedJoinProExtra,
} from "@/lib/join-page";

// Launch-simplification pass — Stripe checkout/onboarding is intentionally
// disabled from this public page for the first few days after launch (see
// the pass report). PlanCheckoutForm, join/actions.ts's
// startMembershipCheckout, lib/commerce/membershipCheckout.ts/
// membershipActivation.ts, and /join/success are all preserved untouched
// and fully working — this page just no longer imports or links to them.
// Reactivating automated payment later is a matter of restoring the plan-
// picker section (git history has the exact prior version) rather than
// rebuilding anything.
//
// Founder Site Editor pass — every text/pricing/feature/CTA/visibility
// value below comes from lib/join-page.ts's resolve*() helpers, which read
// founder overrides (site_sections, page_key "join") and fall back to
// hardcoded defaults.
//
// Join Page Conversion Rebuild pass — this page's structure/hierarchy was
// rebuilt around one objective: converting a stranger into a Findmi Pro
// customer (Hero w/ CTAs -> real-profile proof -> Pro, the primary
// product -> Free, the secondary fallback -> what customers get ->
// Regional/National -> a quietly-collapsed Pro Invite utility -> a final
// conversion close). See this pass's own report for the exact
// section-by-section old-copy -> new-copy mapping. Every underlying
// Free/Pro/geography/entitlement/checkout/claim behavior below is
// UNCHANGED — this pass only touches presentation and copy. A handful of
// admin-editable fields (Pro's general description tagline, Free's
// disclosure/"Requires Pro" list, Multi-Region's price/title tile) no
// longer have a rendering slot in the new locked structure and are left
// in place as harmless, still-editable-but-unused legacy content — see
// each field's own comment in lib/join-page.ts.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Join Findmi",
  description: "Get discovered on Findmi — tell us about your business or event and we'll be in touch.",
};

// The one core Free/Pro business-acquisition path — never Tally. Pro
// intent survives sign-in via the existing safe `next` redirect
// mechanism (see account/business/new/page.tsx and lib/auth/
// safe-redirect.ts) — no new auth/session infrastructure.
const PRO_NATIVE_CTA_URL = "/account/business/new?plan=pro";

/** Pro Invite / Complimentary Access Codes pass — findmi.app/join?invite=CODE
 * is the invite link's public entry point. This page has no other use for
 * that param, so it just hands off straight to the real redemption flow
 * (/redeem/[code], which handles auth/business-selection/redemption
 * itself) rather than growing invite-aware UI here.
 *
 * Referral Partner + Discount Foundation — findmi.app/join?ref=CODE is
 * the referral link's own entry point, deliberately handled completely
 * differently from ?invite= above: a referral code is never redeemed
 * here — it's carried straight through into the Free/Pro CTA links below
 * as ?ref=, so it survives into account/business/new's create form, which
 * is the only place attribution is ever actually recorded
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
  const global = resolveJoinGlobal(overrides);

  const refQuery = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  const freeCtaHref = ref ? `/account/business/new?ref=${encodeURIComponent(ref)}` : "/account/business/new";
  const proCtaHref = `${PRO_NATIVE_CTA_URL}${refQuery}`;

  const proCard = resolveJoinCard(overrides, "card_discovery_pro", global.ctaUrl);
  const proExtra = resolveJoinProExtra(overrides);
  const free = resolveJoinFreeCard(overrides);
  const whatYouGet = resolveJoinWhatYouGet(overrides);
  // Preserves the existing sales CTA destination: this card's own cta_url
  // override if a founder has set one, else the shared global Join form
  // URL (Tally), exactly as before — only the PUBLIC presentation (its
  // own bespoke section instead of a generic pricing card) changed.
  const regional = resolveJoinCard(overrides, "card_multi_region", global.ctaUrl);
  const inviteSection = resolveJoinInviteSection(overrides);
  const claim = resolveJoinClaimBusiness(overrides);

  return (
    <div>
      {/* HERO / VALUE — headline, one short line, then the three real
          conversion actions and a single reassurance line, all above the
          fold. No more "New Listings Are Reviewed..." notice here — see
          this pass's own report for why it's removed rather than
          replaced. */}
      <div className="mx-auto max-w-4xl px-6 pt-14 sm:pt-16">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            {hero.heading}
          </h1>
          <p className="mt-3 text-base text-ink/60">{hero.body}</p>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a
              href={proCtaHref}
              className="flex h-12 items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Get Findmi Pro — $99/year
            </a>
            <Link
              href={freeCtaHref}
              className="text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
            >
              Start free
            </Link>
            <Link
              href={claim.ctaUrl}
              className="text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
            >
              {claim.body} {claim.ctaLabel}
            </Link>
          </div>
          <p className="mt-3 text-xs text-ink/40">One year of Findmi Pro · No automatic renewal</p>
        </div>
      </div>

      {/* REAL FINDMI PROOF — real-product proof appears high on the page
          now, not buried at the bottom. Reuses the same "What you get"
          Native Rose destination (founder-editable there) rather than
          introducing a second URL field for the same real profile. */}
      <div className="mx-auto max-w-4xl px-6 pt-10 sm:pt-12">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-mist/40 px-5 py-4">
          <p className="text-sm font-semibold text-ink/70">See Findmi in action.</p>
          <a
            href={whatYouGet.ctaUrl}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
          >
            View The Native Rose <span aria-hidden>→</span>
          </a>
        </div>
      </div>

      {/* FINDMI PRO — the dominant, primary product section. */}
      {proCard.visible && (
        <div className="mx-auto max-w-xl px-4 pt-10 sm:px-6 sm:pt-12">
          <ProCard card={proCard} extra={proExtra} />
        </div>
      )}

      {/* FREE — secondary fallback. Visibly quieter than Pro, but still
          positive/legitimate — no crossed-out "Requires Pro" list, no
          disclosure toggle. */}
      {free.visible && (
        <div className="mx-auto max-w-xl px-4 pt-6 sm:px-6">
          <FreeSection card={free} ctaHref={freeCtaHref} />
        </div>
      )}

      {/* WHAT CUSTOMERS GET — explains the overall product ecosystem, not
          a Pro-exclusivity list. No outbound CTA here anymore (the real
          profile proof moved up to its own section above). */}
      {whatYouGet.visible && (
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{whatYouGet.eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {whatYouGet.heading}
          </h2>
          {whatYouGet.body && <p className="mt-2 text-sm text-ink/60">{whatYouGet.body}</p>}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {whatYouGet.tiles.map((tile, i) => (
              <PreviewTile key={`${i}-${tile.label}`} label={tile.label} detail={tile.detail} />
            ))}
          </div>
        </div>
      )}

      {/* REGIONAL / NATIONAL — a sales pathway for higher-value customers,
          not "Pricing Plan #3". No price/title tile, no generic
          PlanCard. */}
      {regional.visible && (
        <div className="mx-auto max-w-4xl px-6 pb-16">
          <RegionalSection card={regional} />
        </div>
      )}

      {/* PRO INVITE CODE — quiet utility, collapsed by default. */}
      {inviteSection.visible && (
        <div className="mx-auto max-w-xl px-4 pb-10 sm:px-6">
          <InviteDisclosure section={inviteSection} />
        </div>
      )}

      {/* FINAL CONVERSION SECTION — the page always ends on a conversion
          action, never an explanatory card with nothing to do next. */}
      <FinalCta proCtaHref={proCtaHref} freeCtaHref={freeCtaHref} claim={claim} />
    </div>
  );
}

function PreviewTile({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-mist/40 p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="mt-1 text-xs text-ink/60">{detail}</p>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700">
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 shrink-0 text-ink/40 ${className}`}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Findmi Pro's own dominant presentation. Presentation only: the actual
 * Findmi Here feature/code and Pro entitlement/checkout are completely
 * untouched.
 *
 * Join Page Conversion Rebuild pass — the general description `tagline`
 * field (a longer paragraph that used to run beneath the Findmi Here
 * highlight block) is deliberately no longer rendered here: it repeated
 * the $99/year price already stated once above, which this pass's own
 * anti-redundancy instruction rules out. `extra.descriptionLine` (new)
 * now carries the one-line summary directly under the price instead. */
function ProCard({ card, extra }: { card: ResolvedJoinCard; extra: ResolvedJoinProExtra }) {
  const { title, price, priceSuffix, features, ctaLabel, ctaUrl } = card;
  return (
    <div className="flex flex-col rounded-3xl border border-findmi/40 bg-white p-6 shadow-[0_4px_24px_rgba(20,176,188,0.14)] sm:p-8">
      <h3 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h3>
      <p className="mt-1 text-sm text-ink/60">{extra.billingLabel}</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tracking-tight text-ink">{price}</span>
        {priceSuffix && <span className="text-sm font-medium text-ink/45">{priceSuffix}</span>}
      </p>
      <p className="mt-2 text-sm text-ink/60">{extra.descriptionLine}</p>
      <p className="mt-1 text-xs text-ink/40">{extra.noRenewalNote}</p>

      {/* Findmi Here — the featured, differentiating benefit. */}
      <div className="mt-4 rounded-2xl bg-findmi-50 p-4 sm:p-5">
        <h4 className="font-display text-lg font-bold tracking-tight text-ink">{extra.highlightHeading}</h4>
        <p className="mt-1 text-sm font-semibold text-ink/80">{extra.highlightSubheading}</p>
        <p className="mt-1.5 text-sm text-ink/60">{extra.highlightBody}</p>
      </div>

      <ul className="mt-5 flex flex-col gap-1.5">
        {features.map((f, i) => (
          <li key={`${i}-${f}`} className="flex items-start gap-2 text-xs text-ink/55">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <a
        href={ctaUrl}
        className="mt-6 flex h-12 items-center justify-center rounded-full bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
      >
        {ctaLabel}
      </a>
      <p className="mt-2 text-center text-xs text-ink/40">{extra.priceFootnote}</p>
    </div>
  );
}

/** Free's quiet, secondary, positive presentation.
 *
 * Join Page Conversion Rebuild pass — replaces the prior expandable "View
 * what's included" disclosure and crossed-out "Requires Pro" list: Free
 * must read as legitimate, not visually punished. No price is shown
 * either (not part of the locked copy for this section). Presentation
 * only — no Free entitlement changed. */
function FreeSection({ card, ctaHref }: { card: ResolvedJoinFreeCard; ctaHref: string }) {
  const { title, shortTagline, description, includedFeatures, ctaLabel } = card;
  return (
    <div className="rounded-2xl border border-black/10 bg-mist/40 p-4 sm:p-5">
      <p className="font-display text-lg font-bold tracking-tight text-ink">{title}</p>
      <p className="mt-1 text-sm font-semibold text-ink/70">{shortTagline}</p>
      <p className="mt-1.5 text-sm text-ink/60">{description}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {includedFeatures.map((f, i) => (
          <li key={`${i}-${f}`} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className="mt-4 flex h-11 items-center justify-center rounded-full border border-black/10 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
      >
        {ctaLabel}
      </Link>
      <p className="mt-2.5 text-center text-xs text-ink/45">
        Upgrade to Pro anytime for your complete profile, full schedule, products and more.
      </p>
    </div>
  );
}

/** Regional/National — a sales pathway for higher-value customers, kept
 * deliberately distinct from the PlanCard/pricing-tile look (no price
 * tile, no emphasis border). Still resolved via the same
 * resolveJoinCard()/admin form as every other card — only this bespoke
 * public presentation is new. */
function RegionalSection({ card }: { card: ResolvedJoinCard }) {
  const { eyebrow, title, tagline, features, ctaLabel, ctaUrl } = card;
  return (
    <div className="rounded-3xl border border-black/10 bg-mist/40 p-6 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">{eyebrow}</p>
      <h3 className="mt-1.5 font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm text-ink/60">{tagline}</p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {features.map((f, i) => (
          <li key={`${i}-${f}`} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <a
        href={ctaUrl}
        className="mt-5 inline-flex h-11 items-center justify-center rounded-full border border-black/15 px-5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
      >
        {ctaLabel}
      </a>
    </div>
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
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-ink/60 [&::-webkit-details-marker]:hidden">
        {section.heading}
        <ChevronGlyph className="transition-transform group-open:rotate-180" />
      </summary>
      {section.helperText && <p className="mt-1.5 text-xs text-ink/45">{section.helperText}</p>}
      <div className="mt-3">
        <ProInviteCodeEntry returnTo="/join" heading="" />
      </div>
    </details>
  );
}

/** Final Conversion Section — the page always ends on a conversion
 * action. Reuses the exact same CTA destinations as the Hero. */
function FinalCta({
  proCtaHref,
  freeCtaHref,
  claim,
}: {
  proCtaHref: string;
  freeCtaHref: string;
  claim: ResolvedJoinClaimBusiness;
}) {
  return (
    <div className="border-t border-black/5 bg-mist/30">
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Ready to get discovered?
        </h2>
        <p className="mt-2 text-sm text-ink/60">
          Build your Findmi presence and make it easier for customers to find you wherever you show up.
        </p>

        <div className="mt-6 flex flex-col items-center gap-3">
          <a
            href={proCtaHref}
            className="flex h-12 w-full max-w-xs items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Get Findmi Pro — $99/year
          </a>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link
              href={freeCtaHref}
              className="text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
            >
              Start free
            </Link>
            <Link
              href={claim.ctaUrl}
              className="text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
            >
              {claim.ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
