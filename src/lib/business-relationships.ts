import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAvailabilityRelationships, type AvailabilityRelationship, type AvailabilityStatus } from "./business-availability-domain";
import { getOwnerAvailabilityForLocation, type OwnerAvailabilityItem } from "./business-availability-owner";
import { getBusinessPlacementByLocation, type BusinessPlacementItem } from "./business-placements";
import type { PlacementStatus } from "./business-placements-domain";
import { todayIn } from "./event-time";
import { locationInScope, readGeographyCatalog, scopeFromCatalog, scopeLocationFilter, type GeographyScope } from "./geography-scope";
import { getGrowthContext, getOpportunityCandidates, selectRelevantOpportunities, type RelevantOpportunity } from "./relevant-opportunities";
import type { RelevanceScope } from "./relevant-opportunities-domain";

/** Business ↔ Location relationships — ONE reader for every lens (Find Us Here,
 * Growth, By Market, later the Map and Next).
 *
 * A relationship is not a table. It is composed, for one Business and one
 * canonical Location, from the rows that already exist for that pair:
 *   business_locations                — "Our Location" (the Business operates it)
 *   business_location_availability    — Find Us Here (public once live + in date)
 *   business_location_placements      — the private commercial pursuit (Target)
 *   appearances (location_id)         — dated presence
 *   opportunity_listings              — relevant commercial Opportunities
 * Location id is the identity everywhere (the Map's click target).
 *
 * Definitions used by every lens:
 *   CURRENT FOOTPRINT = Our Locations ∪ live, in-date Find Us Here (pending and
 *                       declined never count; a Target alone never counts).
 *   GROWTH ACTIVITY   = Placements that aren't Passed, by status.
 *
 * Privacy: service-role client; the caller has already authorized the session
 * for THIS Business, and every read is scoped by business_id. Placement reads
 * never include internal_notes. Reads are bounded (paged id-level reads with a
 * hard page cap; display lists capped). Nothing is stored or cached. */

const PAGE = 1000;
const MAX_PAGES = 20;
export const GEOGRAPHY_LIST_LIMIT = 50;

/** The date Find Us Here uses to decide "in date" (same as the public read). */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** The calendar day a Target's date-only Next Action is judged against. No
 * Business or Location stores a timezone, so this is Findmi's app calendar
 * (APP_TIMEZONE, the same day Events and Here Now use) — a step dated Oct 22
 * is due on Oct 22 there, not early when UTC crosses midnight. */
export const followUpToday = (now: Date = new Date()) => todayIn(undefined, now);

export function isInDate(startsOn: string | null, endsOn: string | null, today: string): boolean {
  return (!startsOn || startsOn <= today) && (!endsOn || endsOn >= today);
}

/** Live AND in date — the only Find Us Here state that is public, and the only one that is footprint. */
export function isPublicPresence(p: { status: AvailabilityStatus; startsOn: string | null; endsOn: string | null }, today: string): boolean {
  return p.status === "live" && isInDate(p.startsOn, p.endsOn, today);
}

// ── Shared row shape ─────────────────────────────────────────────────────────

export interface RelationshipPlace {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  imageUrl: string | null;
  unlisted: boolean;
  marketId: string | null;
  areaId: string | null;
}

export interface RelationshipRow {
  place: RelationshipPlace;
  ours: boolean;
  presence: { status: AvailabilityStatus; relationships: AvailabilityRelationship[]; public: boolean } | null;
  placement: { status: PlacementStatus; nextAction: string | null; nextActionAt: string | null } | null;
}

type RawLoc = { id: string; name: string; slug: string; city: string | null; state: string | null; logo_url: string | null; cover_image_url: string | null; is_demo: boolean | null; market_id: string | null; market_area_id: string | null };
const LOC = "locations!inner(id, name, slug, city, state, logo_url, cover_image_url, is_demo, market_id, market_area_id)";
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const toPlace = (l: RawLoc): RelationshipPlace => ({ id: l.id, name: l.name, slug: l.slug, city: l.city, state: l.state, imageUrl: l.cover_image_url ?? l.logo_url ?? null, unlisted: Boolean(l.is_demo), marketId: l.market_id, areaId: l.market_area_id });

