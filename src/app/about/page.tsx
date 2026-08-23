import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "FindMi helps you discover businesses and always know where to find them next.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        About FindMi
      </h1>
      <p className="mt-6 text-base leading-relaxed text-ink/70">
        FindMi helps you discover brands, vendors, mobile businesses, products, events,
        pop-ups, markets, and places — with one question always in mind:{" "}
        <span className="font-medium text-ink">
          &ldquo;Where can I find this business next?&rdquo;
        </span>
      </p>
      <p className="mt-4 text-base leading-relaxed text-ink/70">
        A lot of the best businesses don&rsquo;t sit still. Coffee carts, food trucks, flower
        stands, and small makers move between markets, pop-ups, and events every week. FindMi
        connects the dots: browse a business and see where they&rsquo;ll be next, or browse an
        event and see who&rsquo;s going to be there.
      </p>
      <p className="mt-4 text-base leading-relaxed text-ink/70">
        For businesses, FindMi is one home for what you sell, where you&rsquo;ll be next, and
        how customers can reach you — instead of juggling five different social posts to
        announce a location.
      </p>
      <div className="mt-10 flex gap-3">
        <Link
          href="/discover"
          className="rounded-full bg-findmi px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-ink transition hover:bg-findmi-600"
        >
          Start discovering
        </Link>
        <Link
          href="/join"
          className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          Join as a business
        </Link>
      </div>
    </div>
  );
}
