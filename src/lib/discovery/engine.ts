// Discovery Intelligence V1 — the deterministic executor. Every discovery
// surface (Topic pages, homepage Lanes, Area pages, contextual search)
// fetches a bounded candidate set once (lib/discovery/server.ts) and runs
// the structured query here, in memory: filter → rank (transparent, every
// point explained) → refinements (only executable, non-empty ones). Pure —
// `now` is injectable, nothing here reads the clock or the database.

import { APP_TIMEZONE, dateKeyInZone } from "../format";
import { hasEnded, isHappeningNow, occursWithinDates, todayIn } from "../event-time";
import { namedWindowDates, UP_NEXT_HOURS } from "./time";
import { WHEN_LABELS, entitiesFor, searchHref, type DiscoveryEntity, type DiscoveryQuery, type DiscoveryWhen } from "./query";

export interface DiscoveryItem {
  kind: DiscoveryEntity;
  id: string;
  title: string;
  href: string;
  image: string | null;
  /** Brand identity mark (businesses only — a real logo_url, distinct
   * from `image`, which prefers the cover). Null for every other kind;
   * never fabricated. DiscoveryTile uses it only as a small identity
   * badge over the cover, never in place of it. */
  logo?: string | null;
  subtitle: string | null;
  /** Dated items (events, appearances, moments) — the real stored times;
   * never invented. Undated items (business, place) leave these null. */
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
  /** Event Category slugs INCLUDING each one's parent (a subcategory
   * match satisfies its top-level Category). */
  categories: string[];
  formats: string[];
  is_free: boolean | null;
  family_friendly: boolean | null;
  rsvp: boolean;
  tickets: boolean;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  /** Findmi Area slug (the item's effective Area), when known. */
  area: string | null;
  is_featured: boolean;
  has_description: boolean;
  /** Lower-cased names this item can be found by (title, Brand, venue). */
  haystack: string;
  /** Related ids for bounded personal ranking (Brand, Place, Event). */
  related: string[];
  /** The canonical Location this item happens at / is (Pop-Ups and
   * Places), when known — used to map it. Optional; never invented. */
  location_id?: string | null;
}

/** A resolved Census geography as a predicate: an item matches when its
 * own stored city/state/ZIP agrees. Never coordinates. */
export interface GeoScope {
  label: string;
  usps?: string;
  /** "normalized city|ST" keys (place, or places within a county). */
  cityKeys?: string[];
  zips?: string[];
}

/** Read-time affinities derived from the viewer's own explicit actions
 * (follows, saves, relationships, Topic/Area opens). Bounded; optional. */
export interface PersonalContext {
  relatedIds?: Set<string>;
  /** The same ids split by what the viewer did, for honest explanations
   * ("From a brand you follow" / "Saved by you"). */
  followedIds?: Set<string>;
  savedIds?: Set<string>;
  topicSlugs?: Set<string>;
  areaSlugs?: Set<string>;
  dislikedIds?: Set<string>;
}

export interface ExecuteContext {
  now?: Date;
  geo?: GeoScope | null;
  personal?: PersonalContext | null;
  /** Category/Format slug → display name, for refinement labels. */
  taxonomyNames?: Record<string, string>;
  /** Top-level Event Category slugs (refinements offer these only). */
  topCategories?: string[];
  areaNames?: Record<string, string>;
}

export interface RankedItem {
  item: DiscoveryItem;
  score: number;
  explain: [string, number][];
}

export interface Refinement {
  dimension: "when" | "format" | "category" | "free" | "family" | "area" | "type";
  label: string;
  count: number;
  href: string;
  query: DiscoveryQuery;
}

export interface DiscoveryResult {
  query: DiscoveryQuery;
  items: RankedItem[];
  total: number;
  refinements: Refinement[];
}

// ------------------------------------------------------------ time windows

/** Calendar range [from, to] for a date-shaped window — the shared
 * definitions in ./time (Findmi's locked rules: This Week runs through
 * Sunday; This Weekend is Fri–Sun and never reaches back into a Friday
 * already past). */
export function windowDates(when: DiscoveryWhen, now: Date = new Date()): { from: string; to: string } | null {
  return namedWindowDates(when, now);
}

/** Local wall-clock instant in APP_TIMEZONE for today at hh:mm. */
function localInstant(now: Date, hh: number, mm: number): number {
  const today = todayIn(undefined, now);
  const [y, m, d] = today.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Resolve the zone offset at that wall time (DST-safe to the minute).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return guess - (asUtc - guess);
}

const dated = (i: DiscoveryItem) => Boolean(i.start_at || i.start_date);

