"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MomentFeedCard } from "@/lib/moment-discovery";
import {
  MOMENT_FILTER_LABELS,
  MORE_MOMENT_FILTERS,
  PRIMARY_MOMENT_FILTERS,
  momentMatchesFilter,
  type MomentFilterKey,
  type MomentFollowKeys,
} from "@/lib/moment-filters";
import { getFollowedSlugs } from "@/lib/followed";
import { getFollowedEventIds } from "@/lib/followedEvents";
import { getFollowedLocationIds } from "@/lib/followedLocations";
import ChevronIcon from "@/components/ChevronIcon";
import MomentDiscoveryCard from "./MomentDiscoveryCard";
import { useNearViewport } from "./useNearViewport";

const NO_FOLLOWS: MomentFollowKeys = { businessSlugs: [], eventIds: [], locationIds: [] };

/** Findmi Moments discovery — filter chips over a set of public Moment
 * cards, as a snap carousel (homepage) or a responsive feed (/moments).
 * Filtering is over the server-loaded page: category filters use each
 * Moment's real connected categories; "Following" uses this device's own
 * follow lists (read after mount, so server and client render match). A
 * category chip only appears when at least one loaded Moment matches it —
 * never an empty, decorative filter. */
export default function MomentsDiscovery({
  cards,
  layout,
  initialFilter = "for-you",
  pagination,
}: {
  cards: MomentFeedCard[];
  layout: "carousel" | "grid";
  initialFilter?: MomentFilterKey;
  /** /moments only: keyset pagination links (filter is carried along). */
  pagination?: { basePath: string; cursor: string | null; nextCursor: string | null };
}) {
  const [filter, setFilter] = useState<MomentFilterKey>(initialFilter);
  const [follows, setFollows] = useState<MomentFollowKeys>(NO_FOLLOWS);
  const [moreOpen, setMoreOpen] = useState(MORE_MOMENT_FILTERS.includes(initialFilter));

  useEffect(() => {
    setFollows({ businessSlugs: getFollowedSlugs(), eventIds: getFollowedEventIds(), locationIds: getFollowedLocationIds() });
  }, []);

  const hasAny = (key: MomentFilterKey) => cards.some((c) => momentMatchesFilter(c, key, follows));
  const primary = PRIMARY_MOMENT_FILTERS.filter((k) => k === "for-you" || k === "following" || hasAny(k) || k === filter);
  const more = MORE_MOMENT_FILTERS.filter((k) => hasAny(k) || k === filter);
  const visible = useMemo(() => cards.filter((c) => momentMatchesFilter(c, filter, follows)), [cards, filter, follows]);

  const chip = (key: MomentFilterKey) => {
    const active = key === filter;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => setFilter(key)}
        className={`h-8 shrink-0 rounded-full px-3.5 text-metadata font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi focus-visible:ring-offset-1 ${
          active ? "bg-findmi-600 text-white" : "border border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
        }`}
      >
        {MOMENT_FILTER_LABELS[key]}
      </button>
    );
  };

  const empty =
    filter === "following"
      ? "Follow a Business, Event or Location to see its Moments here."
      : "No Moments here yet — check back soon.";

  const pageHref = (cursor: string | null) => {
    if (!pagination) return "#";
    const qs = new URLSearchParams();
    if (filter !== "for-you") qs.set("filter", filter);
    if (cursor) qs.set("cursor", cursor);
    const s = qs.toString();
    return s ? `${pagination.basePath}?${s}` : pagination.basePath;
  };

  return (
    <div>
      <div
        role="group"
        aria-label="Filter Moments"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {primary.map(chip)}
        {more.length > 0 &&
          (moreOpen ? (
            more.map(chip)
          ) : (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setMoreOpen(true)}
              className="h-8 shrink-0 rounded-full border border-black/10 bg-white px-3.5 text-metadata font-semibold text-ink/65 hover:border-black/20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi"
            >
              More
            </button>
          ))}
      </div>

      <div className="mt-4">
        {visible.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">{empty}</p>
        ) : layout === "carousel" ? (
          <MomentCarousel cards={visible} />
        ) : (
          <MomentGrid cards={visible} />
        )}
      </div>

      {pagination && (pagination.nextCursor || pagination.cursor) && (
        <nav className="mt-8 flex items-center justify-between gap-3 text-sm font-semibold">
          {pagination.cursor ? (
            <Link href={pageHref(null)} className="inline-flex items-center gap-1 text-ink/60 hover:text-ink">
              <ChevronIcon direction="left" className="h-3 w-3" />
              Newest
            </Link>
          ) : (
            <span />
          )}
          {pagination.nextCursor && (
            <Link href={pageHref(pagination.nextCursor)} className="inline-flex items-center gap-1 text-findmi-700 hover:underline">
              Older Moments
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

// Loading — only the Moments a visitor can actually see (or is about to)
// request their photos; the rest keep their placeholder collage until they
// approach. Hero first: the first card's hero loads alone, then its
// supporting regions and the next cards (or after HERO_HEAD_START_MS at
// most), so the first photo gets the whole connection instead of a tenth
// of it. Appearance is identical either way.

const HERO_HEAD_START_MS = 2500;

/** True once the first hero has loaded/failed, `startWhen` has been true
 * for HERO_HEAD_START_MS, or immediately without a first card. */
function useHeroHeadStart(startWhen: boolean): [boolean, () => void] {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled || !startWhen) return;
    const t = setTimeout(() => setSettled(true), HERO_HEAD_START_MS);
    return () => clearTimeout(t);
  }, [settled, startWhen]);
  return [settled, () => setSettled(true)];
}

/** Homepage rail: nothing loads until the rail itself is within 400px of
 * the viewport; then the first card's hero (high priority), then the rest
 * of that card and any card within half a rail-width of the visible area
 * (the peeking next card), and further cards as the visitor scrolls. */
function MomentCarousel({ cards }: { cards: MomentFeedCard[] }) {
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const railNear = useNearViewport(rail, { rootMargin: "400px 0px" });
  const [heroSettled, settleHero] = useHeroHeadStart(railNear);
  return (
    <div
      ref={setRail}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {cards.map((m, i) => (
        <CarouselMoment
          key={m.id}
          moment={m}
          first={i === 0}
          rail={rail}
          railNear={railNear}
          heroSettled={heroSettled}
          onHeroSettled={i === 0 ? settleHero : undefined}
        />
      ))}
    </div>
  );
}

function CarouselMoment({
  moment,
  first,
  rail,
  railNear,
  heroSettled,
  onHeroSettled,
}: {
  moment: MomentFeedCard;
  first: boolean;
  rail: HTMLDivElement | null;
  railNear: boolean;
  heroSettled: boolean;
  onHeroSettled?: () => void;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const near = useNearViewport(el, { root: rail, rootMargin: "0px 50% 0px 0px", waitForRoot: true });
  return (
    <div ref={setEl} className="w-[85vw] shrink-0 snap-start sm:w-[45%] lg:w-[31%]">
      <MomentDiscoveryCard
        moment={moment}
        className="h-full"
        load={railNear && (first || (near && heroSettled))}
        heroOnly={first && !heroSettled}
        onHeroSettled={onHeroSettled}
        eager
        heroFetchPriority={first ? "high" : undefined}
        sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 85vw"
      />
    </div>
  );
}

/** /moments feed: the first card's hero loads with the page (preloaded,
 * high priority); then the rest of that card, and every other card once
 * it is within 150px of the viewport — offscreen cards never compete with
 * the first view. */
function MomentGrid({ cards }: { cards: MomentFeedCard[] }) {
  const [heroSettled, settleHero] = useHeroHeadStart(cards.length > 0);
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((m, i) => (
        <GridMoment key={m.id} moment={m} first={i === 0} heroSettled={heroSettled} onHeroSettled={i === 0 ? settleHero : undefined} />
      ))}
    </div>
  );
}

function GridMoment({ moment, first, heroSettled, onHeroSettled }: { moment: MomentFeedCard; first: boolean; heroSettled: boolean; onHeroSettled?: () => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const near = useNearViewport(el, { rootMargin: "150px 0px" });
  return (
    <div ref={setEl} className="min-w-0">
      <MomentDiscoveryCard
        moment={moment}
        className="h-full"
        priority={first}
        eager
        load={first || (near && heroSettled)}
        heroOnly={first && !heroSettled}
        onHeroSettled={onHeroSettled}
        sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw"
      />
    </div>
  );
}
