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
// so the same card component can render every founder-editable CMS card
// (Events & Markets, Multi-Region — Pro now uses its own ProCard below).
type PlanCardData = Pick<
  ResolvedJoinCard,
  "eyebrow" | "title" | "price" | "priceSuffix" | "tagline" | "features" | "ctaLabel" | "ctaUrl" | "emphasis"
>;

// The one core Free/Pro business-acquisition path — never Tally. Pro
// intent survives sign-in via the existing safe `next` redirect
// mechanism (see account/business/new/page.tsx and lib/auth/
// safe-redirect.ts) — no new auth/session infrastructure.
const PRO_NATIVE_CTA_URL = "/account/business/new?plan=pro";
// Pro Positioning pass — this pass's own exact requested CTA wording.
// Same override pattern the previous pass already established for
// ctaUrl: the founder's own cta_label admin field stops being what
// renders for this one card, everything else they edit (heading, price,
// tagline, features, emphasis) still does.
const PRO_CTA_LABEL = "Get FindMi Pro";

export default async function JoinPage() {
  const overrides = await getJoinPageSections();

  const hero = resolveJoinHero(overrides);
  const global = resolveJoinGlobal(overrides);

  // Pro Positioning pass — the Pro card (card_discovery_pro) is the one
  // core Free/Pro business-acquisition path, so its CTA must always lead
  // into the native account/business/new creation flow with Pro intent
  // preserved (see that page's own `plan` param) with this pass's exact
  // requested CTA wording — never back through the founder-editable
  // Tally CTA URL/label every other non-core card here still legitimately
  // uses (Events & Markets, Multi-Region/National — untouched, still
  // resolve to their own CMS/global cta_url exactly as before). Every
  // other Pro field (heading, price, tagline, features, emphasis) stays
  // fully founder-editable via the CMS as before — only this one card's
  // CTA destination/label is now fixed in code.
  const allCards = JOIN_CARD_KEYS.map((key) => resolveJoinCard(overrides, key, global.ctaUrl)).map((c) =>
    c.key === "card_discovery_pro" ? { ...c, ctaUrl: PRO_NATIVE_CTA_URL, ctaLabel: PRO_CTA_LABEL } : c
  );
  const cards = allCards.filter((c) => c.visible);
  const proCard = cards.find((c) => c.key === "card_discovery_pro") ?? null;
  const secondaryCards = cards.filter((c) => c.key !== "card_discovery_pro");
  const whatYouGet = resolveJoinWhatYouGet(overrides);

  // The options section (Pro, then Free directly below it, always
  // present, plus whichever secondary cards are enabled) always renders,
  // so whichever section actually renders last needs to own the page's
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
          Pro Positioning pass: Pro is the dominant first offer (its own
          larger ProCard, FindMi Here spotlighted inside it), Free is a
          small, quiet "basic index" option directly below it — not a
          second competing card. Whichever other founder-editable cards
          (Events & Markets, Multi-Region) are enabled follow further
          below as secondary options, unchanged. */}
      <div
        id="options"
        className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10 ${optionsIsLastSection ? "pb-16 sm:pb-20" : ""}`}
      >
        {proCard && (
          <div className="mx-auto max-w-xl">
            <ProCard card={proCard} />
          </div>
        )}

        {/* Free — static copy, not a CMS-driven card (see this pass's
            own report on what would need a later admin-editability
            pass). Always shown, genuinely selectable on its own. */}
        <div className="mx-auto mt-4 max-w-xl">
          <FreeBasicBox />
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

/** Pro Positioning pass — Pro's own dominant presentation, distinct from
 * the shared PlanCard (still used for the quieter secondary cards
 * below). Every field except ctaLabel/ctaUrl (overridden above, same
 * pattern the previous pass introduced) still comes straight from the
 * founder-editable CMS card exactly as PlanCard rendered it — this only
 * changes layout/emphasis, and adds one new static block (FindMi Here)
 * that isn't part of the founder's own content. Presentation only: the
 * actual FindMi Here feature/code is completely untouched. */
function ProCard({ card }: { card: ResolvedJoinCard }) {
  const { eyebrow, title, price, priceSuffix, tagline, features, ctaLabel, ctaUrl } = card;
  return (
    <div className="flex flex-col rounded-3xl border border-findmi/40 bg-white p-6 shadow-[0_4px_24px_rgba(20,176,188,0.14)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>
      <h3 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h3>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tracking-tight text-ink">{price}</span>
        {priceSuffix && <span className="text-sm font-medium text-ink/45">{priceSuffix}</span>}
      </p>
      <p className="mt-2.5 text-sm text-ink/60">{tagline}</p>

      {/* FindMi Here — the featured Pro benefit, spotlighted rather than
          buried as one generic bullet among many. */}
      <div className="mt-5 rounded-2xl bg-findmi-50 p-4 sm:p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Featured with Pro</p>
        <h4 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">FindMi Here</h4>
        <p className="mt-1 text-sm font-semibold text-ink/80">Show people where to find you next.</p>
        <p className="mt-1.5 text-sm text-ink/60">
          Add your upcoming markets, pop-ups, events and appearances so customers can see exactly where
          you&rsquo;ll be next.
        </p>
      </div>

      {/* Every other current Pro benefit — the founder's own CMS list,
          unchanged data, shown quietly beneath the spotlight above
          rather than at equal visual weight. */}
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
    </div>
  );
}

/** Pro Positioning pass — Free's new small, quiet "basic index"
 * presentation: static copy (Free isn't a CMS card, same as before this
 * pass), an accessible native <details>/<summary> disclosure (no client
 * JS needed — this stays a server component) showing what's included
 * vs. what requires Pro. FindMi Here appears here too, muted/struck
 * through, so the comparison is consistent with ProCard's spotlight
 * above. */
function FreeBasicBox() {
  return (
    <div className="rounded-2xl border border-black/10 bg-mist/40 p-4 sm:p-5">
      <p className="text-sm font-semibold text-ink/70">Just need a basic listing?</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-bold text-ink">Free Basic Index</span>
        <span className="text-sm text-ink/45">· $0</span>
      </p>
      <p className="mt-1.5 text-sm text-ink/60">Get your name, logo, category and short description into FindMi.</p>

      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink/50 [&::-webkit-details-marker]:hidden">
          View what&rsquo;s included
          <ChevronGlyph className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Included</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink/70">
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Business name + logo</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Category</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Short description</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Basic index listing</span>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Requires Pro</p>
            {/* Tasteful, not aggressive: muted text + line-through, same
                small size as the Included column, no red/warning color. */}
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink/35 line-through decoration-ink/25">
              <li>Full About section</li>
              <li>Gallery</li>
              <li>Website + social links</li>
              <li>FindMi Here</li>
              <li>Business updates</li>
            </ul>
          </div>
        </div>
      </details>

      <a
        href="/account/business/new"
        className="mt-4 flex h-11 items-center justify-center rounded-full border border-black/10 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
      >
        Start with Basic
      </a>
    </div>
  );
}

function ChevronGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`h-3.5 w-3.5 shrink-0 text-ink/40 ${className}`}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
