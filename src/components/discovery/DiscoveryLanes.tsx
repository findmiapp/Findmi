import { cache } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import SupabaseImage from "@/components/SupabaseImage";
import { DiscoveryRail, DiscoveryRailSkeleton } from "@/components/discovery/DiscoveryTile";
import { getSupabase } from "@/lib/supabase";
import { searchHref, type TopicQuery } from "@/lib/discovery/query";
import { getVocabulary, runDiscovery, type DiscoveryLane, type DiscoveryTopic } from "@/lib/discovery/server";

// Right Now Carousel Visual Refinement pass — which of the six
// recognized date/status states a Topic represents, used ONLY to pick
// an icon. Derived strictly from the Topic's own structured query below
// (dateStatusKindOf) — never from its title/name text.
type DateStatusKind = "now" | "today" | "tonight" | "weekend" | "endingSoon" | "justAnnounced";

/** Structural detection, never title matching. endingSoonHours/
 * justAnnouncedDays are checked first since they're the more specific
 * signal (today's real Topics never combine either with `when`, but
 * the schema doesn't forbid it, so this order is a deliberate, documented
 * tie-break, not an assumption). Any other recognized `when` (now/today/
 * tonight/weekend) maps to its own case. A `when` value outside those
 * four (tomorrow/week/upcoming — none configured today) still has no
 * decorative photo (preserving the existing guarantee from the prior
 * pass) and falls back to the same generic calendar icon "today" uses,
 * rather than inventing a new icon for a case this task never asked for. */
function dateStatusKindOf(q: TopicQuery): DateStatusKind | null {
  if (q.endingSoonHours !== undefined) return "endingSoon";
  if (q.justAnnouncedDays !== undefined) return "justAnnounced";
  if (q.when === "now") return "now";
  if (q.when === "today") return "today";
  if (q.when === "tonight") return "tonight";
  if (q.when === "weekend") return "weekend";
  if (q.when) return "today";
  return null;
}

/** Same 24x24 viewBox / stroke="currentColor" visual language as
 * NavIcon.tsx (reused directly for "today", via NAV_ICON_KEYS' existing
 * "calendar" entry) — but these five are deliberately NOT added to
 * NavIcon's own curated NAV_ICON_KEYS list. That list is the founder's
 * nav-item icon picker (lib/navigation.ts: "do not overengineer icons")
 * and has nothing to do with Discovery Lane tiles; adding unrelated
 * icons there would surface them as nonsensical nav-item choices. Scoped
 * here instead, the same way this codebase already keeps other
 * presentation-only glyphs local to the file that uses them (see
 * page.tsx's ChevronGlyph/PlusBadgeGlyph). */
function DateStatusIcon({ kind, className }: { kind: DateStatusKind; className?: string }) {
  switch (kind) {
    case "now":
      // Radio/pulse — a live signal radiating from a center point.
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M8.5 15.5a5 5 0 010-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M15.5 15.5a5 5 0 000-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M5.5 18.5a9 9 0 010-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M18.5 18.5a9 9 0 000-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "tonight":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 1110.5 4a7 7 0 009.5 10.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "weekend":
      // calendar-range — NavIcon's own calendar shape plus a highlighted
      // multi-day band, so it reads as the same icon family, not a
      // different one.
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="7" y="12.5" width="10" height="4" rx="1" fill="currentColor" opacity="0.25" />
        </svg>
      );
    case "endingSoon":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7.5V12l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "justAnnounced":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path d="M13 3L6 13h5l-1 8 7-10h-5l1-8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "today":
    default:
      return <NavIcon name="calendar" className={className} />;
  }
}

