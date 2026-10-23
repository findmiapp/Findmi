import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readGeographyCatalog, scopeFromCatalog, scopeLocationFilter, type GeographyScope } from "../geography-scope";
import { getOpportunityCandidates, type OpportunityCandidate } from "../relevant-opportunities";
import { geographyReason } from "../relevant-opportunities-domain";
import { TARGET_COLUMN } from "../business-targets";
import type { TargetStatus } from "../business-targets-domain";
import type { CommercialIntent, TargetKind } from "../commercial-intents";
import type { InquiryStatus } from "../commercial-inquiries-domain";
import {
  CATEGORY_FAMILY,
  COMMERCIAL_CANDIDATE_LIMIT,
  TARGET_KIND_FOR_ENTITY,
  commercialEmptyMessage,
  hasCommercialScope,
  isOrganicMarketProvenance,
  pageOf,
  parseCategoryKey,
  rankCommercial,
  reasonLabels,
  type CommercialCandidate,
  type CommercialEntity,
  type CommercialQuery,
  type MatchReason,
} from "./commercial";

/** Commercial Discovery — the server reader behind Growth → Targets → Discover.
 *
 * One pattern for every entity: a bounded, server-filtered candidate read
 * (ids + names + the reasons each matched) → the organic rank (commercial.ts)
 * → one page → batch enrichment of ONLY that page (details, Category, whether
 * this Business already targets it, Opportunity context). No N+1, no
 * fetch-everything, nothing paid or featured in the order.
 *
 * Geography is honest per entity:
 *   Places      — the Location's own canonical geography.
 *   Events      — an upcoming occurrence's Location (or, for an occurrence
 *                 without a Location, its Market); Event-level geography only
 *                 when no upcoming occurrence carries any geography.
 *   Businesses  — only a real relationship: a Location they operate, an Event
 *                 they host, an upcoming Appearance, where they're based, an
 *                 ORGANIC Market they serve, or a Market they declared as a
 *                 priority. Paid / promotional / complimentary Market slots
 *                 never count.
 * Organizers and Venue Operators are Business ROLES derived from
 * events.host_business_id and business_locations — never from organizer_name
 * text, never declared.
 *
 * Read-only: nothing here writes, and a result never tells its counterparty
 * anything. The caller has authorized the session for `viewerId`. */

export interface CategoryOption {
  key: string;
  name: string;
}

export interface CommercialFilterOptions {
  markets: { slug: string; name: string }[];
  /** Areas in tree order within each Market (depth 0 = top level). */
  areas: { slug: string; name: string; marketSlug: string; depth: number }[];
  categories: { location: CategoryOption[]; business: CategoryOption[]; eventCategory: CategoryOption[]; eventFormat: CategoryOption[] };
}

export interface CommercialOpportunity {
  title: string;
  path: string;
  reason: string;
}

export interface CommercialResult {
  id: string;
  kind: TargetKind;
  name: string;
  imageUrl: string | null;
  /** "Place", "Business", "Organizer", "Venue Operator", "Event". */
  role: string;
  category: string | null;
  /** Where (and for Events, when) — "SoHo · NYC". */
  context: string | null;
  /** Events: the next date (YYYY-MM-DD). */
  date: string | null;
  reasons: string[];
  /** Its public page. */
  href: string | null;
  /** This Business already targets it (any status) — never a second Target. */
  target: { id: string; status: TargetStatus } | null;
  /** This Business's own open Inquiry with it (shared state), if any. */
  inquiry: { intent: CommercialIntent; status: InquiryStatus } | null;
  /** One of this Business's own Locations — not a Target. */
  ownLocation: boolean;
  opportunities: CommercialOpportunity[];
  opportunityCount: number;
}

export interface CommercialDiscovery {
  query: CommercialQuery;
  options: CommercialFilterOptions;
  /** prompt: nothing chosen yet; unknown_geography: a Market / Area that doesn't exist. */
  state: "prompt" | "unknown_geography" | "results";
  scopeLabel: string | null;
  scopeContext: string | null;
  categoryName: string | null;
  items: CommercialResult[];
  total: number;
  page: number;
  pages: number;
  /** More than COMMERCIAL_CANDIDATE_LIMIT matched — ask to narrow. */
  truncated: boolean;
  empty: { title: string; hint: string | null } | null;
}

const LIMIT = COMMERCIAL_CANDIDATE_LIMIT;
/** Relationship rows read per signal (bounded; far above today's volumes). */
const SIGNAL_LIMIT = 5000;
const CHUNK = 150;
const OPPORTUNITIES_SHOWN = 2;

