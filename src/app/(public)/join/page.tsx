import type { Metadata } from "next";
import Link from "next/link";
import { getActiveMarkets, getPublicMembershipPlans } from "@/lib/data";
import PlanCheckoutForm from "./PlanCheckoutForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join FindMi",
  description:
    "One place for what you sell, where you'll be next, and how customers can reach you. Join the FindMi Founding 500 for $99/year.",
};

const features = [
  "FindMi business profile",
  "Products & services listings",
  "Gallery",
  "Appearance cards — where you'll be next",
  "Event participation",
  "FindMi Here discovery",
  "Category & search discovery",
  "Customer inquiry & booking forms",
  "Followers get notified of your moves",
  "Marketplace listing for products, where enabled",
  "Concierge profile setup",
  "Founding pricing retained while continuously subscribed",
];

const audience = [
  "Brands",
  "Food trucks",
  "Makers",
  "Market vendors",
  "Mobile businesses",
  "Pop-ups",
];

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; plan?: string; cancelled?: string }>;
}) {
  const { error, plan: planParam, cancelled } = await searchParams;
  const [plans, markets] = await Promise.all([getPublicMembershipPlans(), getActiveMarkets()]);

  return (
    <div>
      {/* A. Hero */}
      <div className="mx-auto max-w-4xl px-6 pt-16">
        <div className="max-w-2xl">
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
            Be easier to find.
          </h1>
          <p className="mt-4 text-lg text-ink/60">
            Your business changes locations. Your customers shouldn&rsquo;t have to search five
            different places to figure out where you&rsquo;ll be next.
          </p>
        </div>

        <div id="plans" className="mt-12 rounded-3xl border border-black/10 bg-white p-8 sm:p-10">
          <p className="text-sm font-bold uppercase tracking-wide text-ink">
            Join FindMi
          </p>
          <p className="mt-1 text-sm text-ink/50">
            Founding 500 is FindMi&rsquo;s launch plan — $99/year, the obvious place to start.
            Growing past one market? Pro and Multi-Region are right here too.
          </p>

          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          {cancelled && !error && (
            <p className="mt-4 rounded-xl border border-black/10 bg-mist/40 px-4 py-3 text-sm text-ink/60">
              Checkout was cancelled — no charge was made.
            </p>
          )}

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink/75">
                <CheckGlyph />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {plans.length > 0 && markets.length > 0 ? (
            <div className="mt-8 border-t border-black/5 pt-8">
              <PlanCheckoutForm plans={plans} markets={markets} defaultPlanSlug={planParam} />
            </div>
          ) : (
            <p className="mt-8 text-sm text-ink/50">
              Joining isn&rsquo;t open yet — check back shortly.
            </p>
          )}
        </div>
      </div>

      {/* B. Show the product — real FindMi visual language, not stock
          illustrations, plus a link to an actual live profile rather than
          a fabricated mockup. */}
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">
          What you get
        </p>
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

        <Link
          href="/business/the-native-rose"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-findmi-700 transition hover:text-findmi-800"
        >
          See a real FindMi profile: The Native Rose <span aria-hidden>→</span>
        </Link>
      </div>

      {/* C. Core value — three pillars, visual not a plain text block. */}
      <div className="mx-auto max-w-4xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          <PillarCard
            icon={<TagGlyph />}
            title="Show what you sell"
            detail="Products, services, photos, and customer inquiries."
          />
          <PillarCard
            icon={<PinGlyph />}
            title="Show where you'll be"
            detail="Markets, pop-ups, events, and retail appearances."
          />
          <PillarCard
            icon={<SearchGlyph />}
            title="Get discovered"
            detail="FindMi Here, events, categories, search, and followers."
          />
        </div>
      </div>

      {/* D. Who it's for */}
      <div className="mx-auto max-w-4xl px-6 pb-16">
        <p className="text-sm font-semibold text-ink">Built for businesses that move</p>
        <p className="mt-2 max-w-2xl text-sm text-ink/60">
          FindMi works best for businesses whose location or availability changes — {" "}
          {audience.slice(0, -1).join(", ")}, and {audience[audience.length - 1]}.
        </p>
      </div>

      {/* E. Final CTA — matches the homepage's closing panel treatment. */}
      <div className="mx-auto max-w-4xl px-6 pb-16">
        <div className="flex flex-col items-start gap-4 rounded-3xl bg-ink px-6 py-8 text-white sm:px-10 sm:py-9">
          <p className="text-xs font-bold uppercase tracking-wide text-findmi">
            Founding 500 · $99/year
          </p>
          <h2 className="font-display max-w-lg text-xl font-semibold tracking-tight sm:text-2xl">
            Ready to be found?
          </h2>
          <p className="max-w-md text-sm text-white/70">
            Show people what you sell. Tell them where you&rsquo;ll be. Give them one place to
            keep up with you.
          </p>
          <a
            href="#plans"
            className="rounded-full bg-findmi px-6 py-3 text-center text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Join the Founding 500 — $99/year
          </a>
        </div>
      </div>
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

function PillarCard({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-findmi-50 p-5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-findmi-700">
        {icon}
      </span>
      <h3 className="mt-3 font-display text-sm font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-1.5 text-sm text-ink/60">{detail}</p>
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

function TagGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
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

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
