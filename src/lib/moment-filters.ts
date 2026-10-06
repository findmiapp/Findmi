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
  ],
  "pop-ups": ["markets-pop-ups", "market"],
  classes: ["workshops-classes", "classes-workshops"],
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
}

/** Does a Moment match a filter? `follows` is this device's follow lists
 * (only consulted for "following"). */
export function momentMatchesFilter(
  moment: { tags: readonly MomentFilterKey[]; follow: MomentFollowKeys },
  filter: MomentFilterKey,
  follows: MomentFollowKeys
): boolean {
  if (filter === "for-you") return true;
  if (filter === "following") {
    return (
      moment.follow.businessSlugs.some((s) => follows.businessSlugs.includes(s)) ||
      moment.follow.eventIds.some((id) => follows.eventIds.includes(id)) ||
      moment.follow.locationIds.some((id) => follows.locationIds.includes(id))
    );
  }
  return moment.tags.includes(filter);
}