const ROLE_LABEL: Record<CommercialEntity, string> = { places: "Place", businesses: "Business", organizers: "Organizer", operators: "Venue Operator", events: "Event" };

type CategoryRow = { id: string; name: string; kind: string; parent_id: string | null };
type AreaRow = { id: string; name: string; display_name: string | null; slug: string; market_id: string; parent_area_id: string | null };
type Catalog = Awaited<ReturnType<typeof readGeographyCatalog>>;
type Row = Record<string, unknown>;
type Reasons = Map<string, Set<MatchReason>>;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const areaLabel = (a: Pick<AreaRow, "name" | "display_name">) => a.display_name?.trim() || a.name;
const textOr = (cols: string[], q: string) => cols.map((c) => `${c}.ilike.%${q}%`).join(",");

/** "YYYY-MM-DD" in New York (Findmi's markets) — today's date for "upcoming". */
export function nyDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Not yet over: ends (or, with no end, starts) from now on, or dated today or later. */
export function isUpcoming(r: { start_at?: unknown; end_at?: unknown; occurrence_date?: unknown }, nowIso: string, today: string): boolean {
  const at = (r.end_at ?? r.start_at) as string | null | undefined;
  if (at && Date.parse(at) >= Date.parse(nowIso)) return true;
  const day = r.occurrence_date as string | null | undefined;
  return Boolean(day && day >= today);
}

const addReason = (m: Reasons, id: unknown, r: MatchReason) => {
  if (typeof id !== "string" || !id) return;
  const s = m.get(id) ?? new Set<MatchReason>();
  s.add(r);
  m.set(id, s);
};

/** One bounded `.in()` read per CHUNK ids (keeps request URLs short), in parallel. */
async function inChunks<T = Row>(ids: readonly string[], read: (chunk: string[]) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((c) => read(c)));
  return results.flatMap((r) => ((r.data ?? []) as T[]));
}

type Q = any;
const liveBusiness = (q: Q): Q => q.eq("is_demo", false).eq("publication_status", "live").is("archived_at", null).is("trashed_at", null);
const liveEvent = liveBusiness;

/** The category and every descendant (Event categories nest). */
function withDescendants(id: string, cats: readonly CategoryRow[]): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parent_id === out[i] && !out.includes(c.id)) out.push(c.id);
  return out;
}

// ── Filter options ─────────────────────────────────────────────────────────

function buildOptions(catalog: Catalog, cats: readonly CategoryRow[]): CommercialFilterOptions {
  const areas: CommercialFilterOptions["areas"] = [];
  for (const m of catalog.markets) {
    const inMarket = catalog.areas.filter((a) => a.market_id === m.id);
    const walk = (parent: string | null, depth: number) => {
      for (const a of inMarket.filter((x) => x.parent_area_id === parent).sort((x, y) => areaLabel(x).localeCompare(areaLabel(y)))) {
        areas.push({ slug: a.slug, name: areaLabel(a), marketSlug: m.slug, depth });
        walk(a.id, depth + 1);
      }
    };
    walk(null, 0);
  }
  const top = (kind: string, prefix: "c" | "f") =>
    cats.filter((c) => c.kind === kind && !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ key: `${prefix}:${c.id}`, name: c.name }));
  return {
    markets: catalog.markets.map((m) => ({ slug: m.slug, name: m.name })),
    areas,
    categories: { location: top("location", "c"), business: top("business", "c"), eventCategory: top("event", "c"), eventFormat: top("event_format", "f") },
  };
}

/** The selected category, only when it belongs to the entity's family. */
function selectedCategory(q: CommercialQuery, cats: readonly CategoryRow[]): { kind: "category" | "format"; ids: string[]; name: string } | null {
  const parsed = parseCategoryKey(q.category);
  if (!parsed) return null;
  const row = cats.find((c) => c.id === parsed.id);
  if (!row) return null;
  const family = CATEGORY_FAMILY[q.entity];
  const fits = parsed.kind === "format" ? family === "event" && row.kind === "event_format" : row.kind === family;
  if (!fits) return null;
  return { kind: parsed.kind, ids: parsed.kind === "format" ? [row.id] : withDescendants(row.id, cats), name: row.name };
}

// ── Candidates ─────────────────────────────────────────────────────────────

interface Candidates {
  items: CommercialCandidate[];
  truncated: boolean;
}

