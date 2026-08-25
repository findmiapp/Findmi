import type { Metadata } from "next";
import Link from "next/link";
import HomeEventCard from "@/components/HomeEventCard";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import EventFilters from "@/components/discover/EventFilters";
import FilterSheet from "@/components/discover/FilterSheet";
import { attachEventCategories, getEventCategories, getEventsDiscovery } from "@/lib/data";
import { WINDOW_BY_TIME_KEY, type DiscoveryTimeKey } from "@/lib/format";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming markets, pop-ups, and events on FindMi.",
};
export const revalidate = 60;

const PAGE_SIZE = 24;
const TIME_TABS: { key: DiscoveryTimeKey; label: string }[] = [
  { key: "upNext", label: "Up Next" },
  { key: "today", label: "Today" },
  { key: "weekend", label: "This Weekend" },
  { key: "anytime", label: "All Events" },
];

interface Params {
  when?: string;
  q?: string;
  category?: string;
  location?: string;
  limit?: string;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const timeKey: DiscoveryTimeKey = TIME_TABS.some((t) => t.key === params.when) ? (params.when as DiscoveryTimeKey) : "upNext";
  // Reuses the exact same time-window mapping/logic the homepage's
  // HomeEventDiscovery already proved out (WINDOW_BY_TIME_KEY ->
  // getDiscoveryWindowBounds) — not a second interpretation of "weekend."
  const when = WINDOW_BY_TIME_KEY[timeKey];
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 240);

  // Event category options are EVENT taxonomy only (event_categories via
  // getEventCategories()) — never business categories (Discovery/Archive
  // V2 Part 9). Already scoped to categories that can return a real,
  // live, upcoming event — see that function's own note.
  const [eventCategories, fetchedRaw] = await Promise.all([
    getEventCategories(),
    getEventsDiscovery({
      when,
      q: params.q,
      categorySlug: params.category,
      location: params.location,
      limit: limit + 1,
    }),
  ]);
  const hasMore = fetchedRaw.length > limit;
  const events = await attachEventCategories(fetchedRaw.slice(0, limit));

  const baseParams = new URLSearchParams();
  if (timeKey !== "upNext") baseParams.set("when", timeKey);
  if (params.q) baseParams.set("q", params.q);
  if (params.category) baseParams.set("category", params.category);
  if (params.location) baseParams.set("location", params.location);

  const categoryName = eventCategories.find((c) => c.slug === params.category)?.name;
  const chips: ActiveFilterChip[] = [];
  const withoutParam = (key: string) => {
    const p = new URLSearchParams(baseParams);
    p.delete(key);
    return `/events${p.toString() ? `?${p.toString()}` : ""}`;
  };
  if (params.q) chips.push({ label: `"${params.q}"`, href: withoutParam("q") });
  if (params.category) chips.push({ label: categoryName ?? params.category, href: withoutParam("category") });
  if (params.location) chips.push({ label: params.location, href: withoutParam("location") });

  const sheetFilterCount = [params.category, params.location].filter(Boolean).length;
  const filtering = chips.length > 0 || timeKey !== "upNext";

  const loadMoreHref = (() => {
    const p = new URLSearchParams(baseParams);
    p.set("limit", String(limit + PAGE_SIZE));
    return `/events?${p.toString()}`;
  })();

  const timeHref = (key: DiscoveryTimeKey) => {
    const p = new URLSearchParams(baseParams);
    if (key === "upNext") p.delete("when");
    else p.set("when", key);
    p.delete("limit");
    return `/events${p.toString() ? `?${p.toString()}` : ""}`;
  };

  const emptyLabel =
    params.q || params.category || params.location
      ? `No events matched${categoryName ? ` ${categoryName}` : ""}${params.location ? ` in ${params.location}` : ""}${params.q ? ` for "${params.q}"` : ""}.`
      : timeKey === "today"
        ? "Nothing today — try This Weekend or All Events."
        : timeKey === "weekend"
          ? "Nothing this weekend yet — try All Events."
          : "No upcoming events yet — check back soon.";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Events</h1>
      <p className="mt-1.5 text-sm text-ink/60 sm:text-base">
        Markets, pop-ups, and festivals — and who you&rsquo;ll find here.
      </p>

      <form method="get" className="mt-5 flex flex-col gap-3">
        <ArchiveSearchField defaultValue={params.q} placeholder="Search events" />

        {/* Time is the primary axis for event discovery — same tabs, same
            underlying window logic, as the homepage. */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TIME_TABS.map((t) => (
            <Link
              key={t.key}
              href={timeHref(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                timeKey === t.key ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <FilterSheet activeCount={sheetFilterCount}>
            <EventFilters categories={eventCategories} defaultCategory={params.category} defaultLocation={params.location} />
          </FilterSheet>
        </div>
        {chips.length > 0 && <ActiveFilterChips chips={chips} clearHref={timeKey === "upNext" ? "/events" : `/events?when=${timeKey}`} />}
      </form>

      <p className="mt-5 text-sm text-ink/50">
        {events.length === 0 && !hasMore ? 0 : `${events.length}${hasMore ? "+" : ""}`} event{events.length === 1 && !hasMore ? "" : "s"}
        {timeKey === "weekend" ? " this weekend" : timeKey === "today" ? " today" : ""}
      </p>

      {events.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
          <p className="text-sm text-ink/60">{emptyLabel}</p>
          {filtering && (
            <Link href="/events" className="mt-2 inline-block text-sm font-semibold text-findmi-700 underline underline-offset-2">
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {events.map((e) => (
              <HomeEventCard key={e.id} event={e} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-6 flex justify-center">
              <Link
                href={loadMoreHref}
                className="flex h-11 items-center justify-center rounded-full border border-black/10 px-6 text-sm font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
              >
                Load More
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
