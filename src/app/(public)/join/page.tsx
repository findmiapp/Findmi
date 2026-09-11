import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import BusinessLogoCard from "@/components/BusinessLogoCard";
import CompactCard from "@/components/CompactCard";
import ProductCard from "@/components/ProductCard";
import ProInviteCodeEntry from "@/components/ProInviteCodeEntry";
import { getBusinessBySlug, getNextAppearanceHints, getProductsForBusiness, type NextAppearanceHint } from "@/lib/data";
import { cityState, formatDateShort } from "@/lib/format";
import type { BusinessWithCategories, Product } from "@/lib/types";
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
//
// Founder Site Editor pass — every text/pricing/feature/CTA/visibility
// value below comes from lib/join-page.ts's resolve*() helpers, which read
// founder overrides (site_sections, page_key "join") and fall back to
// hardcoded defaults.
//
// Join Page Conversion Rebuild pass — this page's structure/hierarchy was
// rebuilt around one objective: converting a stranger into a Findmi Pro
// customer.
//
// /Join Final Visual Conversion pass — this is a presentation-only polish
// of that same structure, not another rewrite: quieter secondary CTAs
// (Hero/Final) so they stop visually competing with the primary Pro
// button; the "Real Findmi Proof" section now renders an actual compact
// BusinessLogoCard for The Native Rose (real name/logo/cover/category/
// location/NEXT UP appearance — the exact same component and bulk
// getNextAppearanceHints() data access the homepage's own "Brands We
// Love" row already uses) instead of a plain text link; the Pro feature
// list is compressed 7->5 lines; "What You Get" now shows real compact
// previews (CompactCard for the real business, ProductCard for a real
// product when one exists) instead of four flat gray text tiles; Regional/
// National's checklist collapses into one inline line. No entitlement,
// payment, geography, or schema behavior changed anywhere in this pass.
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
  // URL (Tally), exactly as before.
  const regional = resolveJoinCard(overrides, "card_multi_region", global.ctaUrl);
  const inviteSection = resolveJoinInviteSection(overrides);
  const claim = resolveJoinClaimBusiness(overrides);

  // Real product proof — fetched once, reused by both the Proof module and
  // the "What You Get" tiles below. Never fabricated: a missing business/
  // appearance/product (e.g. this exact sandbox, which can't reach
  // production Supabase — see CLAUDE.md) degrades to the existing generic
  // presentation for that one piece, nothing invented in its place.
  const proofBusiness = await getBusinessBySlug(PROOF_BUSINESS_SLUG);
  const [appearanceHints, proofProducts] = proofBusiness
    ? await Promise.all([getNextAppearanceHints([proofBusiness.id]), getProductsForBusiness(proofBusiness.id)])
    : [new Map<string, NextAppearanceHint>(), [] as Product[]];
  const proofAppearance = proofBusiness ? (appearanceHints.get(proofBusiness.id) ?? null) : null;
  const proofProduct = proofProducts[0] ?? null;

  return (
    <div>
      {/* HERO — recomposed (/Join Hero Composition pass) into
          PROMISE -> CHOOSE YOUR PATH -> PROOF: headline + one short line,
          then a compact two-tile decision module (Pro/Free, anchoring
          down into their own full sections below rather than starting
          signup immediately), then a single quiet claim link. The large
          direct Pro button and its renewal-reassurance line are gone from
          the hero — that information still lives in the full Pro section
          below (ProCard, untouched). */}
      <div className="mx-auto max-w-4xl px-6 pt-14 sm:pt-16">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            <HeroHeadline heading={hero.heading} />
          </h1>
          <p className="mt-3 text-base text-ink/60">{hero.body}</p>

          <ChoosePathTiles proCard={proCard} free={free} />

          {/* Single quiet claim action — Free already has its own tile
              above, so no duplicate "Start free" link here (see
              SecondaryActions, still used unchanged by the Final CTA
              below). Reuses the exact same claim.body/ctaLabel/ctaUrl the
              rest of the page already resolves — nothing new added to the
              CMS. */}
          <Link
            href={claim.ctaUrl}
            className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink/60 underline underline-offset-2 hover:text-ink"
          >
            {claim.body} {claim.ctaLabel} <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      {/* REAL FINDMI PROOF — a real, compact BusinessLogoCard (the exact
          component/data access the homepage's own "Brands We Love" row
          uses), not a text box. Falls back to a plain link only if the
          business can't be resolved. Tightened top spacing (pt-10/sm:pt-12
          -> pt-7/sm:pt-8) so this reads as evidence right under the new
          hero decision module rather than a separate, unrelated section. */}
      <div className="mx-auto max-w-4xl px-6 pt-7 sm:pt-8">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/35">See Findmi in action</p>
        <div className="mx-auto mt-3 max-w-xs">
          {proofBusiness ? (
            <BusinessLogoCard business={proofBusiness} ctaLabel="View live profile" nextAppearance={proofAppearance} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/10 bg-mist/40 px-5 py-4">
              <p className="text-sm font-semibold text-ink/70">See Findmi in action.</p>
              <a
                href={`/business/${PROOF_BUSINESS_SLUG}`}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
              >
                View live profile <span aria-hidden>→</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* FINDMI PRO — the dominant, primary product section. */}
      {proCard.visible && (
        // id="pro" — the Hero's "Explore Pro" tile anchors here (/Join
        // Hero Composition pass). scroll-mt clears the fixed mobile
        // header (h-14, plus the admin toolbar's own top-7 offset when
        // present) so the jump doesn't land the card flush under it.
        <div id="pro" className="mx-auto max-w-xl scroll-mt-24 px-4 pt-10 sm:px-6 sm:pt-12">
          <ProCard card={proCard} extra={proExtra} />
        </div>
      )}

      {/* FREE — secondary fallback. Visibly quieter than Pro, but still
          positive/legitimate. */}
      {free.visible && (
        // id="free" — the Hero's "Explore Free" tile anchors here.
        <div id="free" className="mx-auto max-w-xl scroll-mt-24 px-4 pt-6 sm:px-6">
          <FreeSection card={free} ctaHref={freeCtaHref} />
        </div>
      )}

      {/* WHAT CUSTOMERS GET — a compact product demonstration (real
          business/product previews where available) rather than four flat
          gray explanation boxes. */}
      {whatYouGet.visible && (
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{whatYouGet.eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {whatYouGet.heading}
          </h2>
          {whatYouGet.body && <p className="mt-2 text-sm text-ink/60">{whatYouGet.body}</p>}

          <WhatYouGetGrid business={proofBusiness} appearance={proofAppearance} product={proofProduct} />
        </div>
      )}

      {/* REGIONAL / NATIONAL — a secondary sales pathway, compressed to
          read quickly rather than competing with Pro for vertical space. */}
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
          action, with the same quiet secondary-action hierarchy as the
          Hero. */}
      <FinalCta proCtaHref={proCtaHref} freeCtaHref={freeCtaHref} claim={claim} />
    </div>
  );
}