async function placeCandidates(admin: SupabaseClient, q: CommercialQuery, scope: GeographyScope | null, cat: ReturnType<typeof selectedCategory>): Promise<Candidates> {
  let query: Q = admin.from("locations").select("id, name").is("archived_at", null).is("trashed_at", null).eq("is_demo", false);
  if (scope) query = scopeLocationFilter(query, scope);
  if (cat) query = query.in("category_id", cat.ids);
  if (q.q) query = query.or(textOr(["name", "city", "address"], q.q));
  const { data } = await query.order("name").limit(LIMIT + 1);
  const rows = (data ?? []) as { id: string; name: string }[];
  return { items: rows.slice(0, LIMIT).map((r) => ({ id: r.id, name: r.name, reasons: scope ? ["location_here"] : [] })), truncated: rows.length > LIMIT };
}

/** Upcoming Events in a scope, by occurrence geography first and Event-level
 * geography only as the fallback. eventId → reason + next date. */
async function eventsInScope(admin: SupabaseClient, scope: GeographyScope, nowIso: string, today: string, since: string): Promise<Map<string, { reason: MatchReason; date: string | null }>> {
  const out = new Map<string, { reason: MatchReason; date: string | null }>();
  const take = (eventId: string, reason: MatchReason, date: string | null) => {
    const prev = out.get(eventId);
    if (!prev || (prev.reason === reason && (date ?? "9999") < (prev.date ?? "9999")) || (reason === "happening_here" && prev.reason !== reason)) out.set(eventId, { reason, date });
  };
  const atLocation: Q = scopeLocationFilter(
    admin.from("event_occurrences").select("event_id, start_at, end_at, occurrence_date, locations!inner(market_id, market_area_id)").gte("occurrence_date", since),
    scope,
    "locations."
  );
  const marketOnly: Q =
    scope.kind === "market"
      ? admin.from("event_occurrences").select("event_id, start_at, end_at, occurrence_date").is("location_id", null).eq("market_id", scope.market.id).gte("occurrence_date", since)
      : null;
  const eventLevel: Q = scopeLocationFilter(liveEvent(admin.from("events").select("id, start_date, end_date, start_at, end_at")), scope);
  const [a, b, c] = await Promise.all([atLocation.limit(SIGNAL_LIMIT), marketOnly ? marketOnly.limit(SIGNAL_LIMIT) : Promise.resolve({ data: [] }), eventLevel.limit(SIGNAL_LIMIT)]);
  for (const r of [...((a.data ?? []) as Row[]), ...((b.data ?? []) as Row[])]) {
    if (isUpcoming(r, nowIso, today)) take(r.event_id as string, "happening_here", (r.occurrence_date as string) ?? null);
  }
  // Fallback: an Event listed here whose upcoming occurrences carry no geography of their own (or that has none at all).
  const fallback = ((c.data ?? []) as { id: string; start_date: string | null; end_date: string | null; start_at: string | null; end_at: string | null }[]).filter((e) => !out.has(e.id));
  if (fallback.length) {
    const occ = await inChunks<Row>(fallback.map((e) => e.id), (ids) => admin.from("event_occurrences").select("event_id, start_at, end_at, occurrence_date, location_id, market_id").in("event_id", ids).limit(SIGNAL_LIMIT));
    const byEvent = new Map<string, Row[]>();
    for (const r of occ) byEvent.set(r.event_id as string, [...(byEvent.get(r.event_id as string) ?? []), r]);
    for (const e of fallback) {
      const rows = byEvent.get(e.id) ?? [];
      if (rows.length === 0) {
        const end = e.end_date ?? e.start_date;
        if ((end && end >= today) || isUpcoming(e, nowIso, today)) take(e.id, "listed_here", e.start_date && e.start_date >= today ? e.start_date : today);
        continue;
      }
      const upcoming = rows.filter((r) => isUpcoming(r, nowIso, today));
      if (upcoming.length === 0 || upcoming.some((r) => r.location_id || r.market_id)) continue;
      take(e.id, "listed_here", upcoming.map((r) => r.occurrence_date as string).sort()[0] ?? null);
    }
  }
  return out;
}

/** Next date for Events found without a scope (text search): upcoming only. */
async function upcomingDates(admin: SupabaseClient, events: { id: string; start_date: string | null; end_date: string | null; start_at: string | null; end_at: string | null }[], nowIso: string, today: string): Promise<Map<string, string | null>> {
  const occ = await inChunks<Row>(events.map((e) => e.id), (ids) => admin.from("event_occurrences").select("event_id, start_at, end_at, occurrence_date").in("event_id", ids).limit(SIGNAL_LIMIT));
  const has = new Set(occ.map((r) => r.event_id as string));
  const out = new Map<string, string | null>();
  for (const r of occ) {
    if (!isUpcoming(r, nowIso, today)) continue;
    const id = r.event_id as string;
    const d = r.occurrence_date as string;
    if (!out.has(id) || d < (out.get(id) ?? "9999")) out.set(id, d);
  }
  for (const e of events) {
    if (has.has(e.id)) continue;
    const end = e.end_date ?? e.start_date;
    if ((end && end >= today) || isUpcoming(e, nowIso, today)) out.set(e.id, e.start_date && e.start_date >= today ? e.start_date : today);
  }
  return out;
}