type PagedRead = PromiseLike<{ data: unknown[] | null; count: number | null; error: { code?: string; message?: string } | null }>;

/** Every row a query matches, in parallel pages of 1,000 (capped at 20 pages). */
async function readAll<T>(build: (from: number, to: number) => PagedRead): Promise<T[] | null> {
  const first = await build(0, PAGE - 1);
  if (first.error) return null;
  const total = first.count ?? (first.data ?? []).length;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => build((i + 1) * PAGE, (i + 2) * PAGE - 1)));
  return [...((first.data ?? []) as T[]), ...rest.flatMap((r) => ((r.data ?? []) as T[]))];
}

/** A scope for these reads: a Market / Area scope, or "none" (places with no Market). */
export type RelationshipScope = GeographyScope | "none";

function scoped<Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: readonly string[]) => Q; is: (c: string, v: null) => Q }>(query: Q, scope: RelationshipScope | null): Q {
  if (scope === null) return query;
  if (scope === "none") return query.is("locations.market_id", null);
  return scopeLocationFilter(query, scope, "locations.");
}

type OursRaw = { location_id: string; locations: RawLoc | RawLoc[] | null };
type PresenceRaw = { id: string; location_id: string; status: AvailabilityStatus; relationship: AvailabilityRelationship; relationships?: AvailabilityRelationship[] | null; starts_on: string | null; ends_on: string | null; locations: RawLoc | RawLoc[] | null };
type PlacementRaw = { location_id: string; status: PlacementStatus; next_action: string | null; next_action_at: string | null; locations: RawLoc | RawLoc[] | null };

/** Every relationship of this Business (optionally within one scope), composed
 * per Location. Bounded: paged id-level reads with place display fields. */
export async function readRelationships(admin: SupabaseClient, businessId: string, scope: RelationshipScope | null): Promise<{ available: boolean; rows: RelationshipRow[]; presenceIds: string[] }> {
  const ord = (q: any) => q.order("location_id");
  const [ours, presence, placements] = await Promise.all([
    readAll<OursRaw>((from, to) => ord(scoped(admin.from("business_locations").select(`location_id, ${LOC}`, { count: "exact" }).eq("business_id", businessId), scope)).range(from, to)),
    readAll<PresenceRaw>((from, to) => ord(scoped(admin.from("business_location_availability").select(`id, location_id, status, relationship, relationships, starts_on, ends_on, ${LOC}`, { count: "exact" }).eq("business_id", businessId), scope)).range(from, to)),
    readAll<PlacementRaw>((from, to) => ord(scoped(admin.from("business_location_placements").select(`location_id, status, next_action, next_action_at, ${LOC}`, { count: "exact" }).eq("business_id", businessId), scope)).range(from, to)),
  ]);
  if (!ours || !presence) return { available: false, rows: [], presenceIds: [] };
  const today = todayIso();
  const byLoc = new Map<string, RelationshipRow>();
  const row = (raw: RawLoc | RawLoc[] | null) => {
    const loc = one(raw);
    if (!loc) return null;
    let r = byLoc.get(loc.id);
    if (!r) {
      r = { place: toPlace(loc), ours: false, presence: null, placement: null };
      byLoc.set(loc.id, r);
    }
    return r;
  };
  for (const o of ours) {
    const r = row(o.locations);
    if (r) r.ours = true;
  }
  for (const p of presence) {
    const r = row(p.locations);
    if (!r) continue;
    r.presence = {
      status: p.status,
      relationships: normalizeAvailabilityRelationships(p.relationships && p.relationships.length > 0 ? p.relationships : [p.relationship]),
      public: isPublicPresence({ status: p.status, startsOn: p.starts_on, endsOn: p.ends_on }, today),
    };
  }
  // Placements may be missing before Block A's migration — the rest still works.
  for (const p of placements ?? []) {
    const r = row(p.locations);
    if (r) r.placement = { status: p.status, nextAction: p.next_action, nextActionAt: p.next_action_at };
  }
  return { available: true, rows: [...byLoc.values()], presenceIds: presence.map((p) => p.id) };
}

