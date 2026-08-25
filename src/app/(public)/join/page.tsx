import type { Metadata } from "next";

// Launch-simplification pass — Stripe checkout/onboarding is intentionally
// disabled from this public page for the first few days after launch (see
// the pass report). PlanCheckoutForm, join/actions.ts's
// startMembershipCheckout, lib/commerce/membershipCheckout.ts/
// membershipActivation.ts, and /join/success are all preserved untouched
// and fully working — this page just no longer imports or links to them.
// Reactivating automated payment later is a matter of restoring the plan-
// picker section below (git history has the exact prior version) rather
// than rebuilding anything.
const JOIN_FORM_URL = "https://tally.so/r/0QR7LN";

export const metadata: Metadata = {
  title: "Join FindMi",
  description: "Get discovered on FindMi — tell us about your business or event and we'll be in touch.",
};

const DISCOVERY_PRO_FEATURES = [
  "Full FindMi Business Profile",
  "Products & offerings",
  "Unlimited upcoming Appearances / “FindMi Here”",
  "Local discovery visibility",
  "Event and market connections",
  "Business gallery",
  "Follow + Save",
  "Business bulletin / updates",
  "Smart schedule importing & setup support",
  "Profile updates and support",
];

const EVENTS_FEATURES = [
  "FindMi Event page",
  "Event discovery",
  "Participating businesses/vendors",
  "Vendor Appearance connections",
  "Event details and links",
  "Visibility within FindMi discovery",
];

const MULTI_REGION_FEATURES = [
  "Multiple regions/markets",
  "Multi-location support",
  "Touring / traveling brand support",
  "Expanded FindMi presence",
  "Event/campaign opportunities",
  "Custom onboarding and support",
];

export default function JoinPage() {
  return (
    <div>
      {/* Hero — short, one core message, not a long pitch before the
          actual options. */}
      <div className="mx-auto max-w-4xl px-6 pt-14 sm:pt-16">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            Get discovered on FindMi.
          </h1>
          <p className="mt-3 text-base text-ink/60">
            Choose how you&rsquo;d like to join, tell us a bit about you, and we&rsquo;ll follow up to get
            you set up.
          </p>
        </div>
      </div>

      {/* The three options — appear early, not buried under marketing copy. */}
      <div id="options" className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10">
        <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
          <PlanCard
            emphasis
            eyebrow="For businesses"
            title="Discovery Pro"
            price="$99"
            priceSuffix="/year"
            tagline="Your FindMi presence for local discovery."
            features={DISCOVERY_PRO_FEATURES}
            ctaLabel="Join FindMi"
          />
          <PlanCard
            eyebrow="For events"
            title="Events & Markets"
            price="Partner Listing"
            tagline="Hosting something people should discover? List your event, connect participating businesses, and help people discover what's happening and who's going to be there."
            features={EVENTS_FEATURES}
            ctaLabel="List an Event"
          />
          <PlanCard
            eyebrow="For larger brands"
            title="Multi-Region / National"
            price="Custom"
            tagline="For larger brands, touring businesses, organizations, and multi-location concepts that need broader coverage."
            features={MULTI_REGION_FEATURES}
            ctaLabel="Talk to FindMi"
          />
        </div>

        {/* Not hiding pricing, just being upfront that this step doesn't
            collect payment — a plain, welcoming line, not an "apply for
            approval" framing. */}
        <p className="mx-auto mt-6 max-w-md text-center text-sm text-ink/50">
          No payment today. Tell us about your business or event and we&rsquo;ll contact you to
          complete your FindMi setup.
        </p>
      </div>

      {/* Show the product — real FindMi visual language, a link to an
          actual live profile rather than a fabricated mockup. */}
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">What you get</p>
        <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          One FindMi page. Everything a customer needs.
        </h2>

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

        <a
          href="/business/the-native-rose"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
        >
          See a real FindMi profile: The Native Rose <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}

function PlanCard({
  emphasis,
  eyebrow,
  title,
  price,
  priceSuffix,
  tagline,
  features,
  ctaLabel,
}: {
  emphasis?: boolean;
  eyebrow: string;
  title: string;
  price: string;
  priceSuffix?: string;
  tagline: string;
  features: string[];
  ctaLabel: string;
}) {
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
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-ink/70">
            <CheckGlyph />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Same-tab, plain external link — a lead-capture form, not a site
          the visitor needs to keep this tab open to come back to. */}
      <a
        href={JOIN_FORM_URL}
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
