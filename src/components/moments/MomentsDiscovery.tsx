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
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:gap-4 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visible.map((m) => (
              <MomentDiscoveryCard
                key={m.id}
                moment={m}
                sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 85vw"
                className="w-[85vw] shrink-0 snap-start sm:w-[45%] lg:w-[31%]"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((m, i) => (
              <MomentDiscoveryCard key={m.id} moment={m} priority={i < 2} sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw" />
            ))}
          </div>
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