/** Footprint vs Growth Activity for a set of composed rows — the ONE definition. */
export interface RelationshipCounts {
  footprint: number;
  ours: number;
  publicPresence: number;
  pendingReview: number;
  pursuing: number;
  byStatus: Record<PlacementStatus, number>;
}

export function countRelationships(rows: readonly RelationshipRow[]): RelationshipCounts {
  const c: RelationshipCounts = { footprint: 0, ours: 0, publicPresence: 0, pendingReview: 0, pursuing: 0, byStatus: { target: 0, in_conversation: 0, placement_pending: 0, active: 0, passed: 0 } };
  for (const r of rows) {
    if (r.ours) c.ours += 1;
    if (r.presence?.public) c.publicPresence += 1;
    if (r.presence?.status === "pending") c.pendingReview += 1;
    if (isFootprint(r)) c.footprint += 1;
    if (r.placement) {
      c.byStatus[r.placement.status] += 1;
      if (r.placement.status !== "passed") c.pursuing += 1;
    }
  }
  return c;
}

export const isFootprint = (r: RelationshipRow) => r.ours || Boolean(r.presence?.public);

// ── Geography overview (By Market) ──────────────────────────────────────────

export interface GeographyCard {
  key: string;
  /** "Jersey City" — the user's own geography. */
  label: string;
  /** Quiet context ("North Jersey") for an Area; null for a Market. */
  context: string | null;
  marketSlug: string | null;
  areaSlug: string | null;
  priority: boolean;
  current: boolean;
  counts: RelationshipCounts;
  opportunities: number;
  upcomingAppearances: number;
}

export interface GeographyOverview {
  available: boolean;
  /** Priority (and current) geographies the Business declared — Areas included. */
  growingIn: GeographyCard[];
  /** Every other Market with footprint or pipeline. */
  markets: GeographyCard[];
  noMarket: GeographyCard | null;
  /** Declared places Findmi has no Market for yet (labels only). */
  unmapped: string[];
  others: { label: string; marketSlug: string }[];
}

