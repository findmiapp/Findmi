import "server-only";
// Pages + Sections V1B — resolves an Entity Results Section against real
// data, through the SAME public read helpers and Discovery engine every
// other discovery surface uses (same RLS, publication, demo and eligibility
// rules). Never a parallel query system:
//   Events & Appearances → getCandidates + executeDiscovery (Topic pages,
//                          Lanes, search), plus date-range / Featured /
//                          Brand / Place predicates applied before ranking
//   Brands               → searchBusinesses (Brands archive)
//   Places               → getLocations (Places archive)
//   Products             → getHomepageRowProducts (homepage Products rows)
// Pins / includes load by id (getEventsByIds, getBusinessesByIds,
// getLocations({ ids }), getProductsByIds; a Pop-Up from the bounded
// candidate set) and combine with the query via composeEntityResults.
import { getSupabase } from "./supabase";
import {
  getBusinessesByIds,
  getEventsByIds,
  getEventsDiscovery,
  getHomepageRowProducts,
  getLocations,
  getProductsByIds,
  searchBusinesses,
  type FeaturedProduct,
} from "./data";
import { businessToItem, eventToItem, getCandidates, getVocabulary, placeToItem, taxonomyFor } from "./discovery/server";
import { executeDiscovery, type DiscoveryItem } from "./discovery/engine";
import type { DiscoveryQuery } from "./discovery/query";
import { occursWithinDates } from "./event-time";
import { composeEntityResults, manualRefs, refKey, type EntityRef, type EntityResultsConfig, type ResultFilters, type ResultOrigin } from "./page-sections";

/** The most results one Section's query ever reads (and Preview shows). */
export const RESULTS_CAP = 48;

export type EntityResultItem = { type: "item"; item: DiscoveryItem } | { type: "product"; product: FeaturedProduct };
export interface ResolvedEntity {
  key: string;
  origin: ResultOrigin;
  entity: EntityResultItem;
}
export interface EntityResults {
  items: ResolvedEntity[];
  /** How many entities the query matched (before exclusions / limit), or
   * null in Manual mode. */
  matched: number | null;
  /** The query hit RESULTS_CAP — "48+" rather than an exact count. */
  capped: boolean;
  /** Query matches removed by an exclusion. */
  excludedMatches: number;
  /** Pins / includes that no longer resolve (deleted, unpublished, ended
   * Pop-Ups outside the window). */
  missing: string[];
}

export interface SectionScope {
  marketSlug?: string;
  areaSlug?: string;
}

const itemOf = (item: DiscoveryItem): EntityResultItem => ({ type: "item", item });
const keyOf = (e: EntityResultItem) => (e.type === "product" ? `product:${e.product.id}` : refKey({ kind: e.item.kind, id: e.item.id }));

export async function resolveEntityResults(c: EntityResultsConfig, scope: SectionScope = {}, opts: { now?: Date; limit?: number } = {}): Promise<EntityResults> {
  const refs = manualRefs(c);
  const [dynamic, resolved] = await Promise.all([
    c.mode === "manual" ? Promise.resolve(null) : runDynamic(c, scope, opts.now),
    resolveRefs(refs, scope),
  ]);
  const excluded = new Set(c.excludes.map(refKey));
  const items = composeEntityResults({
    mode: c.mode,
    pins: c.pins,
    includes: c.includes,
    excludes: c.excludes,
    resolved,
    dynamic: (dynamic?.items ?? []).map((item) => ({ key: keyOf(item), item })),
    limit: opts.limit ?? c.limit,
  }).map(({ key, item, origin }) => ({ key, entity: item, origin }));
  return {
    items,
    matched: dynamic ? dynamic.total : null,
    capped: dynamic?.capped ?? false,
    excludedMatches: (dynamic?.items ?? []).filter((i) => excluded.has(keyOf(i))).length,
    missing: refs.map(refKey).filter((k) => !resolved.has(k)),
  };
}

// ------------------------------------------------------------ dynamic

async function runDynamic(c: EntityResultsConfig, scope: SectionScope, now = new Date()): Promise<{ items: EntityResultItem[]; total: number; capped: boolean }> {
  const f = c.filters;
  if (c.scope === "events") return runEvents(f, scope, now);
  const vocab = await getVocabulary();
  const areaSlugById = new Map(vocab.areaRows.map((a) => [a.id, a.slug]));
  const cats = f.categories?.length ? f.categories : [undefined];
  if (c.scope === "brands") {
    const lists = await Promise.all(cats.map((categorySlug) => searchBusinesses({ q: f.text, categorySlug, marketSlug: scope.marketSlug, areaSlug: scope.areaSlug, featuredOnly: f.featured, limit: RESULTS_CAP })));
    const items = uniqueById(lists.flat()).map((b) => itemOf(businessToItem(b, areaSlugById)));
    return { items: items.slice(0, RESULTS_CAP), total: items.length, capped: lists.some((l) => l.length >= RESULTS_CAP) };
  }
  if (c.scope === "places") {
    const lists = await Promise.all(cats.map((categorySlug) => getLocations({ q: f.text, categorySlug, marketSlug: scope.marketSlug, areaSlug: scope.areaSlug, limit: RESULTS_CAP })));
    const items = uniqueById(lists.flat()).map((l) => itemOf(placeToItem(l, areaSlugById)));
    return { items: items.slice(0, RESULTS_CAP), total: items.length, capped: lists.some((l) => l.length >= RESULTS_CAP) };
  }
  const products = await getHomepageRowProducts({ q: f.text, featuredOnly: f.featured, limit: RESULTS_CAP });
  const brands = f.brands?.length ? new Set(f.brands) : null;
  const items = products.filter((p) => !brands || brands.has(p.business.id)).map((product): EntityResultItem => ({ type: "product", product }));
  return { items, total: items.length, capped: products.length >= RESULTS_CAP };
}

