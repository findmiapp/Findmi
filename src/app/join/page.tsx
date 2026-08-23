import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join FindMi",
  description:
    "One place for what you sell, where you'll be next, and how customers can reach you. Join the FindMi Founding 500 for $99/year.",
};

const features = [
  "FindMi business profile",
  "Products and services",
  "Gallery",
  "Where I'll Be Next",
  "Unlimited appearance cards",
  "FindMi discovery inclusion",
  "Customer inquiry and booking forms",
  "Eligibility for FindMi opportunities",
  "Performance insights later",
  "Concierge profile setup",
  "Founding pricing retained while continuously subscribed",
];

export default function JoinPage() {
  const stripeLink = process.env.NEXT_PUBLIC_STRIPE_FOUNDING_LINK ?? "";

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
          Be easier to find.
        </h1>
        <p className="mt-4 text-lg text-ink/60">
          Your business changes locations. Your customers shouldn&rsquo;t have to search five
          different places to figure out where you&rsquo;ll be next.
        </p>
      </div>

      <div className="mt-12 grid gap-8 rounded-3xl border border-black/10 bg-white p-8 sm:p-10 md:grid-cols-[1fr,auto] md:items-start">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-ink">
            FindMi Founding 500
          </p>
          <p className="mt-2 flex items-baseline gap-1">
            <span className="font-display text-4xl font-bold tracking-tight text-ink">$99</span>
            <span className="text-ink/50">/year</span>
          </p>
          <p className="mt-1 text-sm text-ink/50">
            Locked in for as long as your membership stays active.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink/75">
                <CheckGlyph />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3 md:w-56">
          {stripeLink ? (
            <a
              href={stripeLink}
              className="rounded-full bg-findmi px-6 py-3.5 text-center text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
            >
              Join the Founding 500
            </a>
          ) : (
            <button
              disabled
              className="rounded-full bg-ink/20 px-6 py-3.5 text-center text-sm font-semibold text-white/70"
            >
              Join the Founding 500
            </button>
          )}
          <p className="text-center text-xs text-ink/40">
            Secure checkout via Stripe. Cancel anytime.
          </p>
        </div>
      </div>

      <div className="mt-16 grid gap-8 sm:grid-cols-3">
        <div>
          <p className="text-sm font-semibold text-ink">One profile</p>
          <p className="mt-1 text-sm text-ink/60">
            Your products, services, gallery, and story — all in one FindMi page.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Where you&rsquo;ll be next</p>
          <p className="mt-1 text-sm text-ink/60">
            Post unlimited appearance cards so customers always know where to find you.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">Real inquiries</p>
          <p className="mt-1 text-sm text-ink/60">
            Booking and inquiry forms built in, so customers can reach you directly.
          </p>
        </div>
      </div>
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