export async function getGeographyOverview(admin: SupabaseClient, businessId: string): Promise<GeographyOverview> {
  const now = new Date().toISOString();
  const [catalog, rel, audit, goals, appearances, candidates, ctx] = await Promise.all([
    readGeographyCatalog(admin),
    readRelationships(admin, businessId, null),
    admin.from("brand_audit_markets").select("intent, level, market_id, market_area_id, label").eq("business_id", businessId).eq("source", "declared"),
    admin.from("business_opportunity_goals").select("market_ids").eq("business_id", businessId).eq("status", "active"),
    readAll<{ market_id: string | null; market_area_id: string | null; locations: { market_id: string | null; market_area_id: string | null } | null }>((from, to) =>
      admin.from("appearances").select("market_id, market_area_id, locations(market_id, market_area_id)", { count: "exact" }).eq("business_id", businessId).neq("status", "canceled").gte("start_at", now).order("id").range(from, to)
    ),
    getOpportunityCandidates(admin, businessId),
    getGrowthContext(admin, businessId),
  ]);
  const empty: GeographyOverview = { available: false, growingIn: [], markets: [], noMarket: null, unmapped: [], others: [] };
  if (!rel.available) return empty;

  const card = (scope: GeographyScope, flags: { priority: boolean; current: boolean }): GeographyCard => {
    const rows = rel.rows.filter((r) => locationInScope({ market_id: r.place.marketId, market_area_id: r.place.areaId }, scope));
    const relevance: RelevanceScope = scope.kind === "market" ? { kind: "market", marketId: scope.market.id, label: scope.label } : { kind: "area", marketId: scope.market.id, areaIds: scope.areaIds, label: scope.label };
    const upcoming = (appearances ?? []).filter((a) => {
      const g = a.locations ?? { market_id: a.market_id, market_area_id: a.market_area_id };
      return locationInScope({ market_id: g.market_id ?? a.market_id, market_area_id: g.market_area_id ?? a.market_area_id }, scope);
    }).length;
    return {
      key: scope.key,
      label: scope.label,
      context: scope.context,
      marketSlug: scope.market.slug,
      areaSlug: scope.area?.slug ?? null,
      priority: flags.priority,
      current: flags.current,
      counts: countRelationships(rows),
      opportunities: selectRelevantOpportunities(businessId, candidates, relevance, ctx, 100).length,
      upcomingAppearances: upcoming,
    };
  };

  // Declared geographies first (an Area stays an Area: "Jersey City", not "North Jersey").
  const declared = new Map<string, { marketId: string; areaId: string | null; priority: boolean; current: boolean }>();
  const unmapped: string[] = [];
  for (const d of (audit.data ?? []) as { intent: "current" | "priority"; level: string; market_id: string | null; market_area_id: string | null; label: string }[]) {
    const area = d.market_area_id ? catalog.areas.find((a) => a.id === d.market_area_id) : null;
    const marketId = area?.market_id ?? d.market_id;
    if (!marketId) {
      if (d.intent === "priority" && !unmapped.includes(d.label)) unmapped.push(d.label);
      continue;
    }
    const k = `${marketId}:${area?.id ?? ""}`;
    const cur = declared.get(k) ?? { marketId, areaId: area?.id ?? null, priority: false, current: false };
    if (d.intent === "priority") cur.priority = true;
    else cur.current = true;
    declared.set(k, cur);
  }
  for (const g of (goals.data ?? []) as { market_ids: string[] | null }[]) {
    for (const marketId of g.market_ids ?? []) {
      const k = `${marketId}:`;
      const cur = declared.get(k) ?? { marketId, areaId: null, priority: false, current: false };
      cur.priority = true;
      declared.set(k, cur);
    }
  }
  const growingIn: GeographyCard[] = [];
  const shownMarkets = new Set<string>();
  for (const d of declared.values()) {
    if (!d.priority && !d.current) continue;
    const scope = scopeFromCatalog(catalog, d.marketId, d.areaId);
    if (!scope) continue;
    growingIn.push(card(scope, { priority: d.priority, current: d.current }));
    if (!d.areaId) shownMarkets.add(d.marketId);
  }
  growingIn.sort((a, b) => Number(b.priority) - Number(a.priority) || a.label.localeCompare(b.label));

  const markets: GeographyCard[] = [];
  const others: { label: string; marketSlug: string }[] = [];
  for (const m of catalog.markets) {
    if (shownMarkets.has(m.id)) continue;
    const scope = scopeFromCatalog(catalog, m.id, null)!;
    const c = card(scope, { priority: false, current: false });
    if (c.counts.footprint + c.counts.pursuing + c.counts.pendingReview > 0 || c.upcomingAppearances > 0) markets.push(c);
    else others.push({ label: m.name, marketSlug: m.slug });
  }
  markets.sort((a, b) => b.counts.footprint - a.counts.footprint || b.counts.pursuing - a.counts.pursuing || a.label.localeCompare(b.label));

  const noneRows = rel.rows.filter((r) => !r.place.marketId);
  const noMarket: GeographyCard | null = noneRows.length
    ? { key: "none", label: "No Market Yet", context: null, marketSlug: null, areaSlug: null, priority: false, current: false, counts: countRelationships(noneRows), opportunities: 0, upcomingAppearances: 0 }
    : null;

  return { available: true, growingIn, markets, noMarket, unmapped, others };
}

