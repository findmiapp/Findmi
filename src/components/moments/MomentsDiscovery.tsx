"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MomentFeedCard } from "@/lib/moment-discovery";
import {
  MOMENT_CATEGORY_KEYS,
  MOMENT_CATEGORY_LABELS,
  MOMENTS_PAGE_MODE_LABELS,
  MY_JOURNAL_HREF,
  adjacentBoard,
  forYouAuthHrefs,
  mergeFollowKeys,
  momentFeedQuery,
  momentInCategory,
  orderForYou,
  type MomentCategoryKey,
  type MomentFeedState,
  type MomentFollowKeys,
  type MomentsDisplay,
  type MomentsPageMode,
} from "@/lib/moment-filters";
import { getFollowedSlugs } from "@/lib/followed";
import { getFollowedEventIds } from "@/lib/followedEvents";
import { getFollowedLocationIds } from "@/lib/followedLocations";
import { getAccountSession } from "@/lib/accountSession";
import ChevronIcon from "@/components/ChevronIcon";
import MomentDiscoveryCard from "./MomentDiscoveryCard";
import MomentsModeTabs from "./MomentsModeTabs";
import { useBoardSwipe } from "./useBoardSwipe";
import { useNearViewport } from "./useNearViewport";
import MomentsMap from "./MomentsMap";
import { VIEW_MODE_ICONS } from "@/components/map/ViewModeSwitch";

const NO_FOLLOWS: MomentFollowKeys = { businessSlugs: [], eventIds: [], locationIds: [] };
const DEFAULT_STATE: MomentFeedState = { mode: "explore", categories: { explore: "all", "for-you": "all", "my-moments": "all" }, display: "feed" };

/** Findmi Moments — ONE canonical Moments feed and card system for all
 * three modes (lib/moment-filters). Explore and For You run over the same
 * public cards; My Moments renders the viewer's OWN cards (loaded
 * owner-scoped by /moments) through the very same chips, cards and map —
 * the mode changes the dataset, never the presentation:
 *   Explore  the broad Findmi network, newest experience first.
 *   For You  the viewer's own signals first — Moments connected to what
 *            they follow (account follows when signed in, plus this
 *            device's lists; read after mount so server and client render
 *            match) — then the rest. With no signal it says so and shows
 *            the network order; it never pretends to personalize.
 * Each mode keeps its OWN category (switching mode never carries the other
 * mode's category). Category chips are a horizontally swipeable rail with
 * the page gutter; a category chip only appears when a loaded Moment
 * matches it — never an empty, decorative filter. On /moments the URL
 * tracks the active mode, its category and the display (Feed / Map: the
 * same filtered Moments on the shared Findmi map — MomentsMap). The
 * homepage preview passes showModes={false}: no mode switch there, just the
 * category rail and the rail of cards. */
