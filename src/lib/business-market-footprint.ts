import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAvailabilityRelationships, type AvailabilityRelationship, type AvailabilityStatus } from "./business-availability-domain";
import type { OwnerAvailabilityItem } from "./business-availability-owner";

/** Findmi Here → Find Us Here → By Market.
 *
 * A Business's real-world footprint, grouped by Findmi Market. Every number here is
 * a count of rows that exist: Our Locations (business_locations), Find Us Here
 * entries (business_location_availability), the Location's own curated market
 * (`locations.market_id`) and the Business's own upcoming Appearances. There is no
 * penetration percentage, score or estimate — and a Location with no Market is
 * reported as "No Market Yet" rather than guessed from its city text. The Markets
 * themselves are whatever `markets` holds (nothing is hard-coded). Service-role
 * client only; the caller authorizes the Business first. */

export const NO_MARKET = "none";
const PAGE = 1000;
const MAX_PAGES = 20;
const DETAIL_PAGE_SIZE = 25;

const isMissingColumn = (e: { code?: string } | null | undefined) => Boolean(e && e.code === "42703");

type PagedRead = PromiseLike<{ data: unknown[] | null; count: number | null; error: { code?: string } | null }>;

/** Every row a query matches, read in parallel pages of 1,000 (one API read is capped
 * at 1,000 rows however high a `.limit()` is set). `build` must request `count: "exact"`. */
async function readAllRows<T>(build: (from: number, to: number) => PagedRead): Promise<T[]> {
  const first = await build(0, PAGE - 1);
  if (first.error) return [];
  const total = first.count ?? (first.data ?? []).length;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => build((i + 1) * PAGE, (i + 2) * PAGE - 1)));
  return [...((first.data ?? []) as T[]), ...rest.flatMap((r) => ((r.data ?? []) as T[]))];
}

export interface MarketRow {
  id: string;
  name: string;
  slug: string;
}

export interface FootprintCounts {
  ours: number;
  findUs: number;
  live: number;
  pending: number;
  declined: number;
  relationships: Partial<Record<AvailabilityRelationship, number>>;
}

export interface MarketFootprint extends FootprintCounts {
  market: MarketRow | null; // null = No Market Yet
  /** Declared in the Growth Profile: 'current' and/or 'priority' for this Market. */
  intents: ("current" | "priority")[];
  /** Areas the Business declared inside this Market (labels only). */
  areaLabels: string[];
  upcomingAppearances: number;
}

const emptyCounts = (): FootprintCounts => ({ ours: 0, findUs: 0, live: 0, pending: 0, declined: 0, relationships: {} });

interface EntryProbe {
  status: AvailabilityStatus;
  relationship: AvailabilityRelationship;
  relationships?: AvailabilityRelationship[] | null;
  locations: { market_id: string | null } | { market_id: string | null }[] | null;
}

/** Every entry's status, relationships and its Location's market — read in
 * parallel pages of 1,000 (a large brand exceeds the API's single-read cap). */
async function readProbes(admin: SupabaseClient, businessId: string): Promise<EntryProbe[] | null> {
  const read = (multi: boolean, from: number) =>
    admin
      .from("business_location_availability")
      .select(`status, relationship, ${multi ? "relationships, " : ""}locations!inner(market_id)`, { count: "exact" })
      .eq("business_id", businessId)
      .order("id")
      .range(from, from + PAGE - 1);
  let multi = true;
  let first = await read(true, 0);
  if (isMissingColumn(first.error)) {
    multi = false;
    first = await read(false, 0);
  }
  if (first.error) return null;
  const total = first.count ?? (first.data ?? []).length;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => read(multi, (i + 1) * PAGE)));
  return [...((first.data ?? []) as unknown as EntryProbe[]), ...rest.flatMap((r) => ((r.data ?? []) as unknown as EntryProbe[]))];
}

