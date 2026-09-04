import type { Metadata } from "next";
import Link from "next/link";
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

  // The options section (Free, then Pro directly below it, always
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
          Mobile Hierarchy pass: Free's compact, quiet box now renders
          FIRST (mobile scan order), directly followed by the dominant
          FindMi Pro card — still unmistakably the primary paid/product
          experience, just no longer literally first on screen. Free
          stays small/secondary-looking; it did not get visually
          stronger, only reordered. Whichever other founder-editable
          cards (Events & Markets, Multi-Region) are enabled follow
          further below as secondary options, unchanged. */}
      <div
        id="options"
        className={`mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10 ${optionsIsLastSection ? "pb-16 sm:pb-20" : ""}`}
      >
        {/* Conversion Completion pass — one shared, quiet reassurance
            note, read once before either choice below. Not repeated per
            card, not phrased as a warning, and says nothing about
            payment/approval — just sets expectations honestly. */}
        <p className="mx-auto max-w-xl text-center text-xs text-ink/40">
          New Listings Are Reviewed Before Appearing Publicly.
        </p>

        {/* Free — static copy, not a CMS-driven card (see this pass's
            own report on what would need a later admin-editability
            pass). Always shown, genuinely selectable on its own. */}
        <div className="mx-auto mt-4 max-w-xl">
          <FreeBasicBox />
        </div>

        {proCard && (
          <div className="mx-auto mt-4 max-w-xl">
            <ProCard card={proCard} />
          </div>
        )}

        {/* Conversion Completion pass — secondary escape hatch for a
            business that's already on FindMi (added by the founder, or
            by another member). Reuses the existing public discovery
            page (/businesses) — every result there links into that
            business's real profile, where the existing ClaimButton
            claim flow already lives (business/[slug]/page.tsx). No new
            claim flow, no new route. Deliberately quiet/secondary —
            plain text link, not a button, not styled like Free/Pro. */}
        <p className="mx-auto mt-6 max-w-xl text-center text-sm text-ink/50">
          Already listed on FindMi?{" "}
          <Link href="/businesses" className="font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Claim your business →
          </Link>
        </p>

        {secondaryCards.length > 0 && (
          <div className="mt-10">
            <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/35">More Ways To Join FindMi</p>
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
 * below). Copy Compression pass — `eyebrow` is deliberately no longer
 * rendered here (the founder's "Small label above the title" admin
 * field still exists/is still editable, it just isn't displayed on this
 * one card, same situation ctaLabel/ctaUrl were already in from an
 * earlier pass). `title`, `priceSuffix`, `tagline` and `features`
 * remain fully CMS-driven and UNCHANGED here — this pass does not
 * hardcode over founder content; see this pass's own report for the
 * exact current values vs. the requested replacement values for each.
 * Presentation only: the actual FindMi Here feature/code is completely
 * untouched. */
function ProCard({ card }: { card: ResolvedJoinCard }) {
  const { title, price, priceSuffix, tagline, features, ctaLabel, ctaUrl } = card;
  return (
    <div className="flex flex-col rounded-3xl border border-findmi/40 bg-white p-6 shadow-[0_4px_24px_rgba(20,176,188,0.14)] sm:p-8">
      <h3 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h3>
      {/* Final Conversion Consistency pass — this pass's own "Core
          positioning" line, new static content (title/price/priceSuffix/
          tagline/features stay fully CMS-driven, unchanged). */}
      <p className="mt-1 text-sm text-ink/60">Build Out Your Complete FindMi Presence.</p>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold tracking-tight text-ink">{price}</span>
        {priceSuffix && <span className="text-sm font-medium text-ink/45">{priceSuffix}</span>}
      </p>
      <p className="mt-1 text-xs text-ink/40">No Automatic Renewal.</p>

      {/* Mobile Hierarchy pass — FindMi Here leads, directly under price
          and ahead of the general description below, so it's the first
          thing read about Pro rather than something discovered partway
          down the card. Copy Compression pass — no eyebrow above it
          anymore, and the copy no longer implies FindMi itself features
          the business. Final Conversion Consistency pass — the
          supporting line no longer frames "adding appearances" as the
          Pro-exclusive benefit (Free can do that too, Passes 1-2); the
          real Pro-exclusive distinction is the full schedule showing
          publicly, vs. Free's next-1-only public profile (Pass 2). */}
      <div className="mt-4 rounded-2xl bg-findmi-50 p-4 sm:p-5">
        <h4 className="font-display text-lg font-bold tracking-tight text-ink">FindMi Here</h4>
        <p className="mt-1 text-sm font-semibold text-ink/80">Show Customers Where To Find You Next.</p>
        <p className="mt-1.5 text-sm text-ink/60">
          Your Full Upcoming Schedule Shows On Your Public Profile — Not Just Your Next Appearance.
        </p>
      </div>

      {/* General Pro description — founder-editable CMS content
          (site_sections, page_key "join", section_key
          "card_discovery_pro", the "Description" field / `tagline`
          column in /admin/site/join). Content rendered exactly as
          entered in admin, unchanged here — see this pass's own report
          for the exact replacement text to paste in. whitespace-pre-line
          is a pure rendering fix (not a content change) so a blank line
          the founder types between paragraphs in that textarea actually
          shows as a paragraph break here instead of collapsing to one
          run-on line — the smallest safe fix, no rich text/HTML/Markdown
          introduced. */}
      <p className="mt-3 text-sm text-ink/60 whitespace-pre-line">{tagline}</p>

      {/* Every other current Pro benefit — the founder's own CMS list
          (same admin section, "What's included (feature list)" field),
          unchanged data, shown quietly beneath the spotlight/description
          above rather than at equal visual weight. Not hardcoded here —
          see this pass's own report for the exact admin field to
          shorten it in. */}
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
      {/* Conversion Completion pass — concise payment reassurance right
          under the CTA. Matches the actual native Pro checkout exactly:
          a one-time Stripe payment (createBusinessProCheckoutSession,
          untouched), never called a subscription, no renewal price
          stated since none is finalized. */}
      <p className="mt-2 text-center text-xs text-ink/40">$99 For One Year Of FindMi Pro.</p>
    </div>
  );
}

/** Pro Positioning / Mobile Hierarchy / Free Positioning / Final
 * Conversion Consistency passes — Free's small, quiet "basic index"
 * presentation: static copy (Free isn't a CMS card, same as before), an
 * accessible native <details>/<summary> disclosure (no client JS needed
 * — this stays a server component) showing what's included vs. what
 * requires Pro. Renders FIRST on the page; container/sizing/weight are
 * unchanged, so it's still visually quieter/smaller than Pro, not a
 * second competing card. Final Conversion Consistency pass — copy now
 * names the ACTUAL current distinction: Free can add/manage unlimited
 * appearances (Passes 1-2) and its own public profile shows its next 1
 * (Pass 2), and it may also appear on participating organizers' event
 * pages (Who You'll Find Here — see CLAUDE.md's locked product
 * language); Pro's distinction is showing the FULL upcoming schedule
 * publicly, plus gallery/products/full profile/outbound links.
 * Presentation only — no permissions/features changed. */
function FreeBasicBox() {
  return (
    <div className="rounded-2xl border border-black/10 bg-mist/40 p-4 sm:p-5">
      {/* Typography Polish pass — "Free" and "$0" now match the Pro
          card's price treatment (font-display, bold, tracking-tight,
          text-ink) instead of reading as small/light body text next to
          Pro's prominent "$99". Sized text-2xl (vs. Pro's text-3xl) —
          reuses the same size PlanCard already uses for its own price —
          so the card stays visually quieter than Pro overall while the
          price itself no longer looks like an afterthought. $0/meaning
          unchanged. */}
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-2xl font-bold tracking-tight text-ink">Free</span>
        <span className="text-sm text-ink/40">·</span>
        <span className="font-display text-2xl font-bold tracking-tight text-ink">$0</span>
      </p>
      <p className="mt-1 text-sm font-semibold text-ink/70">Get Your Business On FindMi.</p>
      <p className="mt-1.5 text-sm text-ink/60">
        Create Your Basic Profile And Appear On Event Pages When Participating Organizers Add Your Business.
      </p>

      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink/50 [&::-webkit-details-marker]:hidden">
          View What&rsquo;s Included
          <ChevronGlyph className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Included</p>
            {/* Final Conversion Consistency pass — Free CAN add/manage
                unlimited appearances (Passes 1-2); its public profile
                just shows only the next 1 (Pass 2). That distinction —
                not "no appearances" — is what belongs here and in
                Requires Pro below. */}
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink/70">
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Logo + Cover Image &amp; Basic Profile</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Show Your Next Upcoming Appearance</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>Appear On Participating Event/Vendor Rosters</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckGlyph />
                <span>FindMi Search &amp; Discovery</span>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Requires Pro</p>
            {/* Tasteful, not aggressive: muted text + line-through, same
                small size as the Included column, no red/warning color.
                "Full upcoming schedule" (not "FindMi Here") — Free
                already gets FindMi Here, just limited to its next 1. */}
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink/35 line-through decoration-ink/25">
              <li>Full Upcoming Schedule</li>
              <li>Gallery</li>
              <li>Products &amp; Services</li>
              <li>Website &amp; Social Links</li>
              <li>Full Business Profile</li>
            </ul>
          </div>
        </div>
      </details>

      {/* Final Conversion Consistency pass — the old footnote here
          ("Want to add where you'll be next? Upgrade to Pro.") was
          removed: it's now FALSE — Free can add/manage unlimited
          appearances (Passes 1-2). The accurate Free/Pro distinction
          (next-1 vs. full schedule) is already stated in the Included/
          Requires Pro comparison above; no replacement note needed. */}
      <Link
        href="/account/business/new"
        className="mt-4 flex h-11 items-center justify-center rounded-full border border-black/10 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/20"
      >
        Start with Basic
      </Link>
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