async function eventIdsInCategory(admin: SupabaseClient, cat: NonNullable<ReturnType<typeof selectedCategory>>): Promise<Set<string>> {
  const table = cat.kind === "format" ? "event_formats" : "event_categories";
  const { data } = await admin.from(table).select("event_id").in("category_id", cat.ids).limit(SIGNAL_LIMIT);
  return new Set(((data ?? []) as { event_id: string }[]).map((r) => r.event_id));
}

async function eventCandidates(admin: SupabaseClient, q: CommercialQuery, scope: GeographyScope | null, cat: ReturnType<typeof selectedCategory>, clock: Clock): Promise<Candidates> {
  const inCat = cat ? await eventIdsInCategory(admin, cat) : null;
  const filtered = (query: Q): Q => (q.q ? query.or(textOr(["name", "venue_name", "city"], q.q)) : query);
  if (scope) {
    const found = await eventsInScope(admin, scope, clock.nowIso, clock.today, clock.since);
    const ids = [...found.keys()].filter((id) => !inCat || inCat.has(id));
    const rows = await inChunks<{ id: string; name: string }>(ids, (c) => filtered(liveEvent(admin.from("events").select("id, name").in("id", c))).limit(CHUNK));
    const items = rows.map((r) => ({ id: r.id, name: r.name, reasons: [found.get(r.id)!.reason], date: found.get(r.id)!.date }));
    return { items: items.slice(0, LIMIT), truncated: items.length > LIMIT };
  }
  const cols = "id, name, start_date, end_date, start_at, end_at";
  type EventRow = { id: string; name: string; start_date: string | null; end_date: string | null; start_at: string | null; end_at: string | null };
  const rows: EventRow[] = inCat
    ? await inChunks<EventRow>([...inCat], (c) => filtered(liveEvent(admin.from("events").select(cols).in("id", c))).limit(CHUNK))
    : (((await filtered(liveEvent(admin.from("events").select(cols))).order("name").limit(LIMIT + 1)).data ?? []) as EventRow[]);
  const dates = await upcomingDates(admin, rows.slice(0, LIMIT), clock.nowIso, clock.today);
  return { items: rows.slice(0, LIMIT).filter((r) => dates.has(r.id)).map((r) => ({ id: r.id, name: r.name, reasons: [], date: dates.get(r.id) ?? null })), truncated: rows.length > LIMIT };
}