// ── Geography detail (one Market / Area) ────────────────────────────────────

export interface GeographyDetail {
  available: boolean;
  label: string;
  context: string | null;
  counts: RelationshipCounts;
  /** Current Footprint (Our Locations first), capped. */
  footprint: RelationshipRow[];
  /** Find Us Here awaiting review — shown, never counted as footprint. */
  pendingReview: RelationshipRow[];
  /** Growth Pipeline (not Passed), soonest Next Action first, capped. */
  pipeline: RelationshipRow[];
  opportunities: RelevantOpportunity[];
  productCoverage: { id: string; name: string; places: number }[];
  brandWidePlaces: number;
  appearances: { id: string; title: string; startAt: string; venue: string | null }[];
}

export async function getGeographyDetail(admin: SupabaseClient, businessId: string, scope: RelationshipScope): Promise<GeographyDetail> {
  const now = new Date().toISOString();
  const [rel, candidates, ctx] = await Promise.all([readRelationships(admin, businessId, scope), getOpportunityCandidates(admin, businessId), getGrowthContext(admin, businessId)]);
  const label = scope === "none" ? "No Market Yet" : scope.label;
  const context = scope === "none" ? null : scope.context;
  const empty: GeographyDetail = { available: false, label, context, counts: countRelationships([]), footprint: [], pendingReview: [], pipeline: [], opportunities: [], productCoverage: [], brandWidePlaces: 0, appearances: [] };
  if (!rel.available) return empty;

  const rows = rel.rows;
  const byName = (a: RelationshipRow, b: RelationshipRow) => a.place.name.localeCompare(b.place.name);
  const footprint = rows.filter(isFootprint).sort((a, b) => Number(b.ours) - Number(a.ours) || byName(a, b));
  const pendingReview = rows.filter((r) => r.presence?.status === "pending" && !isFootprint(r)).sort(byName);
  const pipeline = rows
    .filter((r) => r.placement && r.placement.status !== "passed")
    .sort((a, b) => (a.placement!.nextActionAt ?? "9999").localeCompare(b.placement!.nextActionAt ?? "9999") || byName(a, b));

  // Products placed here (all Find Us Here entries in scope — the Pass 1 rule).
  const coverage = new Map<string, { id: string; name: string; places: number }>();
  const withProducts = new Set<string>();
  for (let i = 0; i < rel.presenceIds.length; i += 200) {
    const { data } = await admin.from("business_location_availability_products").select("availability_id, products(id, name)").in("availability_id", rel.presenceIds.slice(i, i + 200));
    for (const l of (data ?? []) as unknown as { availability_id: string; products: { id: string; name: string } | { id: string; name: string }[] | null }[]) {
      const p = one(l.products);
      if (!p) continue;
      withProducts.add(l.availability_id);
      const c = coverage.get(p.id) ?? { id: p.id, name: p.name, places: 0 };
      c.places += 1;
      coverage.set(p.id, c);
    }
  }

  // Upcoming Appearances here: at a Location in scope, or (no Location) assigned to the geography.
  let appearances: GeographyDetail["appearances"] = [];
  if (scope !== "none") {
    const geoFilter = (q: any) => (scope.kind === "market" ? q.eq("market_id", scope.market.id) : q.in("market_area_id", scope.areaIds));
    const [atPlaces, assigned] = await Promise.all([
      scopeLocationFilter(admin.from("appearances").select(`id, title, start_at, venue_name, locations!inner(market_id, market_area_id)`).eq("business_id", businessId).neq("status", "canceled").gte("start_at", now) as any, scope, "locations.").order("start_at").limit(10),
      geoFilter(admin.from("appearances").select("id, title, start_at, venue_name").eq("business_id", businessId).neq("status", "canceled").is("location_id", null).gte("start_at", now)).order("start_at").limit(10),
    ]);
    const seen = new Set<string>();
    appearances = [...((atPlaces.data ?? []) as { id: string; title: string; start_at: string; venue_name: string | null }[]), ...((assigned.data ?? []) as { id: string; title: string; start_at: string; venue_name: string | null }[])]
      .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .slice(0, 10)
      .map((a) => ({ id: a.id, title: a.title, startAt: a.start_at, venue: a.venue_name }));
  }

  const relevance: RelevanceScope | null = scope === "none" ? null : scope.kind === "market" ? { kind: "market", marketId: scope.market.id, label: scope.label } : { kind: "area", marketId: scope.market.id, areaIds: scope.areaIds, label: scope.label };
  return {
    available: true,
    label,
    context,
    counts: countRelationships(rows),
    footprint: footprint.slice(0, GEOGRAPHY_LIST_LIMIT),
    pendingReview: pendingReview.slice(0, GEOGRAPHY_LIST_LIMIT),
    pipeline: pipeline.slice(0, GEOGRAPHY_LIST_LIMIT),
    opportunities: relevance ? selectRelevantOpportunities(businessId, candidates, relevance, ctx) : [],
    productCoverage: [...coverage.values()].sort((a, b) => b.places - a.places || a.name.localeCompare(b.name)),
    brandWidePlaces: rel.presenceIds.filter((id) => !withProducts.has(id)).length,
    appearances,
  };
}

