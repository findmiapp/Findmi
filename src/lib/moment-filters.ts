// Findmi Moments discovery — filter definitions. Pure and dependency-free
// (tests/moment-collage.test.mjs). Every filter is backed by a REAL
// structured relationship of the Moment — never by guessing from text:
//
//   for-you    the default feed: every public Moment, newest experience
//              first (deterministic; no personalization is claimed).
//   following  Moments connected to a Business / Event / Location THIS
//              device follows (Findmi's per-device follow lists).
//   food-drink / pop-ups / classes / outdoors
//              Moments whose connected Business, Event or Location carries
//              one of the listed category slugs.
//
// "Nearby" is intentionally absent: there is no visitor location (Findmi
// never asks for precise location here) and every public Moment today is
// in a single market, so a "Nearby" result would be indistinguishable from
// "For You" — i.e. fake. Add it once market selection or real location
// exists.

export type MomentFilterKey = "for-you" | "following" | "food-drink" | "pop-ups" | "classes" | "outdoors";

/** Category slugs (businesses, events and Locations share one taxonomy
 * table, with `kind`) that put a Moment in each category filter. */
export const MOMENT_CATEGORY_FILTERS: Record<Exclude<MomentFilterKey, "for-you" | "following">, readonly string[]> = {
  "food-drink": [
    "food-drink",
    "coffee",
    "bakery-sweets",
    "food-truck",
    "food-festival",
    "cafe-coffee-shop",
    "restaurant",
    "bar-lounge",
    "brewery-taproom",
    // Event Taxonomy V1 — Food & Drink's Event subcategories (Food
    // Festivals keeps its food-festival slug above).
    "coffee-tea",
    "tastings-drinks",
    "dining-experiences",
    "baking-sweets",
  ],
  // markets-pop-ups is the Event "Markets & Fairs" subcategory now (same
  // id and slug), so this filter is unchanged.
  "pop-ups": ["markets-pop-ups", "market"],
  // workshops-classes is the top-level Event "Classes & Workshops" (same id
  // and slug) — its subcategories count too.
  classes: ["workshops-classes", "classes-workshops", "cooking-classes", "art-craft-classes", "professional-skill-building"],
  outdoors: ["park-outdoor-space"],
};

export const MOMENT_FILTER_LABELS: Record<MomentFilterKey, string> = {
  "for-you": "For You",
  following: "Following",
  "food-drink": "Food & Drink",
  "pop-ups": "Pop-Ups",
  classes: "Classes & Workshops",
  outdoors: "Outdoors",
};

/** Always-visible filters, then the ones behind "More". */
export const PRIMARY_MOMENT_FILTERS: readonly MomentFilterKey[] = ["for-you", "following", "food-drink", "pop-ups"];
export const MORE_MOMENT_FILTERS: readonly MomentFilterKey[] = ["classes", "outdoors"];

export const isMomentFilterKey = (v: unknown): v is MomentFilterKey =>
  typeof v === "string" && (v in MOMENT_FILTER_LABELS);

/** Category-filter tags for one Moment from the category slugs of its
 * connected Business(es), Event(s) and Location. */
export function momentCategoryTags(categorySlugs: readonly string[]): MomentFilterKey[] {
  const set = new Set(categorySlugs);
  return (Object.keys(MOMENT_CATEGORY_FILTERS) as (keyof typeof MOMENT_CATEGORY_FILTERS)[]).filter((k) =>
    MOMENT_CATEGORY_FILTERS[k].some((slug) => set.has(slug))
  );
}

export interface MomentFollowKeys {
  businessSlugs: readonly string[];
  eventIds: readonly string[];
  locationIds: readonly string[];
  /** Business ids — a Moment's connected Businesses plus its Business
   * author (author_business_id); a viewer's account follows. Optional:
   * legacy device follow lists only carry slugs. */
  businessIds?: readonly string[];
}

/** How many entities a viewer follows (any kind). */
export function followCount(follows: MomentFollowKeys): number {
  return follows.businessSlugs.length + follows.eventIds.length + follows.locationIds.length + (follows.businessIds?.length ?? 0);
}

/** Following's empty state — "you follow nothing" and "nothing new from what
 * you follow" are different situations and never share copy. */
export function followingEmptyMessage(follows: MomentFollowKeys): string {
  return followCount(follows) === 0
    ? "Follow a Business, Event or Location to see its Moments here."
    : "Nothing new from the Pages you follow yet — check back soon.";
}

