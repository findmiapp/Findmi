import type { Metadata } from "next";
import Link from "next/link";
import SearchFilterAnalytics from "@/components/analytics/SearchFilterAnalytics";
import ActiveFilterChips, { type ActiveFilterChip } from "@/components/discover/ActiveFilterChips";
import AreaPicker from "@/components/discover/AreaPicker";
import ArchiveSearchField from "@/components/discover/ArchiveSearchField";
import EventDiscoveryCard from "@/components/discover/EventDiscoveryCard";
import EventFilters from "@/components/discover/EventFilters";
import RefineSheet, { RefineSection } from "@/components/discover/RefineSheet";
import ArchiveGeoShell from "@/components/map/ArchiveGeoShell";
import { parseBboxParam } from "@/lib/geo-results";
import {
  attachEventCategories,
  getConsumerVisibleMarketsWithAreas,
  getEventCategories,
  getEventFormatOptions,
  getEventsDiscovery,
  getMarketAreaLabel,
} from "@/lib/data";
import {
  EVENT_ACCESS_LABELS,
  EVENT_TIME_KEYS,
  EVENT_TIME_LABELS,
  eventDiscoveryParams,
  eventFilterToSearchParams,
  parseEventFilter,
  type EventFilter,
  type EventTimeKey,
} from "@/lib/event-filter";
import { resolveCanonicalGeoScope } from "@/lib/geo/canonical-scope";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming markets, pop-ups, and events on Findmi.",
};
export const revalidate = 60;

const PAGE_SIZE = 24;
// Shared Event filter foundation — /events reads and writes its URL state
// through lib/event-filter.ts (the one Event filter contract), so every
// window here is the same window the homepage rows, /discover and /find
// use (lib/format.ts getDiscoveryWindowBounds). Happening Now and Tomorrow
// are /events-only tabs for now; the homepage keeps DISCOVERY_TIME_TABS.
const TIME_TABS = EVENT_TIME_KEYS.map((key) => ({ key, label: EVENT_TIME_LABELS[key] }));

