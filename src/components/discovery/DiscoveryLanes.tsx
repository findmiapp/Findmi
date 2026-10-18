import { cache } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import SupabaseImage from "@/components/SupabaseImage";
import { DiscoveryRail, DiscoveryRailSkeleton } from "@/components/discovery/DiscoveryTile";
import { getSupabase } from "@/lib/supabase";
import { searchHref } from "@/lib/discovery/query";
import { getVocabulary, runDiscovery, type DiscoveryLane, type DiscoveryTopic } from "@/lib/discovery/server";

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
  dateStatus = false,
}: {
  topic: Pick<DiscoveryTopic, "name" | "image_url" | "description">;
  href: string;
  count?: number;
  /** Date/Status Tile Presentation pass — true for a topic whose query is
   * keyed by `when` (Happening Now, Today, Tonight, This Weekend, …), set
   * by the caller from the real topic.query.when field (never from the
   * tile's title text). A live navigational state like this never shows
   * decorative photography, even if an admin happens to have set
   * image_url on it (the Topic form doesn't distinguish kinds) — it gets
   * the same compact, text-first treatment with one consistent icon
   * (NavIcon "calendar") instead. */
  dateStatus?: boolean;
}) {
  const showImage = !dateStatus && Boolean(topic.image_url);
  return (
    // Discovery Lanes Density Refinement pass — mobile tile height cut
    // ~33% (aspect-[4/3] -> aspect-[2/1]) by widening the aspect ratio
    // only; sm:aspect-[4/3] keeps the existing grid layout byte-identical
    // at sm/lg. Colors, rounded-2xl, text sizes/typography, live count,
    // and the TileRail horizontal-swipe rail itself are untouched.
    <Link href={href} className="group relative flex aspect-[2/1] w-full flex-col justify-end overflow-hidden rounded-2xl bg-findmi-50 p-3 transition active:scale-[0.98] sm:aspect-[4/3]">
      {showImage && (
        <>
          <SupabaseImage src={topic.image_url!} alt="" fill sizes="(min-width: 1024px) 18vw, 40vw" className="object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        </>
      )}
      {dateStatus && <NavIcon name="calendar" className="relative mb-auto h-4 w-4 shrink-0 text-findmi-700/70" />}
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
                  <TopicTile topic={t} count={n} href={searchHref({ ...context, topics: [t.slug] })} dateStatus={Boolean(t.query.when)} />
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