/** Merges two follow lists (account + this device's legacy lists). */
export function mergeFollowKeys(a: MomentFollowKeys, b: MomentFollowKeys): MomentFollowKeys {
  const u = (x: readonly string[] = [], y: readonly string[] = []) => [...new Set([...x, ...y])];
  return { businessSlugs: u(a.businessSlugs, b.businessSlugs), eventIds: u(a.eventIds, b.eventIds), locationIds: u(a.locationIds, b.locationIds), businessIds: u(a.businessIds, b.businessIds) };
}

/** Does a Moment match a filter? `follows` is the viewer's follows — their
 * account follows when signed in, plus this device's legacy lists (only
 * consulted for "following"). */
export function momentMatchesFilter(
  moment: { tags: readonly MomentFilterKey[]; follow: MomentFollowKeys },
  filter: MomentFilterKey,
  follows: MomentFollowKeys
): boolean {
  if (filter === "for-you") return true;
  if (filter === "following") {
    return (
      moment.follow.businessSlugs.some((s) => follows.businessSlugs.includes(s)) ||
      (moment.follow.businessIds ?? []).some((id) => (follows.businessIds ?? []).includes(id)) ||
      moment.follow.eventIds.some((id) => follows.eventIds.includes(id)) ||
      moment.follow.locationIds.some((id) => follows.locationIds.includes(id))
    );
  }
  return moment.tags.includes(filter);
}

// ── Feed modes: Explore vs For You ─────────────────────────────────────────
//
// ONE canonical Moments system, two feed modes over the same public cards:
//
//   explore   the broad Findmi Moment network, newest experience first —
//             useful signed in or out.
//   for-you   personal ordering from the viewer's OWN explicit signals:
//             Moments connected to a Business / Event / Location they
//             follow (account follows when signed in, plus this device's
//             lists) come first. Nothing is inferred or invented; with no
//             signals, For You says so and falls back to the network order.
//
// Each mode owns its own category (Explore → Food & Drink never forces Food
// & Drink onto For You). The URL carries the active mode and that mode's
// category (?mode=for-you&cat=pop-ups); the legacy ?filter= param still
// lands (following → For You, a category → Explore + that category).

export type MomentFeedMode = "explore" | "for-you";
export type MomentCategoryKey = "all" | keyof typeof MOMENT_CATEGORY_FILTERS;

export const MOMENT_FEED_MODES: readonly MomentFeedMode[] = ["explore", "for-you"];
export const MOMENT_FEED_MODE_LABELS: Record<MomentFeedMode, string> = { explore: "Explore", "for-you": "For You" };
export const MOMENT_CATEGORY_KEYS: readonly MomentCategoryKey[] = ["all", "food-drink", "pop-ups", "classes", "outdoors"];
export const MOMENT_CATEGORY_LABELS: Record<MomentCategoryKey, string> = {
  all: "All",
  "food-drink": MOMENT_FILTER_LABELS["food-drink"],
  "pop-ups": MOMENT_FILTER_LABELS["pop-ups"],
  classes: MOMENT_FILTER_LABELS.classes,
  outdoors: MOMENT_FILTER_LABELS.outdoors,
};

export const isMomentFeedMode = (v: unknown): v is MomentFeedMode => v === "explore" || v === "for-you";
export const isMomentCategoryKey = (v: unknown): v is MomentCategoryKey => typeof v === "string" && (MOMENT_CATEGORY_KEYS as readonly string[]).includes(v);

// The URL carries mode, that mode's category and the display:
//   /moments                          Explore · All · Feed
//   /moments?mode=for-you&cat=pop-ups For You · Pop-Ups
//   /moments?mode=my-moments          My Moments (the viewer's own)
//   …&display=map                     the same dataset on the map
// The legacy ?filter= still lands (following → For You, a category →
// Explore + that category, a retired My Moments type filter → All).

export type MomentsPageMode = MomentFeedMode | "my-moments";
export type MomentsDisplay = "feed" | "map";
export const isMomentsDisplay = (v: unknown): v is MomentsDisplay => v === "feed" || v === "map";

export interface MomentFeedState {
  mode: MomentsPageMode;
  /** Each mode's own category. */
  categories: Record<MomentsPageMode, MomentCategoryKey>;
  display: MomentsDisplay;
}