/** Quiet contextual secondary actions — shared by the Hero and the Final
 * CTA so both stay in sync. Only the actionable phrase ("Start free" /
 * "Claim your business") gets strong link styling; the lead-in context is
 * plain muted text, so neither reads as a second/third primary button
 * next to the turquoise Pro CTA. Destinations are the exact same
 * freeCtaHref/claim.ctaUrl every other CTA on this page already uses. */
/** /Join Hero Composition pass — forces a deliberate two-line break on
 * mobile ("Get discovered" / "on Findmi.") instead of letting the browser
 * wrap wherever it likes, which could otherwise strand "Findmi." alone on
 * its own line. Splits on " on Findmi" (the current default heading's own
 * natural break point) into two `block sm:inline` spans — block stacks
 * them on mobile, sm:inline lets the heading flow as one line again at
 * larger widths, exactly as before this pass. This is presentation-only:
 * the CMS-editable string itself (hero.heading) is untouched. If a
 * founder ever edits the headline to something that doesn't contain that
 * substring, this quietly falls back to plain, unsplit text — no crash,
 * no assumption enforced on future copy. */
function HeroHeadline({ heading }: { heading: string }) {
  const breakAt = " on Findmi";
  const idx = heading.indexOf(breakAt);
  if (idx === -1) return <>{heading}</>;
  const before = heading.slice(0, idx);
  const after = heading.slice(idx + 1); // drop the leading space; keep "on Findmi…"
  return (
    <>
      <span className="block sm:inline">{before}</span> <span className="block sm:inline">{after}</span>
    </>
  );
}

/** /Join Hero Composition pass — the new "Choose Your Path" module:
 * PROMISE (headline/body above) -> CHOOSE YOUR PATH (these two tiles) ->
 * PROOF (the real BusinessLogoCard below). Compact navigation tiles, not
 * pricing cards — they anchor down into the page's own full Pro/Free
 * sections (#pro/#free) rather than starting signup immediately; the
 * actual conversion CTAs/destinations live only in those full sections
 * (ProCard/FreeSection, both untouched by this pass). Price/context
 * values reuse the same resolved CMS fields those full sections already
 * use (proCard.price/priceSuffix, free.price) rather than hardcoding a
 * second copy of them; the short comparison phrases below have no
 * existing CMS field to map to and are small fixed presentation
 * microcopy, kept code-level per this pass's own scope instruction rather
 * than wiring up new CMS fields for two short marketing phrases. */