export function matchesWhen(i: DiscoveryItem, when: DiscoveryWhen, now: Date = new Date()): boolean {
  if (!dated(i)) return false;
  if (hasEnded(i, now)) return false;
  if (when === "upcoming") return true;
  // Here Now is reserved for genuinely live: real start AND end around now.
  if (when === "now") return isHappeningNow(i, now);
  if (when === "upnext") return Boolean(i.start_at) && Date.parse(i.start_at!) > now.getTime() && Date.parse(i.start_at!) <= now.getTime() + UP_NEXT_HOURS * 3_600_000;
  if (when === "tonight") {
    // Timed items only — a date with no published time is never "tonight".
    if (!i.start_at) return false;
    const from = Math.max(now.getTime(), localInstant(now, 17, 0));
    const to = localInstant(now, 23, 59) + 60_000;
    const start = Date.parse(i.start_at);
    const end = i.end_at ? Date.parse(i.end_at) : start;
    return start < to && end >= from;
  }
  const range = windowDates(when, now);
  return range ? occursWithinDates(i, range.from, range.to) : true;
}

// ------------------------------------------------------------ filtering

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const cityKey = (city: string | null | undefined, usps: string | null | undefined) => `${norm(city)}|${(usps ?? "").toUpperCase()}`;

export function matchesGeo(i: DiscoveryItem, g: GeoScope): boolean {
  const zip = (i.postal_code ?? "").trim().slice(0, 5);
  if (g.zips?.length && zip && g.zips.includes(zip)) return true;
  if (g.cityKeys?.length && i.city && i.state && g.cityKeys.includes(cityKey(i.city, i.state))) return true;
  if (!g.zips?.length && !g.cityKeys?.length && g.usps) return (i.state ?? "").trim().toUpperCase() === g.usps;
  return false;
}

export function matchesQuery(i: DiscoveryItem, q: DiscoveryQuery, ctx: ExecuteContext = {}): boolean {
  const now = ctx.now ?? new Date();
  const entities = entitiesFor(q);
  if (!entities.includes(i.kind)) return false;
  const isDated = dated(i);
  if (isDated && hasEnded(i, now)) return false;

  if (q.when && !matchesWhen(i, q.when, now)) return false;
  if (q.date && !(isDated && occursWithinDates(i, q.date, q.date))) return false;
  if (q.endingSoonHours) {
    if (!i.end_at) return false;
    const end = Date.parse(i.end_at);
    if (end < now.getTime() || end > now.getTime() + q.endingSoonHours * 3_600_000) return false;
  }
  if (q.justAnnouncedDays) {
    if (!i.created_at || Date.parse(i.created_at) < now.getTime() - q.justAnnouncedDays * 86_400_000) return false;
  }
  // Taxonomy: Categories ∪ Formats — ANY listed slug matches.
  const tax = [...(q.categories ?? []), ...(q.formats ?? [])];
  if (tax.length && !tax.some((s) => i.categories.includes(s) || i.formats.includes(s))) return false;
  if (q.access?.length && !q.access.some((a) => (a === "rsvp" ? i.rsvp : i.tickets))) return false;
  if (q.free && i.is_free !== true) return false;
  if (q.family && !(i.family_friendly === true || i.categories.includes("family-kids"))) return false;
  if (q.text) {
    const words = norm(q.text).split(" ").filter(Boolean);
    if (words.length && !words.every((w) => i.haystack.includes(w))) return false;
  }
  if (ctx.geo && !matchesGeo(i, ctx.geo)) return false;
  return true;
}

// ------------------------------------------------------------ ranking

/** Transparent additive score — each component is named in `explain`, so
 * Admin can see exactly why an item ranks where it does. Personal signal
 * is bounded (≤ 12) so it can reorder but never bury the rest. */
