// Discovery Engine V1 — the pure Map/Feed core. The server
// (./map-server.ts) turns canonical rows into MapItems; everything that
// decides WHAT qualifies, HOW it ranks and HOW it is drawn lives here, so
// Map, Feed and (later) Calendar / saved searches share one definition and
// it is fully testable. `now` is always injected.
//
// Eligibility and prominence are separate: matchesMapItem() is the only
// eligibility predicate (deterministic, explainable); rankMapItem() and
// diversify() only ORDER qualifying items — nothing that qualifies is ever
// dropped by ranking, and an explicit Brand search is never capped. In the
// Happening lens time is authoritative instead (orderMapResults): live
// first, then by start — score only breaks ties, no per-Brand cap.
//
// Marker semantics depend on the lens (see mapFeatures):
//   • default / mixed — the Location is the geographic anchor: ONE marker
//     per Location, whose count is the qualifying results there (Eataly
//     with five things on is one marker, not five stacked ones);
//   • Events lens (entities = ["event"]) — one marker per qualifying Event
//     (its soonest qualifying date at that Location).
// Cluster counts sum those per-marker counts, so a cluster always means
// "qualifying results in this area under the current query".

import { formatWhen, hasEnded, isHappeningNow, todayIn, zoneOf, type DatedTimes } from "../event-time";
import { APP_TIMEZONE, dateKeyInZone } from "../format";
import { dayHoursState } from "../locationHours";
import type { LocationHours, LocationWeekday } from "../types";
import { BENEFIT_LABELS, type EntryMode, type EventAudience, type EventBenefit } from "./attributes";
import { entitiesFor, type DiscoveryQuery } from "./query";
import { matchesTime } from "./time";

export type MapItemKind = "event" | "appearance" | "place";
export type Bbox = [number, number, number, number]; // west, south, east, north

export interface MapBrand {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
}

export interface MapLocation {
  id: string;
  name: string;
  /** Only set when the Location is consumer-discoverable (listed + fully
   * imaged — lib/location-eligibility). A non-discoverable Location still
   * anchors the Events happening there (their address is already public
   * in context) but is never linked or offered as a Place. */
  slug: string | null;
  discoverable: boolean;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  area: string | null;
  logo: string | null;
  cover: string | null;
  hours: LocationHours | null;
  timezone: string | null;
}

export interface MapItem extends DatedTimes {
  key: string;
  kind: MapItemKind;
  id: string;
  eventId: string | null;
  eventSlug?: string | null;
  title: string;
  href: string;
  image: string | null;
  /** Canonical Businesses: host / participating / appearing (first = the
   * identity shown). For a Place: Businesses located there. */
  brands: MapBrand[];
  location: MapLocation;
  /** Occurrence/Appearance status as stored (scheduled | cancelled). */
  status: "scheduled" | "cancelled";
  categories: string[];
  formats: string[];
  is_free: boolean | null;
  family_friendly: boolean | null;
  benefits: EventBenefit[];
  audience: EventAudience[];
  entry: EntryMode[];
  rsvp: boolean;
  tickets: boolean;
  featured: boolean;
  created_at: string | null;
  /** Lower-cased words this item can be found by. */
  haystack: string;
  /** Other qualifying dates of the same Event at the same Location folded
   * into this card (set by diversify). */
  moreDates?: number;
}

export interface MatchContext {
  now: Date;
  /** Location ids a `place` query resolved to (the Location + its
   * children). */
  placeIds?: Set<string>;
}

// ------------------------------------------------------------ geometry

export function bboxContains(b: Bbox, lng: number, lat: number): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

export function distanceKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const bboxCenter = (b: Bbox): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** The bounds `factor`× wider around the same center (clamped). */
export function expandBbox(b: Bbox, factor = 2): Bbox {
  const [cx, cy] = bboxCenter(b);
  const hw = ((b[2] - b[0]) / 2) * factor;
  const hh = ((b[3] - b[1]) / 2) * factor;
  return [Math.max(-180, cx - hw), Math.max(-90, cy - hh), Math.min(180, cx + hw), Math.min(90, cy + hh)];
}

/** A square viewport of `radiusMiles` around a point (Near Me, computed on
 * the viewer's own device). */