/** Every truthful reason a Business relates to the scope. */
async function businessReasons(admin: SupabaseClient, scope: GeographyScope, catalog: Catalog, clock: Clock): Promise<Reasons> {
  const reasons: Reasons = new Map();
  const marketId = scope.market.id;
  const marketAreaIds = catalog.areas.filter((a) => a.market_id === marketId).map((a) => a.id);
  const areaIds = scope.kind === "area" ? scope.areaIds : marketAreaIds;
  const notOver = `end_at.gte.${clock.nowIso},and(end_at.is.null,start_at.gte.${clock.nowIso})`;

  const [operated, appearAt, appearOwn, based, serves, servesAreas, audit, goals, hosted] = await Promise.all([
    scopeLocationFilter(admin.from("business_locations").select("business_id, locations!inner(market_id, market_area_id)").is("locations.archived_at", null).is("locations.trashed_at", null) as Q, scope, "locations.").limit(SIGNAL_LIMIT),
    scopeLocationFilter(admin.from("appearances").select("business_id, locations!inner(market_id, market_area_id)").neq("status", "canceled").or(notOver) as Q, scope, "locations.").limit(SIGNAL_LIMIT),
    scopeLocationFilter(admin.from("appearances").select("business_id").is("location_id", null).neq("status", "canceled").or(notOver) as Q, scope).limit(SIGNAL_LIMIT),
    areaIds.length ? admin.from("businesses").select("id").in("market_area_id", areaIds).limit(SIGNAL_LIMIT) : Promise.resolve({ data: [] }),
    admin.from("business_markets").select("business_id, provenance").eq("market_id", marketId).eq("active", true).limit(SIGNAL_LIMIT),
    scope.kind === "area" ? admin.from("business_market_areas").select("business_id").in("market_area_id", scope.areaIds).limit(SIGNAL_LIMIT) : Promise.resolve({ data: [] }),
    scope.kind === "area"
      ? admin.from("brand_audit_markets").select("business_id").eq("intent", "priority").in("market_area_id", scope.areaIds).limit(SIGNAL_LIMIT)
      : admin.from("brand_audit_markets").select("business_id").eq("intent", "priority").eq("market_id", marketId).limit(SIGNAL_LIMIT),
    scope.kind === "market" ? admin.from("business_opportunity_goals").select("business_id").eq("status", "active").contains("market_ids", [marketId]).limit(SIGNAL_LIMIT) : Promise.resolve({ data: [] }),
    eventsInScope(admin, scope, clock.nowIso, clock.today, clock.since),
  ]);
  for (const r of (operated.data ?? []) as Row[]) addReason(reasons, r.business_id, "location_here");
  for (const r of [...((appearAt.data ?? []) as Row[]), ...((appearOwn.data ?? []) as Row[])]) addReason(reasons, r.business_id, "appearing_here");
  for (const r of (based.data ?? []) as Row[]) addReason(reasons, r.id, "based_here");
  // Organic Market service only — a paid, promotional or plan-granted slot is not geography.
  const organic = new Set(((serves.data ?? []) as { business_id: string; provenance: string | null }[]).filter((r) => isOrganicMarketProvenance(r.provenance)).map((r) => r.business_id));
  if (scope.kind === "market") for (const id of organic) addReason(reasons, id, "serves_here");
  else for (const r of (servesAreas.data ?? []) as Row[]) if (organic.has(r.business_id as string)) addReason(reasons, r.business_id, "serves_here");
  for (const r of [...((audit.data ?? []) as Row[]), ...((goals.data ?? []) as Row[])]) addReason(reasons, r.business_id, "growing_here");
  if (hosted.size) {
    const hosts = await inChunks<Row>([...hosted.keys()], (ids) => liveEvent(admin.from("events").select("id, host_business_id").in("id", ids).not("host_business_id", "is", null)).limit(CHUNK));
    for (const r of hosts) addReason(reasons, r.host_business_id, "hosting_here");
  }
  return reasons;
}

/** Businesses holding a role anywhere (for a search without a Market). */
async function roleHolders(admin: SupabaseClient, entity: "organizers" | "operators"): Promise<Set<string>> {
  if (entity === "organizers") {
    const { data } = await liveEvent(admin.from("events").select("host_business_id").not("host_business_id", "is", null)).limit(SIGNAL_LIMIT);
    return new Set(((data ?? []) as { host_business_id: string }[]).map((r) => r.host_business_id));
  }
  const { data } = await admin.from("business_locations").select("business_id, locations!inner(id)").is("locations.archived_at", null).is("locations.trashed_at", null).limit(SIGNAL_LIMIT);
  return new Set(((data ?? []) as { business_id: string }[]).map((r) => r.business_id));
}

const REQUIRED_REASON: Partial<Record<CommercialEntity, MatchReason>> = { organizers: "hosting_here", operators: "location_here" };

async function businessCandidates(admin: SupabaseClient, viewerId: string, q: CommercialQuery, scope: GeographyScope | null, cat: ReturnType<typeof selectedCategory>, catalog: Catalog, clock: Clock): Promise<Candidates> {
  const inCat = cat
    ? new Set((((await admin.from("business_categories").select("business_id").in("category_id", cat.ids).limit(SIGNAL_LIMIT)).data ?? []) as { business_id: string }[]).map((r) => r.business_id))
    : null;
  const filtered = (query: Q): Q => {
    let out = liveBusiness(query).neq("id", viewerId);
    if (q.q) out = out.or(textOr(["name", "city"], q.q));
    return out;
  };
  const role = q.entity === "organizers" || q.entity === "operators" ? q.entity : null;
  if (scope) {
    const reasons = await businessReasons(admin, scope, catalog, clock);
    const required = REQUIRED_REASON[q.entity];
    const ids = [...reasons.keys()].filter((id) => (!required || reasons.get(id)!.has(required)) && (!inCat || inCat.has(id)));
    const rows = await inChunks<{ id: string; name: string }>(ids, (c) => filtered(admin.from("businesses").select("id, name").in("id", c)).limit(CHUNK));
    const items = rows.map((r) => ({ id: r.id, name: r.name, reasons: [...reasons.get(r.id)!] }));
    return { items: items.slice(0, LIMIT), truncated: items.length > LIMIT };
  }
  const holders = role ? await roleHolders(admin, role) : null;
  const allowed = holders && inCat ? new Set([...holders].filter((id) => inCat.has(id))) : (holders ?? inCat);
  if (allowed) {
    const rows = await inChunks<{ id: string; name: string }>([...allowed], (c) => filtered(admin.from("businesses").select("id, name").in("id", c)).limit(CHUNK));
    return { items: rows.slice(0, LIMIT).map((r) => ({ id: r.id, name: r.name, reasons: [] })), truncated: rows.length > LIMIT };
  }
  const { data } = await filtered(admin.from("businesses").select("id, name")).order("name").limit(LIMIT + 1);
  const rows = (data ?? []) as { id: string; name: string }[];
  return { items: rows.slice(0, LIMIT).map((r) => ({ id: r.id, name: r.name, reasons: [] })), truncated: rows.length > LIMIT };
}