// Discovery Intelligence V1 — homepage Lanes (discovery_lanes on the system
// "home" page, Admin-ordered). Three shapes: a row of Topic tiles, one
// Topic's live results, or a Market's Areas. Anything that would render
// empty is omitted — a Topic tile only shows while it has results.
//
// Discovery Lanes Placement & Density Refinement pass — the homepage now
// renders this component twice (placement="primary" before What's
// Happening, placement="explore_more" after Featured Locations, each in
// its own Suspense boundary). getHomeLanes() takes no arguments and is
// wrapped in React's cache() (the same per-request-memoization pattern
// getVocabulary/getCandidates/getPersonalContext in discovery/server.ts
// already use) so both calls within one render resolve to the SAME
// promise — one discovery_pages + discovery_lanes round trip total, not
// two — and the placement split itself is just an in-memory filter.
const getHomeLanes = cache(async (): Promise<DiscoveryLane[]> => {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data: page } = await supabase.from("discovery_pages").select("id").eq("is_system", true).limit(1).maybeSingle();
  if (!page) return [];
  const { data, error } = await supabase.from("discovery_lanes").select("*").eq("page_id", page.id).eq("is_visible", true).order("sort_order");
  return error ? [] : ((data ?? []) as DiscoveryLane[]);
});

function LaneHeader({ title, subtitle, href }: { title: string; subtitle?: string | null; href?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink/55">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-xs font-bold uppercase tracking-wide text-findmi-700">
          See All
        </Link>
      )}
    </div>
  );
}

export function TopicTile({
  topic,
  href,
  count,
  dateStatusKind = null,
}: {
  topic: Pick<DiscoveryTopic, "name" | "image_url" | "description">;
  href: string;
  count?: number;
  /** Right Now Carousel Visual Refinement pass — which of the six
   * date/status states this tile represents, set by the caller from
   * dateStatusKindOf(topic.query) — never from the tile's title text.
   * Non-null means this is a live navigational state, not an editorial
   * subject: it NEVER shows decorative photography, even if an admin
   * happens to have set image_url on it (the Topic form doesn't
   * distinguish kinds), and gets the compact white/bordered/icon-left
   * treatment below instead of the photo/pale-aqua-fallback tile. */
  dateStatusKind?: DateStatusKind | null;
}) {
  if (dateStatusKind) {
    return (
      // Compact, text-first date/status tile — white card, 1px light-
      // gray border (replacing the photo tile's pale-aqua bg-findmi-50),
      // icon left of a vertically stacked title/count, fixed ~72px
      // height (inside the Design pass's approved 68-80px mobile range,
      // kept uniform at every breakpoint rather than the photo tile's
      // viewport-scaled aspect ratio, since a compact icon+text row has
      // no reason to grow taller on larger screens). The outer w-[40%]
      // shrink-0 snap-start sm:w-auto wrapper around every TopicTile
      // (TileRail's children, below) is completely unchanged, so
      // horizontal swipe, partial-next-tile visibility, and the tile's
      // full-card tap target are all preserved exactly as before.
      <Link
        href={href}
        className="group flex h-[72px] w-full items-center gap-2.5 rounded-2xl border border-black/10 bg-white p-3 transition hover:border-findmi-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi-300 active:scale-[0.98]"
      >
        <DateStatusIcon kind={dateStatusKind} className="h-5 w-5 shrink-0 text-findmi-700" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-sm font-semibold leading-tight text-ink">{topic.name}</span>
          {count !== undefined && <span className="mt-0.5 text-[11px] font-normal text-ink/55">{count === 1 ? "1 Thing" : `${count} Things`}</span>}
        </span>
      </Link>
    );
  }
  const showImage = Boolean(topic.image_url);
  return (
    // Discovery Lanes Density Refinement pass — mobile tile height cut
    // ~33% (aspect-[4/3] -> aspect-[2/1]) by widening the aspect ratio
    // only; sm:aspect-[4/3] keeps the existing grid layout byte-identical
    // at sm/lg. Colors, rounded-2xl, text sizes/typography, live count,
    // and the TileRail horizontal-swipe rail itself are untouched. Photo
    // Topic tiles and Area tiles only — date/status tiles return above.
    <Link href={href} className="group relative flex aspect-[2/1] w-full flex-col justify-end overflow-hidden rounded-2xl bg-findmi-50 p-3 transition active:scale-[0.98] sm:aspect-[4/3]">
      {showImage && (
        <>
          <SupabaseImage src={topic.image_url!} alt="" fill sizes="(min-width: 1024px) 18vw, 40vw" className="object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        </>
      )}
      <span className={`relative font-display text-sm font-bold leading-tight ${showImage ? "text-white" : "text-findmi-700"}`}>{topic.name}</span>
      {count !== undefined && <span className={`relative text-[11px] ${showImage ? "text-white/80" : "text-findmi-700/70"}`}>{count === 1 ? "1 Thing" : `${count} Things`}</span>}
    </Link>
  );
}