function ChoosePathTiles({ proCard, free }: { proCard: ResolvedJoinCard; free: ResolvedJoinFreeCard }) {
  const proPrice = [proCard.price, proCard.priceSuffix].filter(Boolean).join("");
  return (
    <div className="mt-6 grid grid-cols-2 gap-2.5">
      <Link
        href="#pro"
        className="rounded-2xl border border-findmi/30 bg-findmi-50 p-3.5 transition hover:border-findmi/50"
      >
        <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">Findmi Pro</p>
        <p className="mt-1 font-display text-lg font-bold tracking-tight text-ink">{proPrice}</p>
        <p className="mt-1 text-xs text-ink/60">Complete profile + full Findmi Here schedule</p>
        <p className="mt-2 flex items-center gap-1 text-xs font-bold text-findmi-700">
          Explore Pro <span aria-hidden>→</span>
        </p>
      </Link>
      <Link href="#free" className="rounded-2xl border border-black/10 bg-white p-3.5 transition hover:border-black/20">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Start free</p>
        {/* /Join micro UI fixes pass — text-lg wrapped awkwardly at ~390px
            (this line is noticeably longer than Pro's "$99/year"); sized
            down to text-xs as one uniform treatment (not split into a
            bigger "$0" + smaller rest) so it stays a single balanced
            line without widening the tile. */}
        <p className="mt-1 whitespace-nowrap font-display text-xs font-bold tracking-tight text-ink">
          {free.price} · No card required
        </p>
        <p className="mt-1 text-xs text-ink/60">Basic profile + your next appearance</p>
        <p className="mt-2 flex items-center gap-1 text-xs font-bold text-ink/70">
          Explore Free <span aria-hidden>→</span>
        </p>
      </Link>
    </div>
  );
}