// ── Enrichment (one page only) ─────────────────────────────────────────────

interface Clock {
  nowIso: string;
  today: string;
  /** Lower bound for occurrence_date reads (a day early, for time zones). */
  since: string;
}

const placeLine = (city: unknown, state: unknown) => [city, state].filter((v) => typeof v === "string" && v).join(", ") || null;

function geoLine(catalog: Catalog, marketId: unknown, areaId: unknown): string | null {
  const area = catalog.areas.find((a) => a.id === areaId);
  const market = catalog.markets.find((m) => m.id === (area?.market_id ?? marketId));
  return [area ? areaLabel(area) : null, market?.name ?? null].filter(Boolean).join(" · ") || null;
}

function areaAncestors(catalog: Catalog, areaId: string | null): string[] {
  const out: string[] = [];
  let cur = areaId ? catalog.areas.find((a) => a.id === areaId) : undefined;
  while (cur && !out.includes(cur.id)) {
    out.push(cur.id);
    cur = cur.parent_area_id ? catalog.areas.find((a) => a.id === cur!.parent_area_id) : undefined;
  }
  return out;
}

/** Opportunity context, secondary to the result: sent to you first, then the
 * most specific (this exact place / Event → its Area → its Market), then the
 * soonest deadline. */
function opportunityContext(viewerId: string, candidates: readonly OpportunityCandidate[], match: (c: OpportunityCandidate) => { reason: string; rank: number } | null): { list: CommercialOpportunity[]; count: number } {
  const base = `/account/business/${viewerId}`;
  const t = (v: string | null) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  const hits = candidates
    .map((c) => ({ c, m: match(c) }))
    .filter((x): x is { c: OpportunityCandidate; m: { reason: string; rank: number } } => Boolean(x.m))
    .sort((a, b) => Number(Boolean(b.c.recipientId)) - Number(Boolean(a.c.recipientId)) || a.m.rank - b.m.rank || t(a.c.responseDeadline) - t(b.c.responseDeadline) || a.c.title.localeCompare(b.c.title) || a.c.listingId.localeCompare(b.c.listingId));
  return {
    count: hits.length,
    list: hits.slice(0, OPPORTUNITIES_SHOWN).map(({ c, m }) => ({
      title: c.title,
      path: c.recipientId ? `${base}/opportunities/${c.recipientId}` : `${base}/opportunities/explore/${c.listingId}`,
      reason: c.recipientId ? `Sent to You · ${m.reason}` : m.reason,
    })),
  };
}

