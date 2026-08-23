import type { Metadata } from "next";
import Link from "next/link";
import EventCard from "@/components/EventCard";
import Section, { HorizontalScroller } from "@/components/Section";
import { attachEventCategories, getEventsDiscovery, getFeaturedEvents, getHomeCategories } from "@/lib/data";
import { groupByCategory } from "@/lib/curation";
import type { DiscoveryWindow } from "@/lib/format";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming markets, pop-ups, and events on FindMi.",
};

const WINDOWS: { value: DiscoveryWindow; label: string }[] = [
  { value: "now", label: "Today" },
  { value: "weekend", label: "This Weekend" },
  { value: "next", label: "Next Week" },
  { value: "month", label: "This Month" },
  { value: "anytime", label: "All Events" },
];

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ when?: string; date?: string; q?: string; category?: string }>;
}) {
  const { when: whenParam, date, q, category } = await searchParams;
  const when: DiscoveryWindow = WINDOWS.some((w) => w.value === whenParam) ? (whenParam as DiscoveryWindow) : "anytime";
  const filtering = Boolean(date || q || category || whenParam);

  const [featured, results, categories] = await Promise.all([
    filtering ? Promise.resolve([]) : getFeaturedEvents(8),
    getEventsDiscovery({ when, date, q, categorySlug: category, limit: 60 }),
    getHomeCategories(),
  ]);

  // Curated rows only render once the founder has tagged real events with
  // real categories — event_categories starts empty, so these naturally
  // stay hidden until that happens (no fabricated taxonomy).
  const categoryRows = filtering
    ? []
    : groupByCategory(await attachEventCategories(results), categories, { minPerRow: 2, limitPerRow: 8 });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Events</h1>
      <p className="mt-2 text-ink/60">Markets, pop-ups, and festivals — and who you&rsquo;ll find here.</p>

      <form method="get" className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search events"
          className="flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
        />
        <input
          type="date"
          name="date"
          defaultValue={date}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink focus:border-ink/30 focus:outline-none sm:w-44"
        />
        {categories.length > 0 && (
          <select
            name="category"
            defaultValue={category ?? ""}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-ink focus:border-ink/30 focus:outline-none sm:w-48"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-findmi px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.value}
            href={w.value === "anytime" ? "/events" : `/events?when=${w.value}`}
            className={`rounded-full px-4 py-2 text-sm font-bold uppercase tracking-wide transition ${
              when === w.value && !date && !q && !category
                ? "bg-findmi text-white"
                : "border border-black/10 text-ink/70 hover:border-ink/30"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {!filtering && featured.length > 0 && (
        <div className="-mx-6 mt-6">
          <Section title="Featured Events">
            <HorizontalScroller>
              {featured.map((e) => (
                <div key={e.id} className="w-64 shrink-0">
                  <EventCard event={e} />
                </div>
              ))}
            </HorizontalScroller>
          </Section>
        </div>
      )}

      {!filtering &&
        categoryRows.map(({ category: cat, items }) => (
          <div key={cat.id} className="-mx-6">
            <Section title={cat.name} viewAllHref={`/events?category=${cat.slug}`}>
              <HorizontalScroller>
                {items.map((e) => (
                  <div key={e.id} className="w-64 shrink-0">
                    <EventCard event={e} />
                  </div>
                ))}
              </HorizontalScroller>
            </Section>
          </div>
        ))}

      <div className="mt-8">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink">
          {filtering ? "Results" : "All Events"}
        </h2>
        {results.length === 0 ? (
          <p className="mt-6 text-sm text-ink/50">
            {when === "anytime" && !q && !date && !category
              ? "No upcoming events yet — check back soon."
              : "Nothing matched — try All Events."}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {results.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