// ── One relationship (the workspace) ────────────────────────────────────────

export interface WorkspacePlace extends RelationshipPlace {
  address: string | null;
  archived: boolean;
  latitude: number | null;
  longitude: number | null;
  areaName: string | null;
  marketName: string | null;
}

export interface WorkspaceAppearance {
  id: string;
  title: string;
  startAt: string;
  href: string;
}

export interface RelationshipWorkspaceData {
  place: WorkspacePlace;
  ours: boolean;
  /** The Find Us Here entry at this place (any status), editable through the existing editor. */
  presence: OwnerAvailabilityItem | null;
  presencePublic: boolean;
  /** The private pursuit, when the Business is tracking this place. Never internal_notes. */
  placement: BusinessPlacementItem | null;
  nextAppearance: WorkspaceAppearance | null;
  recentAppearance: WorkspaceAppearance | null;
  opportunities: RelevantOpportunity[];
}

type WorkspaceLoc = RawLoc & { address: string | null; archived_at: string | null; trashed_at: string | null; latitude: number | null; longitude: number | null; market: { name: string } | { name: string }[] | null; area: { name: string; display_name: string | null } | { name: string; display_name: string | null }[] | null };

/** Everything the relationship workspace shows for (business, location). Works
 * whether or not a Placement exists. Null when the place doesn't exist / is trashed. */