export function bboxAround(lat: number, lng: number, radiusMiles: number): Bbox {
  const km = radiusMiles * 1.609344;
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

// ------------------------------------------------------------ places: open now

const KEYS: LocationWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** true/false only from the Location's own real hours for TODAY, in its
 * own timezone (app zone when unknown); null = unknown, never "Closed". */
export function openNowAt(hours: LocationHours | null | undefined, now: Date, tz: string | null = null): boolean | null {
  if (!hours) return null;
  const zone = tz || APP_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value.slice(0, 3).toLowerCase() ?? "";
  const key = KEYS.find((k) => k === wd);
  if (!key) return null;
  const day = hours[key];
  const state = dayHoursState(day);
  if (state === "allDay") return true;
  if (state === "closed") return false;
  if (state === "unset" || !day?.open || !day.close) return null;
  const mins = (Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const [oh, om] = day.open.split(":").map(Number);
  const [ch, cm] = day.close.split(":").map(Number);
  return mins >= oh * 60 + om && mins < ch * 60 + cm;
}

// ------------------------------------------------------------ eligibility

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const haystackOf = (...parts: (string | null | undefined)[]) => ` ${norm(parts.filter(Boolean).join(" "))} `;

/** Free-text relevance: every typed word must begin a word of the item's
 * searchable text (case-, accent- and spacing-insensitive; "baby" finds
 * "Babylist", "tabli" finds "Tabli"). Text never decides geography, time
 * or any structured filter — those are separate dimensions. */
export function matchesText(haystack: string, text: string | null | undefined): boolean {
  const words = norm(text).split(" ").filter(Boolean);
  return words.every((w) => haystack.includes(` ${w}`));
}

type TopicLike = { name: string; aliases?: string[] | null; query: { [k: string]: unknown; categories?: string[]; formats?: string[] } };

/** A Topic that only names Event Categories / Formats ("Food + Drink",
 * "Pop-Ups") — subject matter, not time or eligibility. */
export const isTaxonomyTopic = (t: TopicLike) =>
  Boolean(t.query.categories?.length || t.query.formats?.length) && Object.keys(t.query).every((k) => k === "categories" || k === "formats" || k === "catMode");

/** The searchable words an item's own Event taxonomy carries: its Category
 * and Format names, plus the name and aliases of every subject Topic whose
 * stored query names one of them (the canonical Topic → taxonomy link). */
export function taxonomyTerms(categories: readonly string[], formats: readonly string[], names: ReadonlyMap<string, string>, topics: readonly TopicLike[]): string[] {
  if (!categories.length && !formats.length) return [];
  const out = [...categories, ...formats].map((s) => names.get(s) ?? "");
  for (const t of topics) {
    if (!isTaxonomyTopic(t)) continue;
    if (t.query.categories?.some((c) => categories.includes(c)) || t.query.formats?.some((f) => formats.includes(f))) out.push(t.name, ...(t.aliases ?? []));
  }
  return out.filter(Boolean);
}

const some = <T>(want: readonly T[], has: (v: T) => boolean) => want.some(has);
const every = <T>(want: readonly T[], has: (v: T) => boolean) => want.every(has);
const combine = <T>(mode: "any" | "all" | undefined, fallback: "any" | "all", want: readonly T[], has: (v: T) => boolean) =>
  ((mode ?? fallback) === "all" ? every : some)(want, has);

export const isFreeAdmission = (i: Pick<MapItem, "is_free" | "benefits">) => i.is_free === true || i.benefits.includes("free_admission");
export const isFamily = (i: Pick<MapItem, "family_friendly" | "categories" | "audience">) =>
  i.family_friendly === true || i.categories.includes("family-kids") || i.audience.includes("family") || i.audience.includes("kids");

/** Which kinds a query asks for on the map. "business" (Brands) is
 * answered by the places and dated activity those Brands have. */
export function mapKinds(q: DiscoveryQuery): Set<MapItemKind> {
  const out = new Set<MapItemKind>();
  for (const e of entitiesFor(q)) {
    if (e === "event") out.add("event");
    if (e === "appearance" || e === "business") out.add("appearance");
    if (e === "place") out.add("place");
  }
  if (q.open) out.add("place");
  return out;
}

/** THE eligibility predicate (beyond the canonical public-visibility rules
 * the server already applied). Deterministic. Dimensions AND together;
 * values within a dimension combine by that dimension's Any/All mode. */
export function matchesMapItem(i: MapItem, q: DiscoveryQuery, ctx: MatchContext): boolean {
  if (!mapKinds(q).has(i.kind)) return false;
  const now = ctx.now;
  if (q.bbox && !bboxContains(q.bbox as Bbox, i.location.lng, i.location.lat)) return false;
  if (q.place && !(ctx.placeIds?.has(i.location.id) ?? i.location.slug === q.place)) return false;

  if (i.kind === "place") {
    if (!i.location.discoverable) return false;
    if (q.open === "now" && openNowAt(i.location.hours, now, i.location.timezone) !== true) return false;
  } else {
    // Cancelled dates stop qualifying for active discovery.
    if (i.status === "cancelled") return false;
    if (!matchesTime(i, q, now)) return false;
    if (q.endingSoonHours) {
      if (!i.end_at) return false;
      const end = Date.parse(i.end_at);
      if (end < now.getTime() || end > now.getTime() + q.endingSoonHours * 3_600_000) return false;
    }
    if (q.justAnnouncedDays && (!i.created_at || Date.parse(i.created_at) < now.getTime() - q.justAnnouncedDays * 86_400_000)) return false;
    const tax = [...(q.categories ?? []), ...(q.formats ?? [])];
    if (tax.length && !combine(q.catMode, "any", tax, (s) => i.categories.includes(s) || i.formats.includes(s))) return false;
    if (q.benefits?.length && !combine(q.benefitMode, "all", q.benefits, (b) => i.benefits.includes(b) || (b === "free_admission" && i.is_free === true))) return false;
    if (q.free && !isFreeAdmission(i)) return false;
    if (q.paid && i.is_free !== false) return false;
    if (q.family && !isFamily(i)) return false;
    if (q.audience?.length && !q.audience.some((a) => i.audience.includes(a) || (a === "family" && isFamily(i)))) return false;
    if (q.entry?.length && !q.entry.some((m) => i.entry.includes(m) || (m === "rsvp" && i.rsvp) || (m === "ticket" && i.tickets))) return false;
    if (q.access?.length && !q.access.some((a) => (a === "rsvp" ? i.rsvp || i.entry.includes("rsvp") : i.tickets || i.entry.includes("ticket")))) return false;
  }
  if (q.brands?.length && !combine(q.brandMode, "any", q.brands, (s) => i.brands.some((b) => b.slug === s))) return false;
  if (q.text && !matchesText(i.haystack, q.text)) return false;
  return true;
}

// ------------------------------------------------------------ status / labels

export type MapTone = "live" | "soon" | "today" | "later" | "place";

export interface MapStatus {
  /** Short badge word ("LIVE") — never the only signal: `text` repeats the
   * state in words for non-color communication. */
  badge: string | null;
  text: string;
  tone: MapTone;
  live: boolean;
}

const compactTime = (iso: string, tz: string) => {
  const s = new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return s.replace(":00", "");
};

/** Temporal label derived only from the item's real stored state. */
export function mapStatus(i: MapItem, now: Date): MapStatus {
  if (i.kind === "place") {
    const open = openNowAt(i.location.hours, now, i.location.timezone);
    return { badge: null, text: open === true ? "Open Now" : open === false ? "Closed Now" : "", tone: "place", live: false };
  }
  const tz = zoneOf(i);
  if (i.status === "cancelled") return { badge: "Cancelled", text: "Cancelled", tone: "later", live: false };
  if (hasEnded(i, now)) return { badge: null, text: "Ended", tone: "later", live: false };
  if (isHappeningNow(i, now)) {
    const left = Math.round((Date.parse(i.end_at!) - now.getTime()) / 60_000);
    return { badge: "LIVE", text: left <= 60 ? `Ends in ${Math.max(1, left)} min` : `Ends ${compactTime(i.end_at!, tz)}`, tone: "live", live: true };
  }
  const today = todayIn(tz, now);
  if (i.start_at) {
    const mins = Math.round((Date.parse(i.start_at) - now.getTime()) / 60_000);
    if (mins > 0 && mins <= 60) return { badge: null, text: `Starts in ${mins} min`, tone: "soon", live: false };
    const day = dateKeyInZone(new Date(i.start_at), tz);
    if (day === today) return { badge: null, text: `Starts ${compactTime(i.start_at, tz)}`, tone: "today", live: false };
    if (mins <= 0) return { badge: null, text: "On Now", tone: "today", live: false };
  } else if (i.occurrence_date === today || i.start_date === today) {
    return { badge: null, text: "Today", tone: "today", live: false };
  }
  return { badge: null, text: formatWhen(i), tone: "later", live: false };
}

// ------------------------------------------------------------ ranking

export interface PersonalSignals {
  followedIds?: Set<string>;
  savedIds?: Set<string>;
}

export interface RankContext {
  now: Date;
  /** Reference point for proximity (viewport center, or the viewer when
   * they chose Near Me — never persisted). */
  center?: [number, number] | null;
  nearMe?: boolean;
  personal?: PersonalSignals | null;
  /** Labels of the WHAT filters in play ("Coffee", "Free") for the
   * "Matches …" explanation. */
  matchLabels?: string[];
}

export interface RankedMapItem {
  item: MapItem;
  score: number;
  /** Consumer-facing explanations, most important first. Only real
   * signals Findmi actually has. */
  reasons: string[];
  explain: [string, number][];
  distanceKm: number | null;
}

export function rankMapItem(i: MapItem, ctx: RankContext): RankedMapItem {
  const now = ctx.now;
  const explain: [string, number][] = [];
  const reasons: string[] = [];
  const add = (label: string, n: number) => n && explain.push([label, n]);
  const distance = ctx.center ? distanceKm(ctx.center, [i.location.lng, i.location.lat]) : null;

  if (i.kind !== "place") {
    if (isHappeningNow(i, now)) {
      add("Happening Now", 40);
      const left = (Date.parse(i.end_at!) - now.getTime()) / 60_000;
      if (left <= 60) add("Ending Soon", 6);
      if (ctx.nearMe && distance !== null && distance <= 1.5) reasons.push("Happening nearby");
    } else if (i.start_at) {
      const hours = (Date.parse(i.start_at) - now.getTime()) / 3_600_000;
      if (hours > 0 && hours <= 3) add("Starting Soon", 22);
      else {
        const tz = zoneOf(i);
        const days = Math.max(0, Math.round((Date.parse(dateKeyInZone(new Date(i.start_at), tz)) - Date.parse(todayIn(tz, now))) / 86_400_000));
        add(days === 0 ? "Today" : "Soon", Math.max(0, 16 - days * 2));
      }
    } else {
      const date = i.occurrence_date ?? i.start_date;
      if (date) {
        const days = Math.max(0, Math.round((Date.parse(date) - Date.parse(todayIn(zoneOf(i), now))) / 86_400_000));
        add(days === 0 ? "Today" : "Soon", Math.max(0, 12 - days * 2));
      }
    }
  }
  if (distance !== null) add("Nearby", Math.max(0, Math.round(8 - distance * 2)));
  const p = ctx.personal;
  if (p) {
    if (i.brands.some((b) => p.followedIds?.has(b.id))) {
      add("Following", 10);
      reasons.push("From a brand you follow");
    }
    if ([i.id, i.eventId, i.location.id].some((id) => id && p.savedIds?.has(id))) {
      add("Saved", 8);
      reasons.push("Saved by you");
    } else if ([i.eventId, i.location.id].some((id) => id && p.followedIds?.has(id))) {
      add("Following", 6);
      reasons.push("Following");
    }
  }
  if (ctx.matchLabels?.length) reasons.push(`Matches ${ctx.matchLabels.slice(0, 2).join(" + ")}`);
  if (i.image) add("Has Image", 3);
  if (i.featured) add("Featured", 4);
  return { item: i, score: explain.reduce((s, [, n]) => s + n, 0), reasons, explain, distanceKm: distance };
}

export function compareRankedMap(a: RankedMapItem, b: RankedMapItem): number {
  if (b.score !== a.score) return b.score - a.score;
  const sa = a.item.start_at ?? a.item.occurrence_date ?? "9999";
  const sb = b.item.start_at ?? b.item.occurrence_date ?? "9999";
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.item.key.localeCompare(b.item.key);
}

/** Happening order: live first (ending soonest), then upcoming by start
 * time (a date-only item at the start of its day); score only breaks ties.
 * Happening Now, Starting Soon, Today and This Weekend all read correctly
 * from this one rule. */
export function compareChronological(now: Date): (a: RankedMapItem, b: RankedMapItem) => number {
  const startMs = (i: MapItem) => {
    if (i.start_at) return Date.parse(i.start_at);
    const d = i.occurrence_date ?? i.start_date;
    return d ? Date.parse(`${d}T00:00:00Z`) : Number.POSITIVE_INFINITY;
  };
  const endMs = (i: MapItem) => (i.end_at ? Date.parse(i.end_at) : Number.POSITIVE_INFINITY);
  return (a, b) => {
    const la = a.item.kind !== "place" && isHappeningNow(a.item, now);
    const lb = b.item.kind !== "place" && isHappeningNow(b.item, now);
    if (la !== lb) return la ? -1 : 1;
    if (la && endMs(a.item) !== endMs(b.item)) return endMs(a.item) - endMs(b.item);
    const sa = startMs(a.item);
    const sb = startMs(b.item);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return compareRankedMap(a, b);
  };
}

// ------------------------------------------------------------ diversity

export interface BrandOverflow {
  brand: MapBrand;
  total: number;
}

/** Presentation-level fairness. (1) Several qualifying dates of ONE Event
 * at ONE Location fold into one card ("+3 more dates") — the best-ranked
 * date leads (a live one, else the soonest). (2) In mixed discovery a
 * single Brand can't take more than `cap` of the leading positions; its
 * extra results move later (never removed) and are offered as "View All".
 * An explicit Brand query is never capped. */
export function diversify(ranked: RankedMapItem[], q: DiscoveryQuery, cap = 2): { items: RankedMapItem[]; overflow: BrandOverflow[] } {
  const folded: RankedMapItem[] = [];
  const byEventPlace = new Map<string, RankedMapItem>();
  for (const r of ranked) {
    if (r.item.kind === "event" && r.item.eventId) {
      const k = `${r.item.eventId}@${r.item.location.id}`;
      const lead = byEventPlace.get(k);
      if (lead) {
        lead.item = { ...lead.item, moreDates: (lead.item.moreDates ?? 0) + 1 };
        continue;
      }
      const copy = { ...r };
      byEventPlace.set(k, copy);
      folded.push(copy);
      continue;
    }
    folded.push(r);
  }
  const brandTotals = new Map<string, { brand: MapBrand; total: number }>();
  for (const r of folded) {
    const b = r.item.kind === "place" ? null : r.item.brands[0];
    if (!b) continue;
    const t = brandTotals.get(b.id) ?? { brand: b, total: 0 };
    t.total++;
    brandTotals.set(b.id, t);
  }
  if (q.brands?.length) return { items: folded, overflow: [] };
  const lead: RankedMapItem[] = [];
  const later: RankedMapItem[] = [];
  const seen = new Map<string, number>();
  for (const r of folded) {
    const b = r.item.kind === "place" ? null : r.item.brands[0];
    if (!b) {
      lead.push(r);
      continue;
    }
    const n = (seen.get(b.id) ?? 0) + 1;
    seen.set(b.id, n);
    (n <= cap ? lead : later).push(r);
  }
  const overflow = [...brandTotals.values()].filter((t) => t.total > cap).sort((a, b) => b.total - a.total || a.brand.name.localeCompare(b.brand.name));
  return { items: [...lead, ...later], overflow };
}

/** The result order for a lens. Happening: chronological, with every
 * date of one Event at one Location folded under its earliest (or live)
 * date and no per-Brand cap (it would pull a Brand's later dates out of
 * time order). Everything else: score + Brand diversity, unchanged. */
export function orderMapResults(ranked: RankedMapItem[], q: DiscoveryQuery, now: Date, happening: boolean): { items: RankedMapItem[]; overflow: BrandOverflow[] } {
  if (happening) return diversify([...ranked].sort(compareChronological(now)), q, Number.POSITIVE_INFINITY);
  return diversify([...ranked].sort(compareRankedMap), q);
}

// ------------------------------------------------------------ markers

/** One map feature — minimal payload; rich detail is hydrated lazily for
 * the selected marker only. */
export interface MapFeature {
  id: string;
  lng: number;
  lat: number;
  /** Qualifying results this marker stands for (summed by clusters). */
  count: number;
  /** Identity: the Brand / Event / Place the marker names. */
  label: string;
  /** Where it is (the Location name). */
  place: string;
  status: string;
  live: boolean;
  tone: MapTone;
  logo: string | null;
  locationId: string;
  /** Result keys this marker selects (bounded). */
  keys: string[];
  /** Archive maps only: a rich identity + status label before any click
   * (a few top results), ordered by `rank` (lower first). */
  promoted?: boolean;
  rank?: number;
  /** Optional, additive (Moments map): text drawn inside the marker dot
   * instead of the label's initial (e.g. its Moment count), and a label
   * shown as-is (no "+N" suffix). Unset everywhere else → unchanged. */
  pinText?: string;
  plainLabel?: boolean;
}

export function isEventsLens(q: DiscoveryQuery): boolean {
  return q.entities?.length === 1 && q.entities[0] === "event";
}

export function mapFeatures(items: RankedMapItem[], q: DiscoveryQuery, now: Date, maxKeys = 30): MapFeature[] {
  const statusOf = (i: MapItem) => mapStatus(i, now);
  const identity = (i: MapItem) => (i.kind === "place" ? i.title : (i.brands[0]?.name ?? i.title));
  if (isEventsLens(q)) {
    return items.map(({ item: i }) => {
      const s = statusOf(i);
      return { id: i.key, lng: i.location.lng, lat: i.location.lat, count: 1, label: i.title, place: i.location.name, status: s.text, live: s.live, tone: s.tone, logo: i.brands[0]?.logo ?? i.location.logo, locationId: i.location.id, keys: [i.key] };
    });
  }
  const byLoc = new Map<string, RankedMapItem[]>();
  for (const r of items) {
    const list = byLoc.get(r.item.location.id) ?? [];
    list.push(r);
    byLoc.set(r.item.location.id, list);
  }
  const out: MapFeature[] = [];
  for (const [locId, list] of byLoc) {
    // A Place result and dated results at the same Location: the dated
    // activity leads the marker; the Place is still in the preview.
    const dated = list.filter((r) => r.item.kind !== "place");
    const top = (dated[0] ?? list[0]).item;
    const s = statusOf(top);
    const live = dated.some((r) => isHappeningNow(r.item, now));
    const count = list.length;
    const loc = top.location;
    out.push({
      id: `loc:${locId}`,
      lng: loc.lng,
      lat: loc.lat,
      count,
      label: top.kind === "place" ? loc.name : identity(top),
      place: loc.name,
      status: live && !s.live ? "LIVE" : s.text,
      live,
      tone: live ? "live" : s.tone,
      logo: top.kind === "place" ? (loc.logo ?? null) : (top.brands[0]?.logo ?? loc.logo),
      locationId: locId,
      keys: list.slice(0, maxKeys).map((r) => r.item.key),
    });
  }
  return out;
}

// ------------------------------------------------------------ empty state

export interface RelaxationCandidate {
  label: string;
  query: DiscoveryQuery;
}

/** Explicit, one-dimension-at-a-time relaxations for an empty result —
 * offered to the user, never applied silently. The server keeps only the
 * ones that would actually return something. */
export function relaxationCandidates(q: DiscoveryQuery, names: { taxonomy?: Record<string, string>; brands?: Record<string, string> } = {}): RelaxationCandidate[] {
  const out: RelaxationCandidate[] = [];
  const without = (...keys: (keyof DiscoveryQuery)[]) => {
    const next: DiscoveryQuery = { ...q };
    for (const k of keys) delete next[k];
    delete next.offset;
    return next;
  };
  if (q.bbox) out.push({ label: "Wider Area", query: { ...without(), bbox: expandBbox(q.bbox as Bbox, 3) } });
  if (q.area || q.place) out.push({ label: "Nearby Neighborhoods", query: without("area", "place") });
  if (q.when === "now" || q.when === "today" || q.when === "tonight" || q.when === "upnext") out.push({ label: "Tomorrow", query: { ...without("when"), when: "tomorrow" } });
  if (q.when || q.date || q.from || q.to || q.month || q.year) out.push({ label: "Any Date", query: without("when", "date", "from", "to", "month", "year") });
  if (q.tod || q.tfrom || q.tto) out.push({ label: "Any Time Of Day", query: without("tod", "tfrom", "tto") });
  if (q.free) out.push({ label: "Remove Free", query: without("free") });
  if (q.paid) out.push({ label: "Remove Paid", query: without("paid") });
  for (const b of q.benefits ?? []) out.push({ label: `Remove ${BENEFIT_LABELS[b]}`, query: { ...without(), benefits: q.benefits!.filter((x) => x !== b) } });
  for (const s of [...(q.categories ?? []), ...(q.formats ?? [])]) {
    const label = names.taxonomy?.[s];
    if (label) out.push({ label: `Remove ${label}`, query: { ...without(), categories: q.categories?.filter((x) => x !== s), formats: q.formats?.filter((x) => x !== s) } });
  }
  if (q.brands?.length) out.push({ label: q.brands.length === 1 && names.brands?.[q.brands[0]] ? `Remove ${names.brands[q.brands[0]]}` : "All Brands", query: without("brands", "brandMode") });
  if (q.family) out.push({ label: "Remove Family", query: without("family") });
  if (q.audience?.length) out.push({ label: "Any Audience", query: without("audience") });
  if (q.entry?.length) out.push({ label: "Any Entry", query: without("entry") });
  if (q.text) out.push({ label: `Remove “${q.text}”`, query: without("text") });
  if (q.open) out.push({ label: "Remove Open Now", query: without("open") });
  return out;
}
