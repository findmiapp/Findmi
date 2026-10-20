// JerseyCity.guide view models — the small, presentation-shaped records JC
// components render. Built from real Findmi rows (./data.ts) or, in
// development only, from ./preview-fixture.ts.

export interface JcNeighborhood {
  slug: string;
  name: string;
  image: string | null;
}

export interface JcEvent {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  /** Real stored times of the chosen date — null when not published. */
  startAt: string | null;
  endAt: string | null;
  /** The real calendar date (YYYY-MM-DD) in the date's own timezone. */
  date: string;
  /** The date's own stored timezone (null → app default via zoneOf). */
  timezone: string | null;
  /** Null when unknown or withheld by location privacy. */
  venue: string | null;
  neighborhood: JcNeighborhood | null;
  categorySlugs: string[];
  categoryLabel: string | null;
  featured: boolean;
  createdAt: string | null;
}

export interface JcEventDate {
  id: string;
  date: string;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  venue: string | null;
  cancelled: boolean;
}

export interface JcEventDetail extends JcEvent {
  description: string | null;
  address: string | null;
  organizer: string | null;
  /** The organizer's attendance action for the next date (shared
   * resolveEventCtas decision) — null when there is none. */
  action: { label: string; url: string } | null;
  /** The event's source / details page (never an attendance action). */
  detailsUrl: string | null;
  /** The organizer withholds the address until registration. */
  locationHidden: boolean;
  /** Upcoming dates only — anything already over is never included. */
  dates: JcEventDate[];
  place: JcPlace | null;
}

export interface JcPlace {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  categorySlug: string | null;
  categoryLabel: string | null;
  neighborhood: JcNeighborhood | null;
  createdAt: string | null;
}

export interface JcPlaceDetail extends JcPlace {
  description: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  gallery: string[];
  upcoming: JcEvent[];
}

export type JcWindow = "" | "today" | "weekend" | "week";