interface Params {
  when?: string;
  date?: string;
  access?: string | string[];
  format?: string | string[];
  q?: string;
  category?: string;
  location?: string;
  /** Consumer Event Market Filtering V1 — a FindMi Market slug, scoping
   * by each event occurrence's EFFECTIVE physical Market (see
   * lib/event-markets.ts). Completely independent of `location` (free-
   * text city/state) above — same separation /businesses already
   * established for Market vs. Based In. Absent = "All Areas" =
   * today's unfiltered behavior, unchanged. Shown to consumers as "Area"
   * (Market Management + Plan Market Allowances V1) — the `market` param
   * name is unchanged. */
  market?: string;
  /** Market -> Area/Submarket Hierarchy V2 — a structured Area slug
   * scoped WITHIN `market` (never meaningful alone). */
  area?: string;
  limit?: string;
  /** Canonical Entity Geography completion pass — a canonical
   * census_geographies key (Place/ZCTA/State/County — e.g.
   * `place:4752006`), independent of and additive alongside `market`/
   * `area`/`location` above. "NYC still integrates with the NYC Market"
   * et al. are unaffected — this is a SEPARATE filter axis, never a
   * replacement for the Findmi Market/Area system. */
  geo?: string;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const rawParams = await searchParams;
  // Defensive parse: unknown values, malformed dates and slugs are dropped.
  const filter: EventFilter = parseEventFilter(rawParams as Record<string, string | string[] | undefined>);
  const params = { ...filter, limit: typeof rawParams.limit === "string" ? rawParams.limit : undefined };
  const timeKey: EventTimeKey = filter.when ?? "next";
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 240);
  const canonicalGeo = typeof rawParams.geo === "string" ? await resolveCanonicalGeoScope(rawParams.geo) : null;

  // Event category options are EVENT taxonomy only (event_categories via
  // getEventCategories()) — never business categories (Discovery/Archive
  // V2 Part 9). Already scoped to categories that can return a real,
  // live, upcoming event — see that function's own note.
  const [eventCategories, markets, fetchedRaw, formatOptions] = await Promise.all([
    getEventCategories(),
    getConsumerVisibleMarketsWithAreas(),
    getEventsDiscovery({ ...eventDiscoveryParams(filter, { limit: limit + 1, featuredFirst: true }), canonicalGeo }),
    getEventFormatOptions(),
  ]);
  // Event Formats V1 — offer the Formats that can return an upcoming Event,
  // plus any already selected in the URL (so a shared link restores them).
  const selectedFormats = filter.formats ?? [];
  const formatChoices = formatOptions.formats.filter((f) => formatOptions.usedIds.includes(f.id) || selectedFormats.includes(f.slug));
  const hasMore = fetchedRaw.length > limit;
  const events = await attachEventCategories(fetchedRaw.slice(0, limit));

  const baseParams = eventFilterToSearchParams(filter);

  const categoryName = eventCategories.find((c) => c.slug === params.category)?.name;
  const selectedMarket = markets.find((m) => m.slug === params.market);
  const selectedArea = params.market ? selectedMarket?.areas.find((a) => a.slug === params.area) : undefined;
  const marketAreaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name}, ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;
  const chips: ActiveFilterChip[] = [];
  const withoutParam = (key: string) => {
    const p = new URLSearchParams(baseParams);
    p.delete(key);
    if (key === "market") p.delete("area");
    return `/events${p.toString() ? `?${p.toString()}` : ""}`;
  };
  // Events Discovery V4 — no chip for `q`: the term is already visible in
  // the search field itself, so a duplicate chip for it is redundant
  // (same fix Businesses Discovery V4 already applied to /businesses).
  if (params.market) chips.push({ label: marketAreaLabel ?? params.market, href: withoutParam("market") });
  if (params.category) chips.push({ label: categoryName ?? params.category, href: withoutParam("category") });
  if (params.location) chips.push({ label: params.location, href: withoutParam("location") });
  for (const a of filter.access ?? []) {
    chips.push({
      label: EVENT_ACCESS_LABELS[a],
      href: `/events${(() => {
        const p = eventFilterToSearchParams({ ...filter, access: (filter.access ?? []).filter((x) => x !== a) });
        return p.toString() ? `?${p.toString()}` : "";
      })()}`,
    });
  }
  for (const slug of selectedFormats) {
    const p = eventFilterToSearchParams({ ...filter, formats: selectedFormats.filter((x) => x !== slug) });
    chips.push({ label: formatOptions.formats.find((f) => f.slug === slug)?.name ?? slug, href: `/events${p.toString() ? `?${p.toString()}` : ""}` });
  }
  if (filter.date) chips.push({ label: filter.date, href: withoutParam("date") });

  const sheetFilterCount = [params.category, params.location].filter(Boolean).length + (filter.access?.length ?? 0) + selectedFormats.length;
  const filtering = chips.length > 0 || timeKey !== "next" || Boolean(params.q);

  const loadMoreHref = (() => {
    const p = new URLSearchParams(baseParams);
    p.set("limit", String(limit + PAGE_SIZE));
    return `/events?${p.toString()}`;
  })();

  // Refine's Reset: every Refine filter removed — search, time, map area
  // and view kept.
  const resetHref = (() => {
    const p = eventFilterToSearchParams({ q: filter.q, when: filter.when, date: filter.date, bbox: filter.bbox, view: filter.view });
    return `/events${p.toString() ? `?${p.toString()}` : ""}`;
  })();

  const timeHref = (key: EventTimeKey) => {
    // A time tab replaces an exact date (date overrides when).
    const p = eventFilterToSearchParams({ ...filter, when: key, date: undefined });
    return `/events${p.toString() ? `?${p.toString()}` : ""}`;
  };

  const emptyLabel =
    params.q || params.category || params.location || params.market || filter.access?.length || selectedFormats.length
      ? `No events matched${marketAreaLabel ? ` in ${marketAreaLabel}` : params.market ? ` in that area` : ""}${categoryName ? ` ${categoryName}` : ""}${params.location ? ` in ${params.location}` : ""}${params.q ? ` for "${params.q}"` : ""}.`
      : timeKey === "live"
        ? "Nothing is happening right now. Try Today or This Week."
        : timeKey === "tomorrow"
          ? "Nothing tomorrow yet. Try This Week or This Weekend."
          : timeKey === "today"
        ? "Nothing today. Try This Week or This Weekend."
        : timeKey === "week"
          ? "Nothing this week yet. Try This Weekend or All."
          : timeKey === "weekend"
            ? "Nothing this weekend yet. Try All."
            : "No upcoming events yet. Check back soon.";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-8 pt-3 sm:px-6 sm:py-10">
      <SearchFilterAnalytics pageType="events" filterParams={["category", "format", "market", "area", "when", "access"]} />
      {/* Archive Discovery UX pass — one compact control family: heading +
          view action, search + Refine on one row, the time lenses (they
          earn their space on Events), compact chips; every other filter
          lives in Refine. Same fields, same URL, same submit as before. */}
      <ArchiveGeoShell
        surface="events"
        initialView={filter.view ?? "list"}
        bbox={parseBboxParam(filter.bbox)}
        noun={["Event", "Events"]}
        title="Events"
        count={
          <>

        {events.length === 0 && !hasMore ? 0 : `${events.length}${hasMore ? "+" : ""}`} event{events.length === 1 && !hasMore ? "" : "s"}
        {filter.date
          ? ` on ${filter.date}`
          : timeKey === "weekend"
            ? " this weekend"
            : timeKey === "today"
              ? " today"
              : timeKey === "tomorrow"
                ? " tomorrow"
                : timeKey === "live"
                  ? " happening now"
                  : timeKey === "week"
                    ? " this week"
                    : ""}
          </>
        }
        subtitle="Markets, pop-ups, and festivals, and who you’ll find here."
        controls={
          <form method="get" className="flex items-center gap-2">
            {/* Submitting search or Refine keeps the chosen time, Area, map
                area and view (set by links / pickers, not form fields). */}
            {filter.when && <input type="hidden" name="when" value={filter.when} />}
            {filter.date && <input type="hidden" name="date" value={filter.date} />}
            {filter.market && <input type="hidden" name="market" value={filter.market} />}
            {filter.market && filter.area && <input type="hidden" name="area" value={filter.area} />}
            {filter.bbox && <input type="hidden" name="bbox" value={filter.bbox} />}
            {filter.view && <input type="hidden" name="view" value={filter.view} />}
            <ArchiveSearchField defaultValue={params.q} placeholder="Search Events" />
            <RefineSheet noun="Events" activeCount={sheetFilterCount + (params.market ? 1 : 0)} resetHref={resetHref}>
              <RefineSection title="Where">
                <AreaPicker
                  fullWidth
                  options={markets.map((m) => ({
                    slug: m.slug,
                    label: getMarketAreaLabel(m),
                    areasIncluded: m.areas_included,
                    areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
                  }))}
                />
              </RefineSection>
              <EventFilters
                categories={eventCategories}
                defaultCategory={params.category}
                defaultLocation={params.location}
                defaultAccess={filter.access}
                formats={formatChoices}
                defaultFormats={selectedFormats}
                showSubmit={false}
              />
            </RefineSheet>
          </form>
        }
        lenses={
          // Time is the primary axis for event discovery — same tabs, same
          // underlying window logic, as the homepage.
          <nav aria-label="When" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            {TIME_TABS.map((t) => (
              <Link
                key={t.key}
                href={timeHref(t.key)}
                aria-current={timeKey === t.key ? "page" : undefined}
                className={`flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[11px] font-bold uppercase tracking-wide transition ${
                  timeKey === t.key ? "bg-findmi text-white" : "border border-black/10 bg-white text-ink/60 hover:border-black/20"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        }
        chips={chips.length > 0 ? <ActiveFilterChips chips={chips} clearHref={timeKey === "next" ? "/events" : `/events?when=${timeKey}`} /> : null}
      >
      {/* Events Discovery V4, item 4 — same compact treatment as
          Businesses Discovery V4's result count: smaller/lighter than
          any surrounding control text, never a headline. */}

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
          {/* Events Discovery V4, items 5/6/7/10 — the results grid now
              uses EventDiscoveryCard, a dedicated dense presentation,
              instead of HomeEventCard (which stays unchanged — it's also
              the Homepage's own discovery card). Same grid breakpoints as
              before; the density win comes from the card itself. */}
          <div data-geo-grid className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {events.map((e, i) => (
              <div key={e.id} data-geo-key={`ev:${e.id}`} className="min-w-0">
                <EventDiscoveryCard event={e} analyticsContext={{ pageType: "events", placement: "results_grid", position: i + 1 }} />
              </div>
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
      </ArchiveGeoShell>
    </div>
  );
}
