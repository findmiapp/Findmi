import type { Metadata } from "next";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import { cityState, formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import {
  getCategories,
  getConsumerVisibleMarketsWithAreas,
  getEventsDiscovery,
  getFindMiHereFeed,
  getMarketAreaLabel,
  type AppearanceFeedItem,
  type FindWindow,
} from "@/lib/data";
import AreaPicker from "@/components/discover/AreaPicker";
import PostCard from "@/components/PostCard";
import EventCard from "@/components/EventCard";
import LiveDot from "@/components/LiveDot";

export const metadata: Metadata = {
  title: "Find",
  description: "Help me find something specific — search Findmi by what, where, and when.",
};

/**
 * Find V2 — Unify Search with Area-First Discovery pass. Free-text city
 * is GONE (locked decision — no Advanced Search fallback, no fuzzy
 * matching): structured Market/Area (AreaPicker, ?market=/?area=) is now
 * the only WHERE control, same architecture/URL convention /discover,
 * /businesses, and /events already use. Brought onto the same white
 * consumer visual system as those pages — no more separate dark theme.
 */
const TABS: { value: FindWindow; label: string }[] = [
  { value: "live", label: "Now" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This Weekend" },
  // Findmi Here Clarity pass — relabeled "Upcoming" -> "Next Up" and made
  // this the default selection (see the `when` fallback below): NOW was
  // producing frequent empty states even though upcoming content existed.
  // Same FindWindow value/semantics — copy only.
  { value: "anytime", label: "Next Up" },
];

// Find's own live/today/weekend/anytime windows map onto events'
// now/weekend/anytime vocabulary for the merged Events section — "live"
// has no direct event equivalent (an event doesn't have a single instant
// "here now" the way an appearance does), so it falls back to "now".
function eventWindow(when: FindWindow): "now" | "weekend" | "anytime" {
  if (when === "live" || when === "today") return "now";
  if (when === "weekend") return "weekend";
  return "anytime";
}

interface Params {
  when?: string;
  category?: string;
  market?: string;
  area?: string;
}

export default async function FindPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { when: whenParam, category, market: marketSlug, area: areaParam } = await searchParams;
  // Findmi Here Clarity pass — default is Next Up ("anytime"), not Now
  // ("live"): explicit ?when=live/today/weekend still select exactly that
  // window (TABS.some(...) below is unchanged), only the no-param fallback
  // moved to the broader, less-often-empty window.
  const when: FindWindow = TABS.some((t) => t.value === whenParam) ? (whenParam as FindWindow) : "anytime";
  // Area only ever meaningful alongside a Market — same guard /discover,
  // /businesses, and /events all use.
  const areaSlug = marketSlug ? areaParam : undefined;

  const [categories, markets, items, matchingEvents] = await Promise.all([
    getCategories(),
    getConsumerVisibleMarketsWithAreas(),
    getFindMiHereFeed(when, 30, { categorySlug: category, marketSlug, areaSlug }),
    category || marketSlug
      ? getEventsDiscovery({ when: eventWindow(when), categorySlug: category, marketSlug, areaSlug, limit: 6 })
      : Promise.resolve([]),
  ]);

  const [hero, ...rest] = items;
  const heroLabel = hero ? getTemporalLabel(hero.start_at, hero.end_at) : null;
  const hasFilters = Boolean(category || marketSlug);

  const selectedMarket = markets.find((m) => m.slug === marketSlug);
  const selectedArea = marketSlug ? selectedMarket?.areas.find((a) => a.slug === areaSlug) : undefined;
  const areaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name} — ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;

  // Shared query-string builder for every internal link on this page (the
  // When tabs, and "View All Areas" in the empty state) — always carries
  // the current category/market/area forward unless explicitly overridden,
  // so switching one dimension never silently drops another (Section 7).
  function buildHref(overrides: Partial<{ when: FindWindow; market: string | undefined; area: string | undefined }> = {}) {
    const next = {
      when: overrides.when ?? when,
      market: "market" in overrides ? overrides.market : marketSlug,
      area: "area" in overrides ? overrides.area : areaSlug,
    };
    const p = new URLSearchParams();
    if (next.when !== "anytime") p.set("when", next.when);
    if (category) p.set("category", category);
    if (next.market) p.set("market", next.market);
    if (next.market && next.area) p.set("area", next.area);
    const qs = p.toString();
    return qs ? `/find?${qs}` : "/find";
  }

  const viewAllAreasHref = buildHref({ market: undefined, area: undefined });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Explore</p>
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        Help me find something specific
      </h1>

      {/* WHAT / WHERE / WHEN — structured filtering, not free-text search.
          Category submits via the form (Find button); Area (AreaPicker)
          and When (plain links) navigate immediately, same interaction
          split /businesses and /events already use. Hidden market/area
          fields mean submitting the category select never drops the
          currently selected Area (Section 7's "changing category must
          not clear Area"). */}
      <form method="get" className="mt-4 flex flex-col gap-2.5">
        <div className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink/40">What</span>
            <select
              name="category"
              defaultValue={category ?? ""}
              className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
            >
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink/40">Where</span>
            <AreaPicker
              options={markets.map((m) => ({
                slug: m.slug,
                label: getMarketAreaLabel(m),
                areasIncluded: m.areas_included,
                areas: m.areas.map((a) => ({ slug: a.slug, label: a.display_name || a.name, aliases: a.aliases })),
              }))}
            />
          </div>
          <input type="hidden" name="when" value={when} />
          {marketSlug && <input type="hidden" name="market" value={marketSlug} />}
          {marketSlug && areaSlug && <input type="hidden" name="area" value={areaSlug} />}
          <div className="flex flex-col justify-end">
            <span className="mb-1 hidden text-[11px] font-bold uppercase tracking-wide text-transparent sm:block" aria-hidden>
              Find
            </span>
            <button
              type="submit"
              className="h-[42px] rounded-xl bg-findmi px-5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
            >
              Find
            </button>
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink/40">When</span>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <Link
                key={t.value}
                href={buildHref({ when: t.value })}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                  when === t.value ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
          {areaLabel ? (
            <>
              <p className="text-sm text-ink/60">Nothing matching this search in {areaLabel} right now.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
                <Link href={viewAllAreasHref} className="text-sm font-semibold text-findmi-700 underline underline-offset-2">
                  View All Areas
                </Link>
                {(category || when !== "anytime") && (
                  <Link href="/find" className="text-sm font-semibold text-ink/50 underline underline-offset-2">
                    Adjust filters
                  </Link>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink/50">
              {when === "anytime"
                ? "Nothing here yet — widen What/Where, or check back soon."
                : "Nothing in this window yet — try Next Up, widen What/Where, or check back soon."}
            </p>
          )}
        </div>
      ) : (
        <>
          {hero && (
            <div className="mt-6 max-w-sm">
              <PostCard
                href={`/business/${hero.business.slug}`}
                image={hero.business.cover_image_url ?? null}
                logoUrl={hero.business.logo_url}
                kind="event"
                badgeLabel={heroLabel!.live ? "Happening Now" : heroLabel!.label}
                badgeVariant={heroLabel!.live ? "live" : "default"}
                title={hero.business.name}
                metaLines={[
                  { icon: "tag", text: hero.title },
                  ...(hero.city ? [{ icon: "pin" as const, text: cityState(hero.city, hero.state) }] : []),
                ]}
                cta="Find Them"
              />
            </div>
          )}

          {rest.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
                {when === "live" ? "Also Happening Now" : "More"}
              </p>
              <div className="mt-2.5 flex flex-col gap-2">
                {rest.map((item) => (
                  <FindAppearanceRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {hasFilters && matchingEvents.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Matching Events</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {matchingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FindAppearanceRow({ item }: { item: AppearanceFeedItem }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);
  const location = cityState(item.city, item.state);

  return (
    <Link
      href={`/business/${item.business.slug}`}
      className={`flex items-center gap-2.5 rounded-2xl border p-2.5 transition active:scale-[0.99] ${
        live ? "border-findmi/40 bg-findmi-50" : "border-black/5 bg-white hover:border-black/10"
      }`}
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black/5">
        {item.business.logo_url && (
          <SupabaseImage src={item.business.logo_url} alt={item.business.name} fill sizes="48px" className="object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${live ? "text-red-600" : "text-ink/40"}`}>
          {live && <LiveDot className="text-red-600" />}
          {live ? "Happening Now" : when}
        </p>
        <p className="truncate text-sm font-semibold text-ink">{item.business.name}</p>
        <p className="truncate text-xs text-ink/50">
          {item.title}
          {location && ` · ${location}`} · {formatAppearanceDateRange(item.start_at, item.end_at, item.description)}
        </p>
      </div>
      <span className="shrink-0 text-[11px] font-bold uppercase text-findmi-700">Find Them</span>
    </Link>
  );
}