function SecondaryActions({
  freeCtaHref,
  claim,
  align = "left",
}: {
  freeCtaHref: string;
  claim: ResolvedJoinClaimBusiness;
  align?: "left" | "center";
}) {
  const linkClass = "font-semibold text-ink/70 underline underline-offset-2 hover:text-ink";
  return (
    <div className={`flex flex-col gap-1.5 text-sm text-ink/45 ${align === "center" ? "items-center text-center" : ""}`}>
      <p>
        Not ready for Pro?{" "}
        <Link href={freeCtaHref} className={linkClass}>
          Start free
        </Link>
      </p>
      <p>
        Already on Findmi?{" "}
        <Link href={claim.ctaUrl} className={linkClass}>
          {claim.ctaLabel}
        </Link>
      </p>
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

function CalendarGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EventsGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function TagGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11.5 4H5a1 1 0 00-1 1v6.5a1 1 0 00.3.7l9 9a1 1 0 001.4 0l6.5-6.5a1 1 0 000-1.4l-9-9a1 1 0 00-.7-.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="8.2" cy="8.2" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** Findmi Pro's own dominant presentation. Presentation only: the actual
 * Findmi Here feature/code and Pro entitlement/checkout are completely
 * untouched. */
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

      {/* /Join Final Visual Conversion pass — compressed to 5 lines (see
          lib/join-page.ts's own comment); still the founder-editable
          feature list, nothing hardcoded here. */}
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

/** Free's quiet, secondary, positive presentation. /Join Final Visual
 * Conversion pass — same copy/benefits/CTA as before, only vertical
 * spacing tightened slightly to match the page's improved rhythm. */
function FreeSection({ card, ctaHref }: { card: ResolvedJoinFreeCard; ctaHref: string }) {
  const { title, shortTagline, description, includedFeatures, ctaLabel } = card;
  return (
    <div className="rounded-2xl border border-black/10 bg-mist/40 p-4 sm:p-5">
      <p className="font-display text-lg font-bold tracking-tight text-ink">{title}</p>
      <p className="mt-1 text-sm font-semibold text-ink/70">{shortTagline}</p>
      <p className="mt-1 text-sm text-ink/60">{description}</p>

      <ul className="mt-2.5 flex flex-col gap-1.5">
        {includedFeatures.map((f, i) => (
          <li key={`${i}-${f}`} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className="mt-3 flex h-11 items-center justify-center rounded-full border border-black/10 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
      >
        {ctaLabel}
      </Link>
      <p className="mt-2 text-center text-xs text-ink/45">
        Upgrade to Pro anytime for your complete profile, full schedule, products and more.
      </p>
    </div>
  );
}

/** "What You Get" — a compact 2x2 product demonstration.
 *
 * /Join Final Visual Conversion pass — replaces four flat gray text tiles.
 * Business Profile and Findmi Here reuse the exact same real proof
 * business/appearance fetched once above (CompactCard — the existing
 * "dense row" pattern already used by the homepage's own secondary rows —
 * for the profile; a compact NEXT UP-style chip for the schedule).
 * Products & Services reuses ProductCard with a real active product when
 * one exists. Events has no cheap single-query "one real event for this
 * business" data source today, so it uses a plain, truthful generic tile
 * (no specific event/date invented) — exactly the fallback this pass's
 * own instructions call for when live data isn't naturally available.
 * Every tile shares one outer frame so the grid stays visually even
 * regardless of which real component renders inside it. */
function WhatYouGetGrid({
  business,
  appearance,
  product,
}: {
  business: BusinessWithCategories | null;
  appearance: NextAppearanceHint | null;
  product: Product | null;
}) {
  const profileMeta = business
    ? [business.categories[0]?.name, cityState(business.city, business.state)].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <DemoTile label="Business Profile">
        {business ? (
          <CompactCard
            href={`/business/${business.slug}`}
            image={business.cover_image_url ?? business.logo_url}
            title={business.name}
            meta={profileMeta || undefined}
            cta="View Profile"
          />
        ) : (
          <GenericTile
            icon={<TagGlyph className="h-5 w-5 text-findmi-700" />}
            detail="Your story, photos, categories and contact information in one place."
          />
        )}
      </DemoTile>

      <DemoTile label="Products & Services">
        {product ? (
          <div className="mx-auto max-w-[180px]">
            <ProductCard product={product} />
          </div>
        ) : (
          <GenericTile
            icon={<TagGlyph className="h-5 w-5 text-findmi-700" />}
            detail="A catalog customers can browse — and buy where enabled."
          />
        )}
      </DemoTile>

      <DemoTile label="Findmi Here">
        {appearance ? (
          <div className="flex items-start gap-2 rounded-xl bg-findmi-50 px-3 py-2.5">
            <CalendarGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
            <p className="text-xs text-ink">
              <span className="mr-1 font-bold uppercase tracking-wide text-findmi-700">Next Up</span>
              <span className="font-semibold">{appearance.venue}</span> · {formatDateShort(appearance.startAt)}
            </p>
          </div>
        ) : (
          <GenericTile
            icon={<CalendarGlyph className="h-5 w-5 text-findmi-700" />}
            detail="Your upcoming appearances so customers always know where you'll be next."
          />
        )}
      </DemoTile>

      <DemoTile label="Events">
        <GenericTile
          icon={<EventsGlyph className="h-5 w-5 text-findmi-700" />}
          detail="Connect your business to the markets, pop-ups and events where you're participating."
        />
      </DemoTile>
    </div>
  );
}

function DemoTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink/40">{label}</p>
      {children}
    </div>
  );
}

function GenericTile({ icon, detail }: { icon: React.ReactNode; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-mist/40 px-3 py-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-xs text-ink/60">{detail}</p>
    </div>
  );
}

/** Regional/National — a secondary sales pathway, compressed so it doesn't
 * out-weigh the core $99 conversion. Still resolved via the same
 * resolveJoinCard()/admin form as every other card — only this bespoke,
 * now-compressed public presentation is new. */
function RegionalSection({ card }: { card: ResolvedJoinCard }) {
  const { eyebrow, title, tagline, features, ctaLabel, ctaUrl } = card;
  return (
    <div className="rounded-3xl border border-black/10 bg-mist/40 p-6 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">{eyebrow}</p>
      <h3 className="mt-1.5 font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h3>
      <p className="mt-2 max-w-2xl text-sm text-ink/60">{tagline}</p>
      {/* /Join Final Visual Conversion pass — the 5-item checklist is now
          one compressed inline line instead of five full-height rows. */}
      <p className="mt-2 max-w-2xl text-xs text-ink/45">{features.join(" · ")}</p>

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
        <ProInviteCodeEntry returnTo="/join" heading="" />
      </div>
    </details>
  );
}

/** Final Conversion Section — the page always ends on a conversion
 * action. Reuses the exact same CTA destinations as the Hero, with the
 * same quiet secondary-action hierarchy. */
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

        <div className="mt-6 flex flex-col items-center gap-4">
          <a
            href={proCtaHref}
            className="flex h-12 w-full max-w-xs items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Get Findmi Pro — $99/year
          </a>
          <SecondaryActions freeCtaHref={freeCtaHref} claim={claim} align="center" />
        </div>
      </div>
    </div>
  );
}