const uniqueById = <T extends { id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
};

/** The Discovery query an Events & Appearances Section runs (Market / Area
 * are applied at the candidate source, like every Discovery surface). */
export function eventsQuery(f: ResultFilters): DiscoveryQuery {
  const access = [...(f.rsvp ? (["rsvp"] as const) : []), ...(f.tickets ? (["tickets"] as const) : [])];
  return {
    entities: ["event", "appearance"],
    ...(f.when && !f.date && !f.from && !f.to ? { when: f.when } : {}),
    ...(f.date ? { date: f.date } : {}),
    ...(f.categories?.length ? { categories: f.categories } : {}),
    ...(f.formats?.length ? { formats: f.formats } : {}),
    ...(access.length ? { access } : {}),
    ...(f.free ? { free: true as const } : {}),
    ...(f.family ? { family: true as const } : {}),
    ...(f.text ? { text: f.text } : {}),
    ...(f.endingSoon ? { endingSoonHours: 48 } : {}),
    ...(f.justAnnounced ? { justAnnouncedDays: 14 } : {}),
    limit: RESULTS_CAP,
  };
}

/** Predicates the shared engine doesn't express, applied to candidates
 * BEFORE ranking (so the limit counts only real matches). Pure. */
export function extraEventPredicate(f: ResultFilters, rel: { brandEventIds: ReadonlySet<string>; placeEventIds: ReadonlySet<string> }): (i: DiscoveryItem) => boolean {
  const brands = f.brands?.length ? new Set(f.brands) : null;
  const places = f.places?.length ? new Set(f.places) : null;
  return (i) => {
    if (!f.date && (f.from || f.to) && !occursWithinDates(i, f.from ?? "0000-01-01", f.to ?? "9999-12-31")) return false;
    if (f.featured && !i.is_featured) return false;
    if (brands && !(i.related.some((id) => brands.has(id)) || (i.kind === "event" && rel.brandEventIds.has(i.id)))) return false;
    if (places && !(i.kind === "appearance" ? Boolean(i.location_id && places.has(i.location_id)) : rel.placeEventIds.has(i.id))) return false;
    return true;
  };
}

async function runEvents(f: ResultFilters, scope: SectionScope, now: Date): Promise<{ items: EntityResultItem[]; total: number; capped: boolean }> {
  const supabase = getSupabase();
  const [candidates, brandEventIds, placeEventIds] = await Promise.all([
    getCandidates(scope.marketSlug, scope.marketSlug ? scope.areaSlug : undefined, "appearance,event"),
    // Events a Brand takes part in (approved participants), beyond hosting.
    f.brands?.length && supabase
      ? supabase.from("event_businesses").select("event_id").in("business_id", f.brands).eq("status", "approved").limit(500).then((r) => new Set(((r.data ?? []) as { event_id: string }[]).map((x) => x.event_id)))
      : Promise.resolve(new Set<string>()),
    // Events with a date at a picked Place (same occurrence rule as the
    // Place page).
    f.places?.length
      ? Promise.all(f.places.map((locationId) => getEventsDiscovery({ when: "anytime", locationId, limit: 200 }))).then((lists) => new Set(lists.flat().map((e) => e.id)))
      : Promise.resolve(new Set<string>()),
  ]);
  const keep = extraEventPredicate(f, { brandEventIds, placeEventIds });
  const result = executeDiscovery(candidates.filter(keep), eventsQuery(f), { now });
  // total is the exact match count within the bounded candidate set.
  return { items: result.items.map((r) => itemOf(r.item)), total: result.total, capped: false };
}

// ------------------------------------------------------------ by id

/** Loads referenced entities through the public helpers; a reference that
 * isn't public any more simply isn't in the map. */
export async function resolveRefs(refs: readonly EntityRef[], scope: SectionScope = {}): Promise<Map<string, EntityResultItem>> {
  const out = new Map<string, EntityResultItem>();
  if (!refs.length) return out;
  const ids = (kind: EntityRef["kind"]) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
  const [eventIds, appearanceIds, businessIds, placeIds, productIds] = (["event", "appearance", "business", "place", "product"] as const).map(ids);
  const vocab = await getVocabulary();
  const areaSlugById = new Map(vocab.areaRows.map((a) => [a.id, a.slug]));
  const [events, tax, scoped, wide, businesses, places, products] = await Promise.all([
    getEventsByIds(eventIds),
    taxonomyFor(eventIds, vocab),
    appearanceIds.length ? getCandidates(scope.marketSlug, scope.marketSlug ? scope.areaSlug : undefined, "appearance") : Promise.resolve([]),
    appearanceIds.length ? getCandidates(undefined, undefined, "appearance") : Promise.resolve([]),
    getBusinessesByIds(businessIds),
    placeIds.length ? getLocations({ ids: placeIds, limit: placeIds.length }) : Promise.resolve([]),
    getProductsByIds(productIds),
  ]);
  for (const e of events) out.set(`event:${e.id}`, itemOf(eventToItem(e, tax.get(e.id), areaSlugById)));
  const wanted = new Set(appearanceIds);
  for (const a of [...scoped, ...wide]) if (a.kind === "appearance" && wanted.has(a.id)) out.set(`appearance:${a.id}`, itemOf(a));
  for (const b of businesses) out.set(`business:${b.id}`, itemOf(businessToItem(b, areaSlugById)));
  for (const l of places) out.set(`place:${l.id}`, itemOf(placeToItem(l, areaSlugById)));
  for (const p of products) out.set(`product:${p.id}`, { type: "product", product: p });
  return out;
}
