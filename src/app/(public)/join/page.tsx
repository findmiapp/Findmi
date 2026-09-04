import type { Metadata } from "next";
import {
  JOIN_CARD_KEYS,
  getJoinPageSections,
  resolveJoinCard,
  resolveJoinGlobal,
  resolveJoinHero,
  resolveJoinWhatYouGet,
  type ResolvedJoinCard,
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
// value below now comes from lib/join-page.ts's resolve*() helpers, which
// read founder overrides (site_sections, page_key "join") and fall back to
// the exact hardcoded defaults that shipped in the launch-simplification
// pass. /join renders identically to before when no overrides exist yet.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Join FindMi",
  description: "Get discovered on FindMi — tell us about your business or event and we'll be in touch.",
};

// Join + Add Business Plan UX Alignment pass — the fields PlanCard
// actually renders, factored out of ResolvedJoinCard (lib/join-page.ts)
// so the same card component can render both a founder-editable CMS card
// (Pro, Events & Markets, Multi-Region) and the static Free card below,
// which intentionally isn't CMS-driven — Free is a real, permanent plan,
// not admin-hideable marketing content.
type PlanCardData = Pick<
  ResolvedJoinCard,
  "eyebrow" | "title" | "price" | "priceSuffix" | "tagline" | "features" | "ctaLabel" | "ctaUrl" | "emphasis"
>;

// The one core Free/Pro business-acquisition path — never Tally. Pro
// intent survives sign-in via the existing safe `next` redirect
// mechanism (see account/business/new/page.tsx and lib/auth/
// safe-redirect.ts) — no new auth/session infrastructure.
const PRO_NATIVE_CTA_URL = "/account/business/new?plan=pro";

// Free copy matches this pass's exact requested wording — only CURRENT
// real Free entitlements (see account/business/actions.ts's
// FREE_ALLOWED_COLUMNS and account/business/new/page.tsx's own Free
// bullets), nothing promised here that doesn't already exist. Free
// itself needs no `?plan=` param — free is already the Add Business
// form's own default selection.
const FREE_CARD: PlanCardData = {
  eyebrow: "Free",
  title: "Basic Index",
  price: "$0",
  priceSuffix: null,
  tagline: "A simple way to get your business onto FindMi.",
  features: [
    "Business name, logo and category",
    "Short business description",
    "Basic FindMi listing",
    "Manage your listing",
    "Appear in relevant event/vendor contexts where applicable",
    "Upgrade to Pro anytime",
  ],
  ctaLabel: "Start Free",
  ctaUrl: "/account/business/new",
  emphasis: false,
};