export async function getBusinessMarketOverview(
  admin: SupabaseClient,
  businessId: string
): Promise<{ available: boolean; markets: MarketFootprint[]; others: MarketRow[]; noMarket: MarketFootprint }> {
  const now = new Date().toISOString();
  const [marketsRes, probes, ours, audit, appearances] = await Promise.all([
    admin.from("markets").select("id, name, slug, sort_order").eq("active", true).order("sort_order"),
    readProbes(admin, businessId),
    readAllRows<{ locations: { market_id: string | null } | { market_id: string | null }[] | null }>((from, to) =>
      admin.from("business_locations").select("location_id, locations!inner(market_id)", { count: "exact" }).eq("business_id", businessId).order("location_id").range(from, to)
    ),
    admin.from("brand_audit_markets").select("intent, level, market_id, label").eq("business_id", businessId).eq("source", "declared"),
    readAllRows<{ market_id: string | null; locations: { market_id: string | null } | { market_id: string | null }[] | null }>((from, to) =>
      admin.from("appearances").select("market_id, locations(market_id)", { count: "exact" }).eq("business_id", businessId).gte("start_at", now).order("id").range(from, to)
    ),
  ]);
  const empty = { available: false, markets: [], others: [], noMarket: { market: null, intents: [], areaLabels: [], upcomingAppearances: 0, ...emptyCounts() } as MarketFootprint };
  if (marketsRes.error || probes === null) return empty;

  const markets = ((marketsRes.data ?? []) as (MarketRow & { sort_order: number })[]).map((m) => ({ id: m.id, name: m.name, slug: m.slug }));
  const byId = new Map<string, MarketFootprint>(markets.map((m) => [m.id, { market: m, intents: [], areaLabels: [], upcomingAppearances: 0, ...emptyCounts() }]));
  const none: MarketFootprint = { market: null, intents: [], areaLabels: [], upcomingAppearances: 0, ...emptyCounts() };
  const bucket = (marketId: string | null | undefined) => (marketId ? byId.get(marketId) ?? none : none);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

  for (const p of probes) {
    const b = bucket(one(p.locations)?.market_id);
    b.findUs += 1;
    b[p.status] += 1;
    for (const r of normalizeAvailabilityRelationships(p.relationships && p.relationships.length > 0 ? p.relationships : [p.relationship])) b.relationships[r] = (b.relationships[r] ?? 0) + 1;
  }
  for (const o of ours) bucket(one(o.locations)?.market_id).ours += 1;
  for (const a of ((audit.data ?? []) as { intent: "current" | "priority"; level: string; market_id: string | null; label: string }[])) {
    const b = a.market_id ? byId.get(a.market_id) : null;
    if (!b) continue;
    if (!b.intents.includes(a.intent)) b.intents.push(a.intent);
    if (a.level !== "market" && !b.areaLabels.includes(a.label)) b.areaLabels.push(a.label);
  }
  for (const a of appearances) {
    const id = a.market_id ?? one(a.locations)?.market_id ?? null;
    const b = id ? byId.get(id) : null;
    if (b) b.upcomingAppearances += 1;
  }

  const footprinted = [...byId.values()].filter((f) => f.ours + f.findUs > 0 || f.intents.length > 0 || f.upcomingAppearances > 0);
  // Priority markets first, then by footprint size, then name.
  footprinted.sort((a, b) => Number(b.intents.includes("priority")) - Number(a.intents.includes("priority")) || b.ours + b.findUs - (a.ours + a.findUs) || (a.market?.name ?? "").localeCompare(b.market?.name ?? ""));
  const shown = new Set(footprinted.map((f) => f.market?.id));
  return { available: true, markets: footprinted, others: markets.filter((m) => !shown.has(m.id)), noMarket: none };
}

export interface MarketDetail {
  available: boolean;
  market: MarketRow | null;
  isNoMarket: boolean;
  ours: { id: string; name: string; slug: string; city: string | null; state: string | null }[];
  entries: OwnerAvailabilityItem[];
  entriesTotal: number;
  page: number;
  pageSize: number;
  /** Products placed in this Market and how many of its places carry each. */
  productCoverage: { id: string; name: string; places: number }[];
  /** Entries in this Market that name no Product (the whole Brand). */
  brandWidePlaces: number;
  appearances: { id: string; title: string; startAt: string; venue: string | null }[];
}

