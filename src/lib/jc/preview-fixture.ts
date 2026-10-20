// DEVELOPMENT-ONLY PREVIEW FIXTURE — fictional Jersey City-style content
// used to evaluate the JC design while Production has almost no Jersey
// City records. Never written anywhere: it only exists in memory, is only
// read when jcPreviewEnabled() (config.ts) is true, and every venue/event
// name here is invented. Delete this file and its one import in data.ts to
// remove it entirely.
//
// Dates are generated relative to "now" so the fixture always exercises
// Today / This Weekend / This Week — plus one deliberately past date and
// one past event that must never render (freshness check).

import { APP_TIMEZONE } from "../format";
import type { JcEvent, JcEventDate, JcNeighborhood, JcPlaceDetail } from "./types";

const u = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=70`;

export const PREVIEW_NEIGHBORHOODS: JcNeighborhood[] = [
  { slug: "downtown", name: "Downtown", image: u("1477959858617-67f85cf4f1df") },
  { slug: "the-heights", name: "The Heights", image: u("1449824913935-59a10b8d2000") },
  { slug: "journal-square", name: "Journal Square", image: u("1519501025264-65ba15a82390") },
  { slug: "hamilton-park", name: "Hamilton Park", image: u("1500530855697-b586d89ba3ee") },
  { slug: "paulus-hook", name: "Paulus Hook", image: u("1496442226666-8d4d0e62e6e9") },
  { slug: "bergen-lafayette", name: "Bergen-Lafayette", image: u("1444723121867-7a241cacace9") },
];

const hood = (slug: string) => PREVIEW_NEIGHBORHOODS.find((n) => n.slug === slug) ?? null;

// ---- time helpers (America/New_York wall clock → real ISO instants)

function localDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(d);
}

/** Offset (minutes) of APP_TIMEZONE from UTC at roughly that instant. */
function zoneOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, timeZoneName: "shortOffset" }).formatToParts(at);
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  if (!m) return -300;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

function at(offsetDays: number, hour: number, minute = 0): string {
  const [y, mo, d] = localDate(offsetDays).split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, hour, minute));
  return new Date(guess.getTime() - zoneOffsetMinutes(guess) * 60_000).toISOString();
}

function daysUntilSaturday(): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, weekday: "short" }).format(new Date());
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return idx === 6 ? 0 : idx === 0 ? -1 : 6 - idx;
}

// ---- places

type P = Omit<JcPlaceDetail, "upcoming">;
const place = (p: Partial<P> & Pick<P, "slug" | "name" | "categorySlug" | "categoryLabel"> & { hood: string; img: string; created?: number }): P => ({
  id: `preview-place-${p.slug}`,
  slug: p.slug,
  name: p.name,
  image: u(p.img),
  categorySlug: p.categorySlug,
  categoryLabel: p.categoryLabel,
  neighborhood: hood(p.hood),
  createdAt: new Date(Date.now() - (p.created ?? 120) * 86_400_000).toISOString(),
  description: p.description ?? null,
  address: p.address ?? null,
  website: null,
  phone: null,
  gallery: p.gallery ?? [],
});

const PLACES: P[] = [
  place({ slug: "harbor-roast", name: "Harbor Roast", categorySlug: "cafe-coffee-shop", categoryLabel: "Coffee", hood: "paulus-hook", img: "1501339847302-ac426a4a7cbb", created: 6, address: "Grand St, Jersey City", description: "A bright corner espresso bar a block from the water. Single-origin pour-overs, cardamom buns on weekends, and a long window bench made for slow mornings.", gallery: [u("1495474472287-4d71bcdd2085"), u("1509042239860-f550ce710b93"), u("1554118811-1e0d58224f24")] }),
  place({ slug: "pavonia-coffee-co", name: "Pavonia Coffee Co.", categorySlug: "cafe-coffee-shop", categoryLabel: "Coffee", hood: "downtown", img: "1559925393-8be0ec4767c8", address: "Newark Ave, Jersey City", description: "Neighborhood roaster with a tiny back patio." }),
  place({ slug: "the-reservoir-cafe", name: "The Reservoir Café", categorySlug: "cafe-coffee-shop", categoryLabel: "Coffee", hood: "the-heights", img: "1554118811-1e0d58224f24", address: "Central Ave, Jersey City" }),
  place({ slug: "lantern-and-salt", name: "Lantern & Salt", categorySlug: "restaurant", categoryLabel: "Restaurant", hood: "hamilton-park", img: "1517248135467-4c7edcad34c4", created: 9, address: "Jersey Ave, Jersey City", description: "Wood-fired seasonal plates in a converted brick rowhouse facing the park." }),
  place({ slug: "newark-ave-noodle-bar", name: "Newark Ave Noodle Bar", categorySlug: "restaurant", categoryLabel: "Restaurant", hood: "journal-square", img: "1555396273-367ea4eb4db5", address: "Newark Ave, Jersey City" }),
  place({ slug: "marin-pizza-club", name: "Marin Pizza Club", categorySlug: "restaurant", categoryLabel: "Restaurant", hood: "downtown", img: "1513104890138-7c749659a591", address: "Marin Blvd, Jersey City" }),
  place({ slug: "the-dry-dock", name: "The Dry Dock", categorySlug: "bar-lounge", categoryLabel: "Bar", hood: "paulus-hook", img: "1514933651103-005eec06c04b", address: "Morris St, Jersey City" }),
  place({ slug: "ninth-street-taproom", name: "Ninth Street Taproom", categorySlug: "brewery-taproom", categoryLabel: "Taproom", hood: "the-heights", img: "1470337458703-46ad1756a187", created: 4, address: "Ninth St, Jersey City" }),
  place({ slug: "liberty-pier-lawn", name: "Liberty Pier Lawn", categorySlug: "park-outdoor-space", categoryLabel: "Outdoors", hood: "downtown", img: "1500530855697-b586d89ba3ee", address: "Hudson River Waterfront" }),
  place({ slug: "studio-on-monticello", name: "Studio on Monticello", categorySlug: "gallery", categoryLabel: "Gallery", hood: "bergen-lafayette", img: "1531058020387-3be344556be6", created: 12, address: "Monticello Ave, Jersey City", description: "A volunteer-run gallery and print studio showing local artists every month." }),
  place({ slug: "second-hand-stories", name: "Second Hand Stories", categorySlug: "retail-store", categoryLabel: "Shop", hood: "journal-square", img: "1441986300917-64674bd600d8", address: "Bergen Ave, Jersey City" }),
];

// ---- events

/** Raw, Findmi-shaped attendance/privacy fields — data.ts runs the shared
 * domain rules (resolveEventCtas, rsvpActionLabel, isLocationHidden) on
 * these exactly as it does on real event rows. */
export interface PreviewAttendance {
  tickets_enabled: boolean;
  tickets_url: string | null;
  rsvp_enabled: boolean;
  rsvp_url: string | null;
  rsvp_cta: "rsvp" | "register" | null;
  external_url: string | null;
  location_visibility: "exact" | "broad" | "hidden" | "none" | null;
}

export type PreviewDate = JcEventDate & { ticket_url_override: string | null; rsvp_url_override: string | null };

export type E = JcEvent & {
  description: string | null;
  address: string | null;
  organizer: string | null;
  attendance: PreviewAttendance;
  dates: PreviewDate[];
  placeSlug: string | null;
};

const TZ = APP_TIMEZONE;
const NO_ATTENDANCE: PreviewAttendance = { tickets_enabled: false, tickets_url: null, rsvp_enabled: false, rsvp_url: null, rsvp_cta: null, external_url: null, location_visibility: "exact" };

const event = (e: { slug: string; title: string; img: string; day: number; start: number | null; end: number | null; hood: string; venue: string; cats: string[]; label: string; placeSlug?: string; featured?: boolean; desc?: string; extraDays?: number[]; attendance?: Partial<PreviewAttendance> }): E => {
  const dates: PreviewDate[] = [e.day, ...(e.extraDays ?? [])].map((d, i) => ({
    id: `preview-occ-${e.slug}-${i}`,
    date: localDate(d),
    startAt: e.start === null ? null : at(d, e.start),
    endAt: e.end === null ? null : at(d, e.end),
    timezone: TZ,
    venue: e.venue,
    cancelled: false,
    ticket_url_override: null,
    rsvp_url_override: null,
  }));
  const attendance = { ...NO_ATTENDANCE, ...e.attendance };
  const hidden = attendance.location_visibility === "hidden";
  return {
    id: `preview-event-${e.slug}`,
    slug: e.slug,
    title: e.title,
    image: u(e.img),
    startAt: dates[0].startAt,
    endAt: dates[0].endAt,
    date: dates[0].date,
    timezone: TZ,
    venue: hidden ? null : e.venue,
    neighborhood: hood(e.hood),
    categorySlugs: e.cats,
    categoryLabel: e.label,
    featured: !!e.featured,
    createdAt: null,
    description: e.desc ?? null,
    address: null,
    organizer: null,
    attendance,
    dates: hidden ? dates.map((d) => ({ ...d, venue: null })) : dates,
    placeSlug: hidden ? null : (e.placeSlug ?? null),
  };
};

const TICKETS = (url = "https://example.com/tickets"): Partial<PreviewAttendance> => ({ tickets_enabled: true, tickets_url: url });

function buildEvents(): E[] {
  const sat = daysUntilSaturday();
  return [
    event({ slug: "sunset-sessions-on-the-pier", title: "Sunset Sessions on the Pier", img: "1459749411175-04bf5292ceea", day: 0, start: 17, end: 21, hood: "downtown", venue: "Liberty Pier Lawn", placeSlug: "liberty-pier-lawn", cats: ["live-music"], label: "Live Music", featured: true, attendance: { rsvp_enabled: true, rsvp_url: "https://example.com/rsvp" }, desc: "Local bands, a skyline sunset and food trucks along the waterfront. Bring a blanket." }),
    event({ slug: "heights-night-market", title: "Heights Night Market", img: "1488459716781-31db52582fe9", day: 0, start: 16, end: 22, hood: "the-heights", venue: "Riverview Park", cats: ["markets-pop-ups"], label: "Market", attendance: { external_url: "https://example.com/market" }, desc: "Forty-plus local makers, dumplings, natural wine and a DJ under string lights." }),
    event({ slug: "latte-art-throwdown", title: "Latte Art Throwdown", img: "1509042239860-f550ce710b93", day: 1, start: 19, end: 22, hood: "paulus-hook", venue: "Harbor Roast", placeSlug: "harbor-roast", cats: ["coffee-tea"], label: "Coffee", attendance: TICKETS() }),
    event({ slug: "first-friday-open-studios", title: "First Friday Open Studios", img: "1541701494587-cb58502866ab", day: Math.max(sat - 1, 2), start: 18, end: 22, hood: "bergen-lafayette", venue: "Studio on Monticello", placeSlug: "studio-on-monticello", cats: ["art-exhibitions"], label: "Art" }),
    event({ slug: "vintage-flea-on-grove", title: "Vintage Flea on Grove", img: "1441986300917-64674bd600d8", day: sat, start: 10, end: 16, hood: "downtown", venue: "Grove Street Plaza", cats: ["vintage-resale"], label: "Pop-Up", featured: true, attendance: { rsvp_enabled: true, rsvp_url: "https://example.com/flea", rsvp_cta: "register" }, extraDays: [sat + 7, sat + 14], desc: "Racks of vintage denim, records, ceramics and film cameras. Every Saturday through the season." }),
    event({ slug: "hamilton-park-run-club", title: "Hamilton Park Run Club", img: "1452626038306-9aae5e071dd3", day: sat, start: 8, end: 10, hood: "hamilton-park", venue: "Hamilton Park", cats: ["running"], label: "Run Club" }),
    event({ slug: "dumpling-pop-up-supper", title: "Dumpling Pop-Up Supper", img: "1496116218417-1a781b1c416c", day: sat + 1, start: 18, end: 21, hood: "journal-square", venue: "Newark Ave Noodle Bar", placeSlug: "newark-ave-noodle-bar", cats: ["dining-experiences"], label: "Pop-Up", attendance: TICKETS() }),
    event({ slug: "comedy-in-the-cellar", title: "Comedy in the Cellar", img: "1527224857830-43a7acc85260", day: sat + 1, start: 20, end: 22, hood: "the-heights", venue: "Ninth Street Taproom", placeSlug: "ninth-street-taproom", cats: ["comedy"], label: "Comedy", attendance: TICKETS() }),
    event({ slug: "waterfront-film-night", title: "Waterfront Film Night", img: "1489599849927-2ee91cede3ba", day: 4, start: 19, end: 22, hood: "downtown", venue: "Liberty Pier Lawn", placeSlug: "liberty-pier-lawn", cats: ["film-screenings"], label: "Film" }),
    event({ slug: "natural-wine-tasting", title: "Natural Wine Tasting", img: "1510812431401-41d2bd2722f3", day: 5, start: 18, end: 20, hood: "hamilton-park", venue: "Lantern & Salt", placeSlug: "lantern-and-salt", cats: ["tastings-drinks"], label: "Tasting", attendance: TICKETS() }),
    // Date-only (no published time) — must never be shown with a time:
    event({ slug: "harvest-weekend-on-newark-ave", title: "Harvest Weekend on Newark Ave", img: "1500530855697-b586d89ba3ee", day: sat, start: null, end: null, hood: "journal-square", venue: "Newark Ave Pedestrian Plaza", cats: ["local-festivals-street-fairs"], label: "Festival" }),
    // Organizer withholds the address until registration:
    event({ slug: "secret-supper-club", title: "Secret Supper Club", img: "1414235077428-338989a2e8c0", day: 3, start: 19, end: 22, hood: "downtown", venue: "Undisclosed loft", placeSlug: "lantern-and-salt", cats: ["dining-experiences"], label: "Supper Club", attendance: { rsvp_enabled: true, rsvp_url: "https://example.com/supper", rsvp_cta: "register", location_visibility: "hidden" } }),
    // Freshness check — must never render anywhere:
    event({ slug: "last-weeks-block-party", title: "Last Week's Block Party", img: "1492684223066-81342ee5ff30", day: -6, start: 12, end: 18, hood: "downtown", venue: "Grove Street Plaza", cats: ["local-festivals-street-fairs"], label: "Festival" }),
  ];
}

// Partial past/future: one recurring event also carries an expired date,
// which data.ts must drop.
export function previewEvents(): E[] {
  const events = buildEvents();
  const flea = events.find((e) => e.slug === "vintage-flea-on-grove");
  if (flea) {
    flea.dates.unshift({ id: "preview-occ-flea-past", date: localDate(-7), startAt: at(-7, 10), endAt: at(-7, 16), timezone: TZ, venue: flea.venue, cancelled: false, ticket_url_override: null, rsvp_url_override: null });
  }
  return events;
}

/** Mirror of the real Findmi event-category hierarchy (categories table,
 * kind = event) for the slugs the fixture uses — so JC's module
 * resolution runs the same shared parent → child rule offline. */
export const PREVIEW_EVENT_CATEGORIES: { id: string; slug: string; parent_id: string | null }[] = [
  ["arts-culture", null], ["art-exhibitions", "arts-culture"], ["film-screenings", "arts-culture"],
  ["entertainment", null], ["comedy", "entertainment"],
  ["music-nightlife", null], ["live-music", "music-nightlife"],
  ["food-drink", null], ["coffee-tea", "food-drink"], ["dining-experiences", "food-drink"], ["tastings-drinks", "food-drink"],
  ["shopping-retail", null], ["markets-pop-ups", "shopping-retail"], ["vintage-resale", "shopping-retail"],
  ["community-social", null], ["local-festivals-street-fairs", "community-social"],
  ["sports-fitness", null], ["running", "sports-fitness"],
  ["workshops-classes", null],
].map(([slug, parent]) => ({ id: `cat-${slug}`, slug: slug as string, parent_id: parent ? `cat-${parent}` : null }));

export function previewPlaces(): P[] {
  return PLACES;
}