export default function MomentsDiscovery({
  cards,
  layout,
  initialState = DEFAULT_STATE,
  pagination,
  showModes = true,
}: {
  cards: MomentFeedCard[];
  layout: "carousel" | "grid";
  initialState?: MomentFeedState;
  /** /moments only: keyset pagination links (mode + category carried along). */
  pagination?: { basePath: string; cursor: string | null; nextCursor: string | null };
  showModes?: boolean;
}) {
  const [mode, setMode] = useState<MomentsPageMode>(initialState.mode);
  const [categories, setCategories] = useState<Record<MomentsPageMode, MomentCategoryKey>>(initialState.categories);
  const [display, setDisplay] = useState<MomentsDisplay>(initialState.display);
  // My Moments' cards are the viewer's own (a server read), so switching to
  // Explore / For You from there is a real navigation, not an in-place swap.
  const ownCards = initialState.mode === "my-moments";
  const [follows, setFollows] = useState<MomentFollowKeys>(NO_FOLLOWS);
  const [signedIn, setSignedIn] = useState(false);
  // Until the account follows have loaded, For You's copy would guess — so it waits.
  const [followsReady, setFollowsReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const device: MomentFollowKeys = { businessSlugs: getFollowedSlugs(), eventIds: getFollowedEventIds(), locationIds: getFollowedLocationIds() };
    setFollows(device);
    getAccountSession()
      .then(async (isSignedIn) => {
        if (!isSignedIn) return;
        if (alive) setSignedIn(true);
        const res = await fetch("/api/account/follow-keys");
        if (!res.ok) return;
        const account = (await res.json()) as MomentFollowKeys;
        if (alive) setFollows(mergeFollowKeys(device, account));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setFollowsReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const category = categories[mode];
  const hrefFor = (m: MomentsPageMode, c: MomentCategoryKey, cursor: string | null = null, d: MomentsDisplay = display, base = pagination?.basePath) => {
    if (!base) return "#";
    const q = momentFeedQuery(m, c, cursor, d);
    return q ? `${base}?${q}` : base;
  };
  // /moments: keep the address bar in step (shareable, Back-safe) without a
  // server round trip — the cards are already loaded.
  useEffect(() => {
    if (!pagination || typeof window === "undefined") return;
    const next = hrefFor(mode, category, pagination.cursor);
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, category, display]);

  const chipCategories = MOMENT_CATEGORY_KEYS.filter((k) => k === "all" || k === category || cards.some((c) => momentInCategory(c, k)));
  const inCategory = useMemo(() => cards.filter((c) => momentInCategory(c, category)), [cards, category]);
  const forYou = useMemo(() => orderForYou(inCategory, follows), [inCategory, follows]);
  const visible = mode === "for-you" ? [...forYou.fromFollows, ...forYou.more] : inCategory;
  const showMap = layout === "grid" && display === "map";

  const setCategory = (c: MomentCategoryKey) => setCategories((prev) => ({ ...prev, [mode]: c }));

  // Board navigation: the category chips ARE the board sequence; a swipe on
  // the content moves to the adjacent board (nothing past either end).
  const swipe = useBoardSwipe((dir) => {
    const next = adjacentBoard(chipCategories, category, dir);
    if (next) setCategory(next);
  });
  // Keep the active chip in view after a swipe, without scrolling the page.
  const chipRailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const rail = chipRailRef.current;
    const chip = rail?.querySelector<HTMLElement>('[data-active="true"]');
    if (!rail || !chip) return;
    const left = chip.offsetLeft - rail.offsetLeft;
    if (left < rail.scrollLeft || left + chip.offsetWidth > rail.scrollLeft + rail.clientWidth) rail.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
  }, [category, mode]);

  const unpersonalized = mode === "for-you" && followsReady && !forYou.personalized;
  const forYouNote = unpersonalized && signedIn ? "Follow Businesses, Events and Places to personalize For You. Showing the latest Moments for now." : null;
  // Signed out: a compact, actionable prompt (never a wall) — Log In /
  // Create Account return to exactly this view (mode, category, display).
  const forYouAuth = unpersonalized && !signedIn ? forYouAuthHrefs(hrefFor("for-you", category, null, display, "/moments")) : null;

  const renderCards = (list: MomentFeedCard[]) => (layout === "carousel" ? <MomentCarousel cards={list} /> : <MomentGrid cards={list} />);

  return (
    <div>
      {/* ONE control row: the primary mode selector takes most of the width,
          the compact Feed | Map display selector sits beside it. */}
      {(showModes || layout === "grid") && (
        <div data-moments-controls className="flex items-center gap-2">
          {showModes && (
            <div className="min-w-0 flex-1">
              <MomentsModeTabs active={mode} onSelect={ownCards ? undefined : setMode} display={display} />
            </div>
          )}
          {layout === "grid" && <DisplaySwitch display={display} onChange={setDisplay} />}
        </div>
      )}
      {layout === "grid" && mode === "my-moments" && (
        <div className="mt-2 flex justify-end">
          <Link href={MY_JOURNAL_HREF} className="text-metadata font-semibold text-findmi-700 hover:underline">
            View My Journal
          </Link>
        </div>
      )}

      <div
        ref={chipRailRef}
        role="group"
        aria-label={`Filter ${MOMENTS_PAGE_MODE_LABELS[mode]} by category`}
        className="-mx-4 mt-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:-mx-6 sm:scroll-px-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {chipCategories.map((key) => {
          const active = key === category;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              data-active={active ? "true" : undefined}
              onClick={() => setCategory(key)}
              className={`h-8 shrink-0 snap-start rounded-full px-3.5 text-metadata font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi focus-visible:ring-offset-1 ${
                active ? "bg-findmi-600 text-white" : "border border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
              }`}
            >
              {MOMENT_CATEGORY_LABELS[key]}
            </button>
          );
        })}
        <span aria-hidden="true" className="w-2 shrink-0" />
      </div>

      {forYouNote && <p className="mt-3 text-metadata text-muted">{forYouNote}</p>}
      {forYouAuth && (
        <section aria-label="Personalize For You" data-for-you-auth className="mt-3 rounded-2xl border border-findmi-100 bg-findmi-50/60 px-4 py-3.5">
          <p className="text-sm font-bold text-ink">Personalize For You</p>
          <p className="mt-0.5 text-metadata text-ink/65">Log in or create an account to follow Businesses, Events and Places and get Moments picked for you.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link href={forYouAuth.login} className="inline-flex h-9 items-center rounded-full bg-findmi px-4 text-[13px] font-bold text-white transition hover:bg-findmi-600">
              Log In
            </Link>
            <Link href={forYouAuth.signup} className="inline-flex h-9 items-center rounded-full border border-black/10 bg-white px-4 text-[13px] font-bold text-ink transition hover:border-black/20">
              Create Account
            </Link>
          </div>
          <p className="mt-2.5 text-metadata text-ink/50">Showing the latest Moments for now.</p>
        </section>
      )}

      {showMap ? (
        <div className="mt-4">
          <MomentsMap cards={visible} />
        </div>
      ) : (
        <>
      {layout === "grid" && chipCategories.length > 1 && (
        // Board position: which view of the swipeable sequence is showing.
        <div aria-hidden="true" className="mt-3 flex justify-center gap-1.5 sm:hidden">
          {chipCategories.map((k) => (
            <span key={k} className={`h-1.5 rounded-full transition-all ${k === category ? "w-4 bg-findmi-600" : "w-1.5 bg-black/15"}`} />
          ))}
        </div>
      )}

      <div
        className="mt-4 touch-pan-y"
        // Grid (/moments): swipe the surface left / right to move between
        // category boards. The homepage carousel scrolls sideways itself, so
        // it keeps tap-only chips.
        {...(layout === "grid" ? swipe.handlers : {})}
        style={layout === "grid" && swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : { transition: "transform 180ms ease-out" }}
      >
        {visible.length === 0 ? (
          <p className="rounded-2xl bg-black/[0.03] px-4 py-6 text-sm text-ink/55">No Moments here yet — check back soon.</p>
        ) : mode === "for-you" && layout === "grid" && forYou.personalized ? (
          <div className="flex flex-col gap-8">
            {forYou.fromFollows.length > 0 ? (
              <section aria-label="From What You Follow">
                <h2 className="mb-3 text-card-title font-bold text-primary">From What You Follow</h2>
                {renderCards(forYou.fromFollows)}
              </section>
            ) : (
              <p className="text-metadata text-muted">Nothing new from what you follow yet — here&rsquo;s what&rsquo;s happening on Findmi.</p>
            )}
            {forYou.more.length > 0 && (
              <section aria-label="More On Findmi">
                <h2 className="mb-3 text-card-title font-bold text-primary">More On Findmi</h2>
                {renderCards(forYou.more)}
              </section>
            )}
          </div>
        ) : (
          renderCards(visible)
        )}
      </div>
        </>
      )}

      {pagination && (pagination.nextCursor || pagination.cursor) && (
        <nav className="mt-8 flex items-center justify-between gap-3 text-sm font-semibold">
          {pagination.cursor ? (
            <Link href={hrefFor(mode, category)} className="inline-flex items-center gap-1 text-ink/60 hover:text-ink">
              <ChevronIcon direction="left" className="h-3 w-3" />
              Newest
            </Link>
          ) : (
            <span />
          )}
          {pagination.nextCursor && (
            <Link href={hrefFor(mode, category, pagination.nextCursor)} className="inline-flex items-center gap-1 text-findmi-700 hover:underline">
              Older Moments
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

/** Feed | Map — the same Moments as a feed or on the map. The secondary
 * control beside the mode selector: Findmi's list / map icons (the archive
 * View switch's icon set), labels from 420px up; below that icon-only, each
 * button still named for assistive tech and the pressed one filled Aqua. */
function DisplaySwitch({ display, onChange }: { display: MomentsDisplay; onChange: (d: MomentsDisplay) => void }) {
  const opts: { key: MomentsDisplay; label: string; icon: string }[] = [
    { key: "feed", label: "Feed", icon: VIEW_MODE_ICONS.list },
    { key: "map", label: "Map", icon: VIEW_MODE_ICONS.map },
  ];
  return (
    <div role="group" aria-label="Show Moments as" className="flex shrink-0 rounded-full bg-black/[0.05] p-1">
      {opts.map((o) => {
        const on = display === o.key;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.key)}
            className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
              on ? "bg-findmi text-white shadow-sm" : "text-muted hover:text-primary"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
              <path d={o.icon} />
            </svg>
            <span aria-hidden="true" className="hidden min-[420px]:inline">
              {o.label}
            </span>
          </button>
        );
      })}
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