async function enrich(admin: SupabaseClient, viewerId: string, q: CommercialQuery, page: CommercialCandidate[], cats: readonly CategoryRow[], catalog: Catalog): Promise<CommercialResult[]> {
  if (page.length === 0) return [];
  const kind = TARGET_KIND_FOR_ENTITY[q.entity];
  const ids = page.map((c) => c.id);
  const catName = (id: unknown) => cats.find((c) => c.id === id)?.name ?? null;

  const details =
    kind === "location"
      ? admin.from("locations").select("id, slug, city, state, cover_image_url, logo_url, category_id, market_id, market_area_id").in("id", ids)
      : kind === "business"
        ? admin.from("businesses").select("id, slug, city, state, logo_url, cover_image_url, market_area_id").in("id", ids)
        : admin.from("events").select("id, slug, city, venue_name, cover_image_url").in("id", ids);
  const inquiryCol = kind === "location" ? "counterparty_location_id" : kind === "event" ? "counterparty_event_id" : "counterparty_business_id";
  const [detailRows, targetRows, ownRows, catRows, formatRows, opps, inquiryRows] = await Promise.all([
    details,
    admin.from("business_targets").select("id, status, target_location_id, target_business_id, target_event_id").eq("business_id", viewerId).in(TARGET_COLUMN[kind], ids),
    kind === "location" ? admin.from("business_locations").select("location_id").eq("business_id", viewerId).in("location_id", ids) : Promise.resolve({ data: [] }),
    kind === "business" ? admin.from("business_categories").select("business_id, category_id").in("business_id", ids) : kind === "event" ? admin.from("event_categories").select("event_id, category_id").in("event_id", ids) : Promise.resolve({ data: [] }),
    kind === "event" ? admin.from("event_formats").select("event_id, category_id").in("event_id", ids) : Promise.resolve({ data: [] }),
    // Only Opportunities THIS Business may already see (sent to it, or open and
    // discoverable) — a result never reveals what was offered to anyone else.
    getOpportunityCandidates(admin, viewerId),
    // This Business's own open Inquiries with the page's results (never anyone else's).
    admin.from("commercial_inquiries").select("intent, status, created_at, counterparty_business_id, counterparty_location_id, counterparty_event_id").eq("sender_business_id", viewerId).in(inquiryCol, ids).in("status", ["sent", "responded"]).order("created_at", { ascending: false }),
  ]);
  // A Business result's Opportunities: ones at a Location it operates, or for an Event it hosts.
  const bizLinks = new Map<string, { locations: Set<string>; events: Set<string> }>();
  if (kind === "business" && opps.length) {
    const oppEvents = [...new Set(opps.map((o) => o.eventId).filter((v): v is string => Boolean(v)))];
    const oppLocations = [...new Set(opps.map((o) => o.geo.locationId).filter((v): v is string => Boolean(v)))];
    const [hosted, operated] = await Promise.all([
      oppEvents.length ? admin.from("events").select("id, host_business_id").in("id", oppEvents).in("host_business_id", ids) : Promise.resolve({ data: [] }),
      oppLocations.length ? admin.from("business_locations").select("business_id, location_id").in("location_id", oppLocations).in("business_id", ids) : Promise.resolve({ data: [] }),
    ]);
    const link = (b: string) => bizLinks.get(b) ?? (bizLinks.set(b, { locations: new Set(), events: new Set() }), bizLinks.get(b)!);
    for (const r of (hosted.data ?? []) as Row[]) link(r.host_business_id as string).events.add(r.id as string);
    for (const r of (operated.data ?? []) as Row[]) link(r.business_id as string).locations.add(r.location_id as string);
  }
  const byId = new Map(((detailRows.data ?? []) as Row[]).map((r) => [r.id as string, r]));
  const targets = new Map(((targetRows.data ?? []) as Row[]).map((r) => [r[TARGET_COLUMN[kind]] as string, { id: r.id as string, status: r.status as TargetStatus }]));
  const inquiries = new Map<string, { intent: CommercialIntent; status: InquiryStatus }>();
  for (const r of (inquiryRows.data ?? []) as Row[]) {
    const id = r[inquiryCol] as string;
    if (!inquiries.has(id)) inquiries.set(id, { intent: r.intent as CommercialIntent, status: r.status as InquiryStatus });
  }
  const own = new Set(((ownRows.data ?? []) as Row[]).map((r) => r.location_id as string));
  const owner = kind === "business" ? "business_id" : "event_id";
  const namesFor = (id: string) => {
    // Formats first for Events ("Market"), then top-level categories; deterministic by name.
    const fmt = ((formatRows.data ?? []) as Row[]).filter((r) => r.event_id === id).map((r) => catName(r.category_id)).filter((n): n is string => Boolean(n)).sort();
    const rest = ((catRows.data ?? []) as Row[]).filter((r) => r[owner] === id).map((r) => catName(r.category_id)).filter((n): n is string => Boolean(n)).sort();
    return [...new Set([...fmt, ...rest])].slice(0, 2).join(", ") || null;
  };

  return page.map((c) => {
    const d = byId.get(c.id) ?? {};
    const base = { id: c.id, kind, name: c.name, role: ROLE_LABEL[q.entity], date: c.date ?? null, reasons: reasonLabels(c.reasons), target: targets.get(c.id) ?? null, inquiry: inquiries.get(c.id) ?? null, ownLocation: own.has(c.id) };
    if (kind === "location") {
      const ancestors = areaAncestors(catalog, (d.market_area_id as string) ?? null);
      const o = opportunityContext(viewerId, opps, (oc) => {
        const reason = geographyReason(oc.geo, { kind: "location", locationId: c.id, marketId: (d.market_id as string) ?? null, areaAncestors: ancestors });
        return reason ? { reason, rank: oc.geo.locationId ? 0 : oc.geo.areaId ? 1 : 2 } : null;
      });
      return { ...base, imageUrl: ((d.cover_image_url ?? d.logo_url) as string) ?? null, category: catName(d.category_id), context: geoLine(catalog, d.market_id, d.market_area_id) ?? placeLine(d.city, d.state), href: d.slug ? `/location/${d.slug}` : null, opportunities: o.list, opportunityCount: o.count };
    }
    if (kind === "event") {
      const o = opportunityContext(viewerId, opps, (oc) => (oc.eventId === c.id ? { reason: "For This Event", rank: 0 } : null));
      return { ...base, imageUrl: (d.cover_image_url as string) ?? null, category: namesFor(c.id), context: ((d.venue_name || d.city) as string) || null, href: d.slug ? `/event/${d.slug}` : null, opportunities: o.list, opportunityCount: o.count };
    }
    const links = bizLinks.get(c.id);
    const o = opportunityContext(viewerId, links ? opps : [], (oc) =>
      oc.eventId && links!.events.has(oc.eventId) ? { reason: "For Their Event", rank: 0 } : oc.geo.locationId && links!.locations.has(oc.geo.locationId) ? { reason: "At Their Location", rank: 0 } : null
    );
    return { ...base, imageUrl: ((d.logo_url ?? d.cover_image_url) as string) ?? null, category: namesFor(c.id), context: geoLine(catalog, null, d.market_area_id) ?? placeLine(d.city, d.state), href: d.slug ? `/business/${d.slug}` : null, opportunities: o.list, opportunityCount: o.count };
  });
}