export default async function JoinPage() {
  const overrides = await getJoinPageSections();

  const hero = resolveJoinHero(overrides);
  const global = resolveJoinGlobal(overrides);

  // Join + Add Business Plan UX Alignment pass — the Pro card
  // (card_discovery_pro) is the one core Free/Pro business-acquisition
  // path, so its CTA must always lead into the native
  // account/business/new creation flow with Pro intent preserved (see
  // that page's own `plan` param), never back through the founder-
  // editable Tally CTA URL every other non-core card here still
  // legitimately uses (Events & Markets, Multi-Region/National —
  // untouched, still resolve to their own CMS/global cta_url exactly as
  // before). Every other Pro field (heading, price, tagline, features,
  // emphasis) stays fully founder-editable via the CMS as before — only
  // this one card's destination is now fixed in code.
  const allCards = JOIN_CARD_KEYS.map((key) => resolveJoinCard(overrides, key, global.ctaUrl)).map((c) =>
    c.key === "card_discovery_pro" ? { ...c, ctaUrl: PRO_NATIVE_CTA_URL } : c
  );
  const cards = allCards.filter((c) => c.visible);
  const proCard = cards.find((c) => c.key === "card_discovery_pro") ?? null;
  const secondaryCards = cards.filter((c) => c.key !== "card_discovery_pro");
  // Free is a real, permanent plan now (not admin-toggleable here, same
  // as it isn't a Tally-driven CMS card at all) — it and Pro are always
  // shown together as the two main ways a normal business joins FindMi,
  // regardless of which of the other founder-editable cards are enabled.
  const primaryCards: PlanCardData[] = proCard ? [FREE_CARD, proCard] : [FREE_CARD];
  const whatYouGet = resolveJoinWhatYouGet(overrides);

  // The options section (primary Free/Pro pair, always present, plus
  // whichever secondary cards are enabled) now always renders, so
  // whichever section actually renders last needs to own the page's
  // closing bottom padding itself — otherwise hiding "What you get"
  // leaves the page ending abruptly with no space before the footer.
  const optionsIsLastSection = !whatYouGet.visible;

  return (
    <div>
      {/* Hero — short, one core message, not a long pitch before the
          actual options. Options always render now (Free is permanent),
          so the hero never needs to own the page's closing padding. */}
      <div className="mx-auto max-w-4xl px-6 pt-14 sm:pt-16">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            {hero.heading}
          </h1>
          <p className="mt-3 text-base text-ink/60">{hero.body}</p>
        </div>
      </div>

      {/* The options — appear early, not buried under marketing copy.
          Free + Pro (the two main ways a normal business joins) always
          appear together as their own prominent pair first; whichever
          other founder-editable cards (Events & Markets, Multi-Region)
          are enabled follow below as secondary options, unchanged. */}
      <div
        id="options"
        className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10 ${optionsIsLastSection ? "pb-16 sm:pb-20" : ""}`}
      >
        <div
          className={
            primaryCards.length === 2
              ? "mx-auto grid max-w-3xl gap-4 sm:grid-cols-2 sm:items-stretch"
              : "mx-auto max-w-md"
          }
        >
          {primaryCards.map((c, i) => (
            <PlanCard key={i} card={c} />
          ))}
        </div>

        {secondaryCards.length > 0 && (
          <div className="mt-10">
            <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/35">More ways to join FindMi</p>
            <div className="mt-4">
              <CardGrid cards={secondaryCards} />
            </div>
          </div>
        )}

        {/* Not hiding pricing, just being upfront that this step doesn't
            collect payment — a plain, welcoming line, not an "apply for
            approval" framing. */}
        <p className="mx-auto mt-6 max-w-md text-center text-sm text-ink/50">{global.message}</p>
        {global.supportingText && (
          <p className="mx-auto mt-1.5 max-w-md text-center text-sm text-ink/50">{global.supportingText}</p>
        )}
      </div>

      {/* Show the product — real FindMi visual language, a link to an
          actual live profile rather than a fabricated mockup. */}
      {whatYouGet.visible && (
        <div className="mx-auto max-w-4xl px-6 py-16">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{whatYouGet.eyebrow}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {whatYouGet.heading}
          </h2>
          {whatYouGet.body && <p className="mt-2 text-sm text-ink/60">{whatYouGet.body}</p>}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <PreviewTile
              label="Business Profile"
              detail="Your story, photos, categories, and contact info in one place."
            />
            <PreviewTile
              label="Products & Services"
              detail="A real catalog customers can browse — and buy, where you enable it."
            />
            <PreviewTile
              label="FindMi Here"
              detail="Appearance cards so customers always know where you'll be next."
            />
            <PreviewTile
              label="Events"
              detail="Join markets and pop-ups as a participating, featured vendor."
            />
          </div>

          {whatYouGet.ctaUrl && (
            <a
              href={whatYouGet.ctaUrl}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
            >
              {whatYouGet.ctaLabel} <span aria-hidden>→</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Picks a grid/width that keeps the enabled cards feeling intentional at
 * every count — never a 3-column grid with an empty visual gap when a
 * card is temporarily hidden in admin. Tailwind classes are written out in
 * full (not templated) so the JIT scanner can find them. */
function CardGrid({ cards }: { cards: ResolvedJoinCard[] }) {
  if (cards.length === 1) {
    return (
      <div className="mx-auto max-w-md">
        <PlanCard card={cards[0]} />
      </div>
    );
  }
  if (cards.length === 2) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2 sm:items-stretch">
        {cards.map((c) => (
          <PlanCard key={c.key} card={c} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
      {cards.map((c) => (
        <PlanCard key={c.key} card={c} />
      ))}
    </div>
  );
}

function PlanCard({ card }: { card: PlanCardData }) {
  const { emphasis, eyebrow, title, price, priceSuffix, tagline, features, ctaLabel, ctaUrl } = card;
  return (
    <div
      className={`flex flex-col rounded-3xl border bg-white p-6 ${
        emphasis ? "border-findmi/40 shadow-[0_4px_24px_rgba(20,176,188,0.12)] lg:scale-[1.02]" : "border-black/10"
      }`}
    >
      <p className={`text-xs font-bold uppercase tracking-wide ${emphasis ? "text-findmi-700" : "text-ink/40"}`}>
        {eyebrow}
      </p>
      <h3 className="mt-1.5 font-display text-xl font-bold tracking-tight text-ink">{title}</h3>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-2xl font-bold tracking-tight text-ink">{price}</span>
        {priceSuffix && <span className="text-sm font-medium text-ink/45">{priceSuffix}</span>}
      </p>
      <p className="mt-2.5 text-sm text-ink/60">{tagline}</p>

      <ul className="mt-4 flex flex-col gap-2">
        {features.map((f, i) => (
          // Index in the key too — feature bullets are founder-edited free
          // text now, so two identical lines are possible (a duplicate
          // paste, a typo), unlike the old hardcoded list where text was
          // guaranteed unique.
          <li key={`${i}-${f}`} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Same-tab, plain external link — a lead-capture form, not a site
          the visitor needs to keep this tab open to come back to. */}
      <a
        href={ctaUrl}
        className={`mt-5 flex h-12 items-center justify-center rounded-full text-sm font-bold uppercase tracking-wide transition ${
          emphasis
            ? "bg-findmi text-white hover:bg-findmi-600"
            : "border border-black/10 text-ink hover:border-black/20"
        }`}
      >
        {ctaLabel}
      </a>
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
