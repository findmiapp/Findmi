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
  q?: string;
}

/** Carousel-First pass — stable round-robin by business.id, preserving
 * each business's own relative order and the order businesses first
 * appear in. Never hides an item, never scores/ranks anything — just
 * interleaves so 5 cards from the same Business don't cluster before a
 * different one shows up (Section 8). A single-business result set (or an
 * already-alternating one) passes through unchanged. */
function diversifyByBusiness<T extends { business: { id: string } }>(list: T[]): T[] {
  const buckets = new Map<string, T[]>();
  const businessOrder: string[] = [];
  for (const item of list) {
    const id = item.business.id;
    if (!buckets.has(id)) {
      buckets.set(id, []);
      businessOrder.push(id);
    }
    buckets.get(id)!.push(item);
  }
  const result: T[] = [];
  let remaining = list.length;
  while (remaining > 0) {
    for (const id of businessOrder) {
      const bucket = buckets.get(id)!;
      const next = bucket.shift();
      if (next) {
        result.push(next);
        remaining--;
      }
    }
  }
  return result;
}

export default async function FindPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { when: whenParam, category, market: marketSlug, area: areaParam, q: qParam } = await searchParams;
  // Findmi Here Clarity pass — default is Next Up ("anytime"), not Now
  // ("live"): explicit ?when=live/today/weekend still select exactly that
  // window (TABS.some(...) below is unchanged), only the no-param fallback
  // moved to the broader, less-often-empty window.
  const when: FindWindow = TABS.some((t) => t.value === whenParam) ? (whenParam as FindWindow) : "anytime";
  // Area only ever meaningful alongside a Market — same guard /discover,
  // /businesses, and /events all use.
  const areaSlug = marketSlug ? areaParam : undefined;
  // Find V3 — blank q is omitted from the URL entirely (never `?q=`), same
  // "resolved-or-undefined" treatment area/market already get.
  const q = qParam?.trim() || undefined;

  const [categories, markets, items, matchingEvents] = await Promise.all([
    getCategories(),
    getConsumerVisibleMarketsWithAreas(),
    getFindMiHereFeed(when, 30, { categorySlug: category, marketSlug, areaSlug, q }),
    category || marketSlug
      ? getEventsDiscovery({ when: eventWindow(when), categorySlug: category, marketSlug, areaSlug, limit: 6 })
      : Promise.resolve([]),
  ]);

  // Carousel-First pass — the same filtered `items` result set (unchanged
  // query, unchanged ordering source) is split into an UPCOMING carousel
  // (first up to 8) and a MORE UPCOMING compact list (the remainder),
  // replacing the old single-giant-hero + rows split. Never a second
  // query, never a featured/ranking flag: purely a display-order pass over
  // what the pipeline already returned.
  //
  // Diversification (Section 8): businesses are round-robined — one item
  // from each distinct business (in the order that business first
  // appears), then a second item from each that still has one, and so on.
  // Each business's OWN items keep their existing relative order (the
  // pipeline's own is_featured/start_at sort); only the interleaving
  // across businesses changes. With a single business in the result set
  // (e.g. a name search), the round-robin degrades to a no-op — every item
  // belongs to the same bucket, so original order is preserved exactly,
  // never hidden or faked to "look diverse."
  const diversified = diversifyByBusiness(items);
  const CAROUSEL_SIZE = 8;
  const carouselItems = diversified.slice(0, CAROUSEL_SIZE);
  const moreItems = diversified.slice(CAROUSEL_SIZE);
  // A Matching Event that's already visible as an appearance card (carousel
  // or More Upcoming) would otherwise show the literal same Event twice on
  // one page — once as "Business @ Event", once again as its own Event
  // card. Dedup key: event.id against every visible appearance's own
  // event_id — unchanged from the prior pass, just computed over the same
  // full `items` set regardless of which section each row lands in.
  const shownEventIds = new Set(items.filter((i) => i.event_id).map((i) => i.event_id as string));
  const dedupedMatchingEvents = matchingEvents.filter((e) => !shownEventIds.has(e.id));
  const hasFilters = Boolean(category || marketSlug);

  const selectedMarket = markets.find((m) => m.slug === marketSlug);
  const selectedArea = marketSlug ? selectedMarket?.areas.find((a) => a.slug === areaSlug) : undefined;
  const areaLabel = selectedArea
    ? `${selectedArea.display_name || selectedArea.name} — ${selectedMarket ? getMarketAreaLabel(selectedMarket) : ""}`
    : selectedMarket
      ? getMarketAreaLabel(selectedMarket)
      : undefined;

  // Shared query-string builder for every internal link on this page (the
  // When tabs, and the empty state's suggestions) — always carries the
  // current category/market/area/q forward unless explicitly overridden,
  // so switching one dimension never silently drops another (Section 7).
  function buildHref(
    overrides: Partial<{ when: FindWindow; market: string | undefined; area: string | undefined; q: string | undefined }> = {}
  ) {
    const next = {
      when: overrides.when ?? when,
      market: "market" in overrides ? overrides.market : marketSlug,
      area: "area" in overrides ? overrides.area : areaSlug,
      q: "q" in overrides ? overrides.q : q,
    };
    const p = new URLSearchParams();
    if (next.when !== "anytime") p.set("when", next.when);
    if (category) p.set("category", category);
    if (next.market) p.set("market", next.market);
    if (next.market && next.area) p.set("area", next.area);
    if (next.q) p.set("q", next.q);
    const qs = p.toString();
    return qs ? `/find?${qs}` : "/find";
  }

  const viewAllAreasHref = buildHref({ market: undefined, area: undefined });

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      <p className="text-xs font-bold uppercase tracking-wide text-findmi-700">Explore</p>
      <h1 className="mt-0.5 font-display text-xl font-bold tracking-tight text-ink sm:text-3xl">
        Help me find something specific
      </h1>

      {/* Find V3 — SEARCH + WHAT + WHERE compose with WHEN (Section 3): one
          form, one submit. Search text and category both need an explicit
          submit (Where/When act immediately via AreaPicker/Links, exactly
          as before) — reusing the same "Find" action as search's own
          submit, rather than a second button, is what keeps this to one
          compact row instead of a second oversized one (Section 4).
          Hidden when/market/area fields mean submitting never drops
          whichever of those the visitor already had selected. */}
      <form method="get" className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search businesses, events…"
            className="h-11 w-full flex-1 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-ink/30 focus:outline-none"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-xl bg-findmi px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
          >
            Search
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink/40">What</span>
            <select
              name="category"
              defaultValue={category ?? ""}
              className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-ink/30 focus:outline-none"
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
        </div>
        <input type="hidden" name="when" value={when} />
        {marketSlug && <input type="hidden" name="market" value={marketSlug} />}
        {marketSlug && areaSlug && <input type="hidden" name="area" value={areaSlug} />}

        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={buildHref({ when: t.value })}
              className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                when === t.value ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </form>

      {items.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-black/5 bg-black/[0.015] p-6 text-center">
          {q ? (
            <>
              <p className="text-sm text-ink/60">No matches for &ldquo;{q}&rdquo;.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
                <Link href={buildHref({ q: "" })} className="text-sm font-semibold text-findmi-700 underline underline-offset-2">
                  Clear search
                </Link>
                {when !== "anytime" && (
                  <Link href={buildHref({ when: "anytime" })} className="text-sm font-semibold text-ink/50 underline underline-offset-2">
                    Try Next Up
                  </Link>
                )}
                {(category || marketSlug) && (
                  <Link href="/find" className="text-sm font-semibold text-ink/50 underline underline-offset-2">
                    Clear all filters
                  </Link>
                )}
              </div>
            </>
          ) : areaLabel ? (
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
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Upcoming</p>
            {carouselItems.length === 1 ? (
              // Section 6 — a single result gets one appropriately sized
              // card, never a scroller with nothing to scroll (no snap/
              // overflow-x wrapper, no fake peek).
              <div className="mt-2.5 max-w-sm">
                <FindCarouselCard item={carouselItems[0]} />
              </div>
            ) : (
              // Native CSS scroll-snap horizontal carousel — same
              // lightweight, library-free pattern already established by
              // the homepage's "Upcoming Events Near You" row
              // (HomeEventDiscovery.tsx): ~76vw-wide cards (capped at
              // 320px) so a meaningful peek of the next card always shows
              // on mobile, a fixed sm:w-72 so cards stay sensibly sized
              // (never enormous) on desktop instead of stretching across
              // the results container.
              <div className="mt-2.5 flex gap-3 overflow-x-auto px-4 pb-1 -mx-4 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start [scroll-snap-type:x_mandatory]">
                {carouselItems.map((item) => (
                  <div key={item.id} className="w-[76vw] max-w-[320px] shrink-0 sm:w-72">
                    <FindCarouselCard item={item} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {moreItems.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">
                {when === "live" ? "Also Happening Now" : "More Upcoming"}
              </p>
              <div className="mt-2.5 flex flex-col gap-2">
                {moreItems.map((item) => (
                  <FindAppearanceRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {hasFilters && dedupedMatchingEvents.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Matching Events</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {dedupedMatchingEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Carousel-First pass — compact, image-forward carousel card. Landscape
 * (aspect-[4/3], not PostCard's tall aspect-[3/4] the old single hero
 * used) so a full card fits comfortably within a fraction of a mobile
 * viewport. One line each for Business name (most prominent), appearance/
 * Event title, and date+place combined (avoids repeating date/time/place
 * across separate lines — Section 4) — clamped/truncated rather than
 * letting a long title grow the card. The CTA is a plain inline text
 * link, not a filled full-width band (Section 5). Destination is always
 * the business profile, same as FindAppearanceRow below, so the CTA never
 * claims "View Event." */
function FindCarouselCard({ item }: { item: AppearanceFeedItem }) {
  const { label, live } = getTemporalLabel(item.start_at, item.end_at);
  const location = cityState(item.city, item.state);
  const dateAndPlace = [formatAppearanceDateRange(item.start_at, item.end_at, item.description), location]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/business/${item.business.slug}`}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black/5 transition active:scale-[0.98]"
    >
      {item.business.cover_image_url ? (
        <SupabaseImage
          src={item.business.cover_image_url}
          alt={item.business.name}
          fill
          sizes="(min-width: 768px) 288px, 76vw"
          className="object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-stone to-ink" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      <div className="absolute left-2.5 top-2.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/45 text-white backdrop-blur-sm"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {live ? "Happening Now" : label}
        </span>
      </div>

      {item.business.logo_url && (
        <div className="absolute right-2.5 top-2.5 h-7 w-7 overflow-hidden rounded-full border-2 border-white/80 bg-white">
          <SupabaseImage src={item.business.logo_url} alt="" fill sizes="28px" className="object-cover" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3">
        <p className="truncate text-sm font-bold text-white">{item.business.name}</p>
        <p className="line-clamp-1 text-xs text-white/85">{item.title}</p>
        {dateAndPlace && <p className="truncate text-[11px] text-white/70">{dateAndPlace}</p>}
        <span className="mt-0.5 w-fit text-[11px] font-bold uppercase tracking-wide text-white/90 underline underline-offset-2">
          See where they&rsquo;ll be →
        </span>
      </div>
    </Link>
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
      <span className="shrink-0 text-[11px] font-bold uppercase text-findmi-700">View Business →</span>
    </Link>
  );
}