export function TileRail({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-6">{children}</div>;
}

export default async function DiscoveryLanes({ market, area, placement }: { market?: string; area?: string; placement: "primary" | "explore_more" }) {
  const [allLanes, vocab] = await Promise.all([getHomeLanes(), getVocabulary()]);
  const lanes = allLanes.filter((l) => l.placement === placement);
  if (lanes.length === 0) return null;
  const context = market ? { market, ...(area ? { area } : {}) } : {};
  const topicById = new Map(vocab.topicRows.map((t) => [t.id, t]));

  const rendered = await Promise.all(
    lanes.map(async (lane) => {
      if (lane.kind === "topics") {
        const topics = lane.topic_ids.map((id) => topicById.get(id)).filter((t): t is DiscoveryTopic => Boolean(t));
        const counted = await Promise.all(topics.map(async (t) => ({ t, n: (await runDiscovery({ topics: [t.slug], limit: 1 }, { context })).total })));
        const live = counted.filter((c) => c.n > 0).slice(0, lane.item_limit);
        if (live.length === 0) return null;
        return (
          <section key={lane.id} className="mt-8">
            <LaneHeader title={lane.title} subtitle={lane.subtitle} />
            <TileRail>
              {live.map(({ t, n }) => (
                <div key={t.id} className="w-[40%] shrink-0 snap-start sm:w-auto">
                  <TopicTile topic={t} count={n} href={searchHref({ ...context, topics: [t.slug] })} dateStatusKind={dateStatusKindOf(t.query)} />
                </div>
              ))}
            </TileRail>
          </section>
        );
      }
      if (lane.kind === "topic_results") {
        const t = lane.topic_id ? topicById.get(lane.topic_id) : undefined;
        if (!t) return null;
        const r = await runDiscovery({ topics: [t.slug], limit: lane.item_limit }, { context });
        if (r.items.length === 0) return null;
        return (
          <section key={lane.id} className="mt-8">
            <LaneHeader title={lane.title} subtitle={lane.subtitle} href={searchHref({ ...context, topics: [t.slug] })} />
            <DiscoveryRail items={r.items.map((x) => x.item)} />
          </section>
        );
      }
      const m = vocab.marketRows.find((x) => x.id === lane.market_id);
      const areas = vocab.areaRows.filter((a) => a.market_id === lane.market_id && a.consumer_visible && a.level === "area").slice(0, lane.item_limit);
      if (!m || areas.length === 0) return null;
      return (
        <section key={lane.id} className="mt-8">
          <LaneHeader title={lane.title} subtitle={lane.subtitle} />
          <TileRail>
            {areas.map((a) => (
              <div key={a.id} className="w-[40%] shrink-0 snap-start sm:w-auto">
                <TopicTile topic={{ name: a.name, image_url: a.image_url, description: null }} href={`/explore/${m.slug}/${a.slug}`} />
              </div>
            ))}
          </TileRail>
        </section>
      );
    })
  );
  const visible = rendered.filter(Boolean);
  if (visible.length === 0) return null;
  return <div className="mx-auto max-w-6xl px-4 sm:px-6">{visible}</div>;
}

export function DiscoveryLanesSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6" aria-hidden>
      <div className="mb-3 h-6 w-40 animate-pulse rounded bg-black/5" />
      <DiscoveryRailSkeleton />
    </div>
  );
}