// ── Entry point ────────────────────────────────────────────────────────────

/** Resolve the query's Market / Area slugs against the catalog. */
function resolveScope(q: CommercialQuery, catalog: Catalog): { scope: GeographyScope | null; unknown: boolean; parentLabel: string | null } {
  if (!q.market) return { scope: null, unknown: false, parentLabel: null };
  const m = catalog.markets.find((x) => x.slug === q.market);
  if (!m) return { scope: null, unknown: true, parentLabel: null };
  if (!q.area) return { scope: scopeFromCatalog(catalog, m.id), unknown: false, parentLabel: null };
  const a = catalog.areas.find((x) => x.market_id === m.id && x.slug === q.area);
  if (!a) return { scope: null, unknown: true, parentLabel: null };
  const parent = a.parent_area_id ? catalog.areas.find((x) => x.id === a.parent_area_id) : null;
  return { scope: scopeFromCatalog(catalog, m.id, a.id), unknown: false, parentLabel: parent ? areaLabel(parent) : m.name };
}

export async function getCommercialDiscovery(admin: SupabaseClient, viewerId: string, q: CommercialQuery, now = new Date()): Promise<CommercialDiscovery> {
  const [catalog, catRes] = await Promise.all([
    readGeographyCatalog(admin),
    admin.from("categories").select("id, name, kind, parent_id").in("kind", ["location", "business", "event", "event_format"]).limit(SIGNAL_LIMIT),
  ]);
  const cats = (catRes.data ?? []) as CategoryRow[];
  const options = buildOptions(catalog, cats);
  const cat = selectedCategory(q, cats);
  const query: CommercialQuery = { ...q, category: cat ? q.category : "" };
  const blank = { query, options, scopeLabel: null, scopeContext: null, categoryName: cat?.name ?? null, items: [], total: 0, page: 1, pages: 1, truncated: false, empty: null };
  const { scope, unknown, parentLabel } = resolveScope(query, catalog);
  if (unknown) return { ...blank, state: "unknown_geography" };
  if (!hasCommercialScope(query)) return { ...blank, state: "prompt" };

  const clock: Clock = { nowIso: now.toISOString(), today: nyDate(now), since: nyDate(new Date(now.getTime() - 86_400_000)) };
  const found =
    query.entity === "places"
      ? await placeCandidates(admin, query, scope, cat)
      : query.entity === "events"
        ? await eventCandidates(admin, query, scope, cat, clock)
        : await businessCandidates(admin, viewerId, query, scope, cat, catalog, clock);
  const ranked = rankCommercial(found.items, query.q);
  const paged = pageOf(ranked, query.page);
  const items = await enrich(admin, viewerId, query, paged.items, cats, catalog);
  const scopeLabel = scope?.label ?? null;
  return {
    ...blank,
    state: "results",
    scopeLabel,
    scopeContext: scope?.context ?? null,
    items,
    total: ranked.length,
    page: paged.page,
    pages: paged.pages,
    truncated: found.truncated,
    empty: ranked.length === 0 ? commercialEmptyMessage(query, { scopeLabel, categoryName: cat?.name ?? null, parentLabel }) : null,
  };
}

/** Pure helpers, exported for tests. */
export const __test = { isUpcoming, withDescendants, areaAncestors, nyDate };