export function rankItem(i: DiscoveryItem, q: DiscoveryQuery, ctx: ExecuteContext = {}): RankedItem {
  const now = ctx.now ?? new Date();
  const explain: [string, number][] = [];
  const add = (label: string, n: number) => {
    if (n) explain.push([label, n]);
  };

  if (dated(i)) {
    if (isHappeningNow(i, now)) add("Happening Now", 40);
    else {
      const today = todayIn(undefined, now);
      const start = i.start_date ?? (i.start_at ? dateKeyInZone(new Date(i.start_at), APP_TIMEZONE) : today);
      const days = Math.max(0, Math.round((Date.parse(start) - Date.parse(today)) / 86_400_000));
      add(days === 0 ? "Today" : "Soon", Math.max(0, 25 - days * 2));
    }
    if (i.end_at) {
      const hoursLeft = (Date.parse(i.end_at) - now.getTime()) / 3_600_000;
      if (hoursLeft > 0 && hoursLeft <= 48 && Date.parse(i.start_at ?? i.end_at) <= now.getTime() + 86_400_000) add("Ending Soon", 6);
    }
  }
  if (q.text) {
    const t = norm(q.text);
    if (norm(i.title) === t) add("Exact Name", 30);
    else if (norm(i.title).includes(t)) add("Name Match", 15);
  }
  if (q.area && i.area === q.area) add("In Area", 8);
  const tax = [...(q.categories ?? []), ...(q.formats ?? [])];
  const taxHits = tax.filter((s) => i.categories.includes(s) || i.formats.includes(s)).length;
  if (taxHits > 1) add("Strong Match", Math.min(10, (taxHits - 1) * 4));
  if (i.image) add("Has Image", 5);
  if (i.has_description) add("Has Details", 2);
  if (i.is_featured) add("Featured", 8);

  const p = ctx.personal;
  if (p) {
    let personal = 0;
    if (i.related.some((id) => p.relatedIds?.has(id))) personal += 8;
    if (i.area && p.areaSlugs?.has(i.area)) personal += 2;
    if ([...i.categories, ...i.formats].some((s) => p.topicSlugs?.has(s))) personal += 2;
    add("For You", Math.min(12, personal));
    if (p.dislikedIds?.has(i.id)) add("Not For You", -50);
  }
  return { item: i, score: explain.reduce((s, [, n]) => s + n, 0), explain };
}

function compareRanked(a: RankedItem, b: RankedItem): number {
  if (b.score !== a.score) return b.score - a.score;
  const da = a.item.start_at ?? a.item.start_date ?? "9999";
  const db = b.item.start_at ?? b.item.start_date ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  return a.item.id.localeCompare(b.item.id);
}

// ------------------------------------------------------------ refinements

const REFINE_WHEN: DiscoveryWhen[] = ["now", "today", "tonight", "tomorrow", "weekend", "week"];

/** Only executable refinements that change the result: each one is a real
 * query (and link) with a non-zero count smaller than the current total. */
export function refinementsFor(matched: DiscoveryItem[], q: DiscoveryQuery, ctx: ExecuteContext = {}): Refinement[] {
  const now = ctx.now ?? new Date();
  const total = matched.length;
  const out: Refinement[] = [];
  const push = (dimension: Refinement["dimension"], label: string, next: DiscoveryQuery, count: number) => {
    if (count > 0 && count < total) out.push({ dimension, label, count, query: next, href: searchHref(next) });
  };
  if (!q.when && !q.date) for (const w of REFINE_WHEN) push("when", WHEN_LABELS[w], { ...q, when: w }, matched.filter((i) => matchesWhen(i, w, now)).length);

  const tally = (pick: (i: DiscoveryItem) => string[]) => {
    const m = new Map<string, number>();
    for (const i of matched) for (const s of new Set(pick(i))) m.set(s, (m.get(s) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const names = ctx.taxonomyNames ?? {};
  if (!q.formats?.length) for (const [s, n] of tally((i) => i.formats).slice(0, 6)) if (names[s]) push("format", names[s], { ...q, formats: [s] }, n);
  if (!q.categories?.length) {
    const top = new Set(ctx.topCategories ?? []);
    for (const [s, n] of tally((i) => i.categories.filter((c) => top.has(c))).slice(0, 6)) if (names[s]) push("category", names[s], { ...q, categories: [s] }, n);
  }
  if (!q.free) push("free", "Free", { ...q, free: true }, matched.filter((i) => i.is_free === true).length);
  if (!q.family) push("family", "Family Friendly", { ...q, family: true }, matched.filter((i) => i.family_friendly === true || i.categories.includes("family-kids")).length);
  if (!q.area && ctx.areaNames) for (const [s, n] of tally((i) => (i.area ? [i.area] : [])).slice(0, 6)) if (ctx.areaNames[s]) push("area", ctx.areaNames[s], { ...q, area: s }, n);
  return out;
}

// ------------------------------------------------------------ execute

export function executeDiscovery(candidates: DiscoveryItem[], q: DiscoveryQuery, ctx: ExecuteContext = {}): DiscoveryResult {
  const seen = new Set<string>();
  const matched = candidates.filter((i) => {
    const key = `${i.kind}:${i.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return matchesQuery(i, q, ctx);
  });
  const ranked = matched.map((i) => rankItem(i, q, ctx)).sort(compareRanked);
  return { query: q, items: ranked.slice(0, q.limit ?? 24), total: matched.length, refinements: refinementsFor(matched, q, ctx) };
}