/** URL → feed state. Default: Explore, All, Feed. */
export function parseMomentFeedState(params: { mode?: unknown; cat?: unknown; filter?: unknown; display?: unknown }): MomentFeedState {
  const categories: Record<MomentsPageMode, MomentCategoryKey> = { explore: "all", "for-you": "all", "my-moments": "all" };
  const display: MomentsDisplay = isMomentsDisplay(params.display) ? params.display : "feed";
  if (isMomentFeedMode(params.mode) || params.mode === "my-moments") {
    const mode = params.mode as MomentsPageMode;
    if (isMomentCategoryKey(params.cat)) categories[mode] = params.cat;
    return { mode, categories, display };
  }
  // Legacy ?filter=
  if (params.filter === "following") return { mode: "for-you", categories, display };
  if (isMomentCategoryKey(params.filter) && params.filter !== "all") return { mode: "explore", categories: { ...categories, explore: params.filter }, display };
  return { mode: "explore", categories, display };
}

/** Feed state → query string (active mode + its category + display). */
export function momentFeedQuery(mode: MomentsPageMode, category: MomentCategoryKey, cursor?: string | null, display: MomentsDisplay = "feed"): string {
  const qs = new URLSearchParams();
  if (mode !== "explore") qs.set("mode", mode);
  if (category !== "all") qs.set("cat", category);
  if (display !== "feed") qs.set("display", display);
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

/** Is a Moment in a category ("all" = every Moment)? */
export function momentInCategory(moment: { tags: readonly MomentFilterKey[] }, category: MomentCategoryKey): boolean {
  return category === "all" || moment.tags.includes(category);
}

/** For You ordering from the viewer's follows: Moments connected to
 * something they follow first (network order kept within each group), then
 * the rest. `personalized` is false when there is no signal at all, so the
 * UI can say so instead of pretending. */
export function orderForYou<T extends { tags: readonly MomentFilterKey[]; follow: MomentFollowKeys }>(
  cards: readonly T[],
  follows: MomentFollowKeys
): { fromFollows: T[]; more: T[]; personalized: boolean } {
  const personalized = followCount(follows) > 0;
  if (!personalized) return { fromFollows: [], more: [...cards], personalized };
  const fromFollows: T[] = [];
  const more: T[] = [];
  for (const c of cards) (momentMatchesFilter(c, "following", follows) ? fromFollows : more).push(c);
  return { fromFollows, more, personalized };
}

// ── My Moments: the third mode ─────────────────────────────────────────────
//
// /moments has three modes over ONE card system: Explore and For You
// (discovery over the public network, client-side over one loaded page) and
// My Moments — the signed-in person's OWN Moments, the same journal_entries
// read owner-scoped on the server (lib/moment-discovery getMomentFeed with
// `owner`), drafts and private Moments badged. Their chronological history
// is My Journal (/journal). Signed out, My Moments explains itself and
// offers Log In / Create Account that return to it — never a fake empty state.

export const MOMENTS_PAGE_MODES: readonly MomentsPageMode[] = ["explore", "for-you", "my-moments"];
export const MOMENTS_PAGE_MODE_LABELS: Record<MomentsPageMode, string> = { ...MOMENT_FEED_MODE_LABELS, "my-moments": "My Moments" };

/** Page size of the viewer's own Moments on /moments. */
export const MY_MOMENTS_LIMIT = 48;

/** My Journal — the personal chronological history of the viewer's Moments. */
export const MY_JOURNAL_HREF = "/journal";

/** The one Moment composer (signed-out visitors may start a Moment there). */
export const ADD_MOMENT_HREF = "/my-world/journal/new";

/** Where each mode lives (deterministic, shareable URLs). */
export function momentsModeHref(mode: MomentsPageMode, display: MomentsDisplay = "feed"): string {
  const q = momentFeedQuery(mode, "all", null, display);
  return q ? `/moments?${q}` : "/moments";
}

/** Log In / Create Account links that come straight back to My Moments.
 * The return target is a fixed same-origin path (getSafeRedirect re-checks
 * it on arrival), never caller input. */
export function myMomentsAuthHrefs(): { login: string; signup: string } {
  const next = encodeURIComponent(momentsModeHref("my-moments"));
  return { login: `/login?next=${next}`, signup: `/signup?next=${next}` };
}

/** Board navigation: the next / previous view in a fixed sequence, or null
 * at either end (a swipe past the end does nothing). */
export function adjacentBoard<T>(order: readonly T[], current: T, direction: 1 | -1): T | null {
  const i = order.indexOf(current);
  if (i === -1) return null;
  const next = order[i + direction];
  return next === undefined ? null : next;
}

/** A completed horizontal swipe? Dominantly horizontal and long enough, so
 * vertical page scrolling never changes the view by accident. */
export const BOARD_SWIPE_MIN_PX = 56;
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (Math.abs(dx) < BOARD_SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 1 : -1;
}