export async function getBusinessMarketDetail(admin: SupabaseClient, businessId: string, marketKey: string, page: number): Promise<MarketDetail> {
  const isNone = marketKey === NO_MARKET;
  const empty: MarketDetail = { available: false, market: null, isNoMarket: isNone, ours: [], entries: [], entriesTotal: 0, page: 1, pageSize: DETAIL_PAGE_SIZE, productCoverage: [], brandWidePlaces: 0, appearances: [] };
  let market: MarketRow | null = null;
  if (!isNone) {
    const { data } = await admin.from("markets").select("id, name, slug").eq("slug", marketKey).eq("active", true).maybeSingle();
    market = (data as MarketRow | null) ?? null;
    if (!market) return empty;
  }
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * DETAIL_PAGE_SIZE;
  const inMarket = (q: any) => (isNone ? q.is("locations.market_id", null) : q.eq("locations.market_id", market!.id));

  const readEntries = (multi: boolean) =>
    inMarket(
      admin
        .from("business_location_availability")
        .select(`id, location_id, relationship, ${multi ? "relationships, " : ""}status, source, starts_on, ends_on, note, locations!inner(id, name, slug, city, state, logo_url, cover_image_url, market_id)`, { count: "exact" })
        .eq("business_id", businessId)
    )
      .order("id")
      .range(from, from + DETAIL_PAGE_SIZE - 1);
  let entriesRes = await readEntries(true);
  if (isMissingColumn(entriesRes.error)) entriesRes = await readEntries(false);
  if (entriesRes.error) return empty;

  const now = new Date().toISOString();
  const [oursRes, idsRes, apsByMarket, apsByLocation] = await Promise.all([
    inMarket(admin.from("business_locations").select("location_id, locations!inner(id, name, slug, city, state, market_id)").eq("business_id", businessId)).limit(500),
    // Every entry id in this Market (for product coverage), paged past the API's 1,000-row read cap.
    readAllRows<{ id: string }>((rangeFrom, rangeTo) =>
      inMarket(admin.from("business_location_availability").select("id, locations!inner(market_id)", { count: "exact" }).eq("business_id", businessId)).order("id").range(rangeFrom, rangeTo)
    ),
    isNone ? Promise.resolve({ data: [] as unknown[] }) : admin.from("appearances").select("id, title, start_at, venue_name, location_id").eq("business_id", businessId).eq("market_id", market!.id).gte("start_at", now).order("start_at").limit(10),
    isNone ? Promise.resolve({ data: [] as unknown[] }) : admin.from("appearances").select("id, title, start_at, venue_name, location_id, locations!inner(market_id)").eq("business_id", businessId).eq("locations.market_id", market!.id).gte("start_at", now).order("start_at").limit(10),
  ]);

  type Loc = { id: string; name: string; slug: string; city: string | null; state: string | null; logo_url?: string | null; cover_image_url?: string | null };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  const rows = (entriesRes.data ?? []) as unknown as { id: string; location_id: string; relationship: AvailabilityRelationship; relationships?: AvailabilityRelationship[] | null; status: AvailabilityStatus; source: "admin" | "business"; starts_on: string | null; ends_on: string | null; note: string | null; locations: Loc | Loc[] | null }[];

  // Products for this page's entries, plus coverage across all the Market's entries.
  const pageIds = rows.map((r) => r.id);
  const allIds = idsRes.map((r) => r.id);
  const productsOnPage = new Map<string, { id: string; name: string }[]>();
  const coverage = new Map<string, { id: string; name: string; places: number }>();
  const withProducts = new Set<string>();
  for (let i = 0; i < allIds.length; i += 200) {
    const { data } = await admin.from("business_location_availability_products").select("availability_id, product_id, products(id, name)").in("availability_id", allIds.slice(i, i + 200));
    for (const l of (data ?? []) as unknown as { availability_id: string; product_id: string; products: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
      const p = one(l.products);
      if (!p) continue;
      withProducts.add(l.availability_id);
      const c = coverage.get(p.id) ?? { id: p.id, name: p.name, places: 0 };
      c.places += 1;
      coverage.set(p.id, c);
      if (pageIds.includes(l.availability_id)) productsOnPage.set(l.availability_id, [...(productsOnPage.get(l.availability_id) ?? []), p]);
    }
  }

  const entries: OwnerAvailabilityItem[] = [];
  for (const r of rows) {
    const loc = one(r.locations);
    if (!loc) continue;
    entries.push({
      id: r.id,
      locationId: loc.id,
      locationName: loc.name,
      locationSlug: loc.slug,
      city: loc.city,
      state: loc.state,
      imageUrl: loc.cover_image_url ?? loc.logo_url ?? null,
      relationships: normalizeAvailabilityRelationships(r.relationships && r.relationships.length > 0 ? r.relationships : [r.relationship]),
      status: r.status,
      source: r.source,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      note: r.note,
      products: productsOnPage.get(r.id) ?? [],
    });
  }

  const seen = new Set<string>();
  const appearances = [...((apsByMarket.data ?? []) as { id: string; title: string; start_at: string; venue_name: string | null }[]), ...((apsByLocation.data ?? []) as { id: string; title: string; start_at: string; venue_name: string | null }[])]
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 10)
    .map((a) => ({ id: a.id, title: a.title, startAt: a.start_at, venue: a.venue_name }));

  return {
    available: true,
    market,
    isNoMarket: isNone,
    ours: ((oursRes.data ?? []) as unknown as { locations: Loc | Loc[] | null }[]).map((o) => one(o.locations)).filter((l): l is Loc => Boolean(l)).map((l) => ({ id: l.id, name: l.name, slug: l.slug, city: l.city, state: l.state })),
    entries,
    entriesTotal: entriesRes.count ?? entries.length,
    page: pageNo,
    pageSize: DETAIL_PAGE_SIZE,
    productCoverage: [...coverage.values()].sort((a, b) => b.places - a.places || a.name.localeCompare(b.name)),
    brandWidePlaces: allIds.filter((id) => !withProducts.has(id)).length,
    appearances,
  };
}