export async function getRelationshipWorkspace(admin: SupabaseClient, businessId: string, locationId: string): Promise<RelationshipWorkspaceData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(locationId)) return null;
  const { data: locRow } = await admin
    .from("locations")
    .select("id, name, slug, address, city, state, logo_url, cover_image_url, is_demo, archived_at, trashed_at, latitude, longitude, market_id, market_area_id, market:markets(name), area:market_areas(name, display_name)")
    .eq("id", locationId)
    .maybeSingle();
  const loc = locRow as WorkspaceLoc | null;
  if (!loc || loc.trashed_at) return null;
  const now = new Date().toISOString();
  const base = `/account/business/${businessId}?tab=findmi-here`;
  const appearanceCols = "id, title, start_at";
  const [ours, presence, placement, next, recent, candidates, ctx, catalog] = await Promise.all([
    admin.from("business_locations").select("id").eq("business_id", businessId).eq("location_id", locationId).maybeSingle(),
    getOwnerAvailabilityForLocation(admin, businessId, locationId),
    getBusinessPlacementByLocation(admin, businessId, locationId),
    admin.from("appearances").select(appearanceCols).eq("business_id", businessId).eq("location_id", locationId).neq("status", "canceled").gte("start_at", now).order("start_at").limit(1).maybeSingle(),
    admin.from("appearances").select(appearanceCols).eq("business_id", businessId).eq("location_id", locationId).neq("status", "canceled").lt("start_at", now).order("start_at", { ascending: false }).limit(1).maybeSingle(),
    getOpportunityCandidates(admin, businessId),
    getGrowthContext(admin, businessId),
    readGeographyCatalog(admin),
  ]);
  const toAppearance = (a: { id: string; title: string; start_at: string } | null): WorkspaceAppearance | null => (a ? { id: a.id, title: a.title, startAt: a.start_at, href: `${base}&editing=${a.id}` } : null);
  const area = one(loc.area);
  const ancestors: string[] = [];
  for (let id: string | null = loc.market_area_id, guard = 0; id && guard < 10; guard++) {
    ancestors.push(id);
    id = catalog.areas.find((a) => a.id === id)?.parent_area_id ?? null;
  }
  return {
    place: {
      ...toPlace(loc),
      address: loc.address,
      archived: Boolean(loc.archived_at),
      latitude: loc.latitude,
      longitude: loc.longitude,
      areaName: area ? area.display_name?.trim() || area.name : null,
      marketName: one(loc.market)?.name ?? null,
    },
    ours: Boolean(ours.data),
    presence,
    presencePublic: presence ? isPublicPresence(presence, todayIso()) : false,
    placement,
    nextAppearance: toAppearance(next.data as { id: string; title: string; start_at: string } | null),
    recentAppearance: toAppearance(recent.data as { id: string; title: string; start_at: string } | null),
    opportunities: selectRelevantOpportunities(businessId, candidates, { kind: "location", locationId, marketId: loc.market_id, areaAncestors: ancestors }, ctx, 6),
  };
}

/** Targets with a Next Action due today or earlier (not Passed) — Needs Attention. */
export async function getDueNextActions(admin: SupabaseClient, businessId: string, today = followUpToday()): Promise<{ count: number; first: { locationId: string; name: string; nextAction: string | null; overdue: boolean } | null }> {
  const { data, count, error } = await admin
    .from("business_location_placements")
    .select("location_id, next_action, next_action_at, locations!inner(name)", { count: "exact" })
    .eq("business_id", businessId)
    .neq("status", "passed")
    .lte("next_action_at", today)
    .order("next_action_at")
    .limit(1);
  if (error || !data || data.length === 0) return { count: 0, first: null };
  const r = data[0] as unknown as { location_id: string; next_action: string | null; next_action_at: string; locations: { name: string } | { name: string }[] | null };
  return { count: count ?? 1, first: { locationId: r.location_id, name: one(r.locations)?.name ?? "A Target", nextAction: r.next_action, overdue: r.next_action_at < today } };
}

/** Growth's contextual geography links ("Growing In: Jersey City →"): the
 * priority Markets / Areas the Business declared, resolved to the By Market
 * lens. Two small reads; no counts. */
export async function getGrowingIn(admin: SupabaseClient, businessId: string): Promise<{ label: string; marketSlug: string; areaSlug: string | null }[]> {
  const [catalog, audit] = await Promise.all([
    readGeographyCatalog(admin),
    admin.from("brand_audit_markets").select("market_id, market_area_id").eq("business_id", businessId).eq("intent", "priority").eq("source", "declared"),
  ]);
  const out: { label: string; marketSlug: string; areaSlug: string | null }[] = [];
  const seen = new Set<string>();
  for (const r of (audit.data ?? []) as { market_id: string | null; market_area_id: string | null }[]) {
    const area = r.market_area_id ? catalog.areas.find((a) => a.id === r.market_area_id) : null;
    const scope = scopeFromCatalog(catalog, area?.market_id ?? r.market_id ?? "", area?.id ?? null);
    if (!scope || seen.has(scope.key)) continue;
    seen.add(scope.key);
    out.push({ label: scope.label, marketSlug: scope.market.slug, areaSlug: scope.area?.slug ?? null });
  }
  return out;
}
