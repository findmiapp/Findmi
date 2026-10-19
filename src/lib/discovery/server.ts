import "server-only";
import { cache } from "react";
import { getSupabase } from "@/lib/supabase";
import { getServerSupabase } from "@/lib/supabase/server";
import { getEventsDiscovery, getFindMiHereFeed, getLocations, searchBusinesses } from "@/lib/data";
import { eventHref } from "@/lib/event-links";
import { getProductMappings, resolvePhrase, resolveState, resolveZipCode, geoScopeFor, censusTargetByKey } from "@/lib/geo/resolve";
import type { GeoTarget } from "@/lib/geo/resolve-core";
import { resolveCanonicalGeoScope } from "@/lib/geo/canonical-scope";
import { isCanonicalGeoScopeEmpty, type CanonicalGeoScope } from "@/lib/geo/entity-geo-core";
import { executeDiscovery, type DiscoveryItem, type DiscoveryResult, type ExecuteContext, type GeoScope, type PersonalContext } from "./engine";
import { entitiesFor, mergeQueries, topicQuerySchema, type DiscoveryQuery, type TopicQuery } from "./query";
import { parseSearch, type ParsedSearch, type ParseVocabulary } from "./parse";

// Discovery Intelligence V1 — server half. Loads the vocabulary (Topics,
// Event taxonomy, Markets, Areas), fetches ONE bounded candidate set per
// request through the existing public read helpers (same RLS, privacy and
// demo rules as every other surface), resolves geography, and runs the pure
// engine. Every read tolerates the V1 tables not existing yet.

export interface DiscoveryTopic {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  aliases: string[];
  query: TopicQuery;
  sort_order: number;
}

export interface DiscoveryLane {
  id: string;
  title: string;
  subtitle: string | null;
  kind: "topics" | "topic_results" | "areas";
  topic_ids: string[];
  topic_id: string | null;
  market_id: string | null;
  item_limit: number;
  sort_order: number;
  /** Discovery Lanes Placement & Density Refinement pass — which of the
   * homepage's two Lane regions this Lane renders in. At most one Lane
   * is ever "primary" (DB partial unique index backs the Admin
   * single-select control); everything else is "explore_more". */
  placement: "primary" | "explore_more";
}

export interface AreaRef {
  id: string;
  slug: string;
  name: string;
  market_id: string;
  market: string;
  marketName: string;
  parent_area_id: string | null;
  level: "area" | "neighborhood";
  consumer_visible: boolean;
  aliases: string[];
  sort_order: number;
  /** Discovery Tile Visual System pass, Part B — optional editorial cover
   * image for this Area's Discovery tile (market_areas.image_url), same
   * shape as DiscoveryTopic.image_url. Admin-set only — never generated,
   * never a stock image. */
  image_url: string | null;
}

export interface Vocabulary extends ParseVocabulary {
  topicRows: DiscoveryTopic[];
  areaRows: AreaRef[];
  marketRows: { id: string; slug: string; name: string; consumer_visible: boolean }[];
  /** category id → { slug, parent slug } for Event Categories + Formats. */
  taxonomyById: Map<string, { slug: string; kind: "event" | "event_format"; parentSlug: string | null; name: string }>;
  topCategories: string[];
}

export const getVocabulary = cache(async (): Promise<Vocabulary> => {
  const supabase = getSupabase();
  const empty: Vocabulary = { topics: [], taxonomy: [], areas: [], markets: [], topicRows: [], areaRows: [], marketRows: [], taxonomyById: new Map(), topCategories: [] };
  if (!supabase) return empty;
  const [topicsRes, catsRes, marketsRes, areasRes] = await Promise.all([
    supabase.from("discovery_topics").select("id, slug, name, description, image_url, aliases, query, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("categories").select("id, name, slug, kind, parent_id").in("kind", ["event", "event_format"]),
    supabase.from("markets").select("id, slug, name, display_name, active, consumer_visible").eq("active", true),
    supabase.from("market_areas").select("*").eq("active", true).order("sort_order"),
  ]);
  const topicRows: DiscoveryTopic[] = [];
  for (const t of (topicsRes.data ?? []) as (Omit<DiscoveryTopic, "query"> & { query: unknown })[]) {
    const q = topicQuerySchema.safeParse(t.query);
    if (q.success) topicRows.push({ ...t, aliases: t.aliases ?? [], query: q.data });
  }
  const cats = (catsRes.data ?? []) as { id: string; name: string; slug: string; kind: "event" | "event_format"; parent_id: string | null }[];
  const byId = new Map(cats.map((c) => [c.id, c]));
  const taxonomyById = new Map(cats.map((c) => [c.id, { slug: c.slug, kind: c.kind, name: c.name, parentSlug: c.parent_id ? (byId.get(c.parent_id)?.slug ?? null) : null }]));
  type MarketRow = { id: string; slug: string; name: string; display_name: string | null; consumer_visible?: boolean | null };
  const marketRows = ((marketsRes.data ?? []) as MarketRow[]).map((m) => ({ id: m.id, slug: m.slug, name: m.display_name?.trim() || m.name, consumer_visible: m.consumer_visible !== false }));
  const marketById = new Map(marketRows.map((m) => [m.id, m]));
  type AreaRow = { id: string; slug: string; name: string; display_name: string | null; market_id: string; parent_area_id?: string | null; level?: string | null; consumer_visible: boolean; aliases: string[] | null; sort_order: number; image_url?: string | null };
  const areaRows: AreaRef[] = ((areasRes.data ?? []) as AreaRow[])
    .filter((a) => marketById.has(a.market_id))
    .map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.display_name?.trim() || a.name,
      market_id: a.market_id,
      market: marketById.get(a.market_id)!.slug,
      marketName: marketById.get(a.market_id)!.name,
      parent_area_id: a.parent_area_id ?? null,
      level: a.level === "neighborhood" ? "neighborhood" : "area",
      consumer_visible: a.consumer_visible,
      aliases: a.aliases ?? [],
      sort_order: a.sort_order,
      image_url: a.image_url ?? null,
    }));
  return {
    topicRows,
    areaRows,
    marketRows,
    taxonomyById,
    topCategories: cats.filter((c) => c.kind === "event" && !c.parent_id).map((c) => c.slug),
    topics: topicRows.map((t) => ({ slug: t.slug, name: t.name, aliases: t.aliases })),
    taxonomy: cats.map((c) => ({ slug: c.slug, name: c.name, kind: c.kind })),
    areas: areaRows.flatMap((a) => [a.name, ...a.aliases].map((name) => ({ slug: a.slug, name, market: a.market, marketName: `${a.name}, ${a.marketName}` }))),
    markets: marketRows.map((m) => ({ slug: m.slug, name: m.name })),
  };
});

// ------------------------------------------------------------ candidates

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function taxonomyFor(eventIds: string[], vocab: Vocabulary): Promise<Map<string, { categories: string[]; formats: string[] }>> {
  const out = new Map<string, { categories: string[]; formats: string[] }>();
  const supabase = getSupabase();
  if (!supabase || eventIds.length === 0) return out;
  const [cats, fmts] = await Promise.all([
    supabase.from("event_categories").select("event_id, category_id").in("event_id", eventIds),
    supabase.from("event_formats").select("event_id, category_id").in("event_id", eventIds),
  ]);
  const get = (id: string) => out.get(id) ?? (out.set(id, { categories: [], formats: [] }), out.get(id)!);
  for (const l of (cats.data ?? []) as { event_id: string; category_id: string }[]) {
    const t = vocab.taxonomyById.get(l.category_id);
    if (!t || t.kind !== "event") continue;
    const e = get(l.event_id);
    e.categories.push(t.slug, ...(t.parentSlug ? [t.parentSlug] : []));
  }
  for (const l of (fmts.data ?? []) as { event_id: string; category_id: string }[]) {
    const t = vocab.taxonomyById.get(l.category_id);
    if (t?.kind === "event_format") get(l.event_id).formats.push(t.slug);
  }
  for (const v of out.values()) {
    v.categories = [...new Set(v.categories)];
    v.formats = [...new Set(v.formats)];
  }
  return out;
}

const words = (...parts: (string | null | undefined)[]) =>
  parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

export interface CandidateScope {
  market?: string;
  area?: string;
  entities: DiscoveryItem["kind"][];
}

/** One bounded candidate fetch per request (cached per render), through
 * the existing public helpers.
 *
 * Canonical Entity Geography completion pass — `geoKey` (a canonical
 * census_geographies key, from `?geo=`/`?census=` — see runDiscovery) is
 * threaded into every fetcher's own `canonicalGeo` scope so the SAME
 * bounded candidate fetch is scoped SERVER-SIDE, before the 200/120/80/80
 * caps below are even applied — not just filtered in memory afterward by
 * the executor's text-based GeoScope (which still runs too, as a fallback
 * net for rows that predate the backfill — see runDiscovery). Part of the
 * cache key (a distinct geoKey is a genuinely distinct candidate set). */
export const getCandidates = cache(async (market: string | undefined, area: string | undefined, kinds: string, geoKey?: string): Promise<DiscoveryItem[]> => {
  const vocab = await getVocabulary();
  const want = new Set(kinds.split(","));
  const areaSlugById = new Map(vocab.areaRows.map((a) => [a.id, a.slug]));
  const scope = { marketSlug: market, areaSlug: market ? area : undefined };
  const canonicalGeo: CanonicalGeoScope | null = geoKey ? await resolveCanonicalGeoScope(geoKey) : null;
  const geoScope = canonicalGeo && !isCanonicalGeoScopeEmpty(canonicalGeo) ? { canonicalGeo } : {};
  const [events, appearances, places, brands] = await Promise.all([
    want.has("event") || want.has("appearance") ? getEventsDiscovery({ when: "anytime", limit: 200, ...scope, ...geoScope }) : Promise.resolve([]),
    want.has("appearance") ? getFindMiHereFeed("anytime", 120, { ...scope, ...geoScope }) : Promise.resolve([]),
    want.has("place") ? getLocations({ limit: 80, ...scope, ...geoScope }) : Promise.resolve([]),
    want.has("business") ? searchBusinesses({ limit: 80, ...scope, ...geoScope }) : Promise.resolve([]),
  ]);
  const tax = await taxonomyFor([...new Set([...events.map((e) => e.id), ...appearances.map((a) => a.event_id).filter((x): x is string => Boolean(x))])], vocab);
  const items: DiscoveryItem[] = [];
  if (want.has("event")) {
    for (const e of events) {
      const r = e as unknown as Row;
      const t = tax.get(e.id);
      items.push({
        kind: "event",
        id: e.id,
        title: e.name,
        href: eventHref(e.slug),
        image: e.cover_image_url,
        subtitle: e.venue_name ?? ([e.city, e.state].filter(Boolean).join(", ") || null),
        start_at: e.start_at,
        end_at: e.end_at,
        start_date: e.start_date ?? null,
        end_date: e.end_date ?? null,
        created_at: str(r.created_at),
        categories: t?.categories ?? [],
        formats: t?.formats ?? [],
        is_free: typeof r.is_free === "boolean" ? r.is_free : null,
        family_friendly: typeof r.family_friendly === "boolean" ? r.family_friendly : null,
        rsvp: Boolean(e.rsvp_enabled && e.rsvp_url),
        tickets: Boolean(e.tickets_enabled && e.tickets_url),
        city: e.city,
        state: e.state,
        postal_code: e.postal_code ?? null,
        area: e.market_area_id ? (areaSlugById.get(e.market_area_id) ?? null) : null,
        is_featured: Boolean(e.is_featured),
        has_description: Boolean(e.description && e.description.length > 40),
        haystack: words(e.name, e.venue_name, e.organizer_name, e.city),
        related: [e.id, ...(e.host_business_id ? [e.host_business_id] : [])],
      });
    }
  }
  const eventById = new Map(events.map((e) => [e.id, e]));
  if (want.has("appearance")) {
    for (const a of appearances) {
      const r = a as unknown as Row;
      const ev = a.event_id ? eventById.get(a.event_id) : undefined;
      const t = a.event_id ? tax.get(a.event_id) : undefined;
      items.push({
        kind: "appearance",
        id: a.id,
        title: a.title || a.business.name,
        href: `/business/${a.business.slug}`,
        image: a.flyer_image_url ?? a.business.cover_image_url ?? a.business.logo_url ?? null,
        subtitle: [a.business.name, a.location?.name ?? a.venue_name].filter(Boolean).join(" · ") || null,
        start_at: a.start_at,
        end_at: a.end_at,
        start_date: null,
        end_date: null,
        created_at: str(r.created_at),
        categories: t?.categories ?? [],
        formats: t?.formats ?? [],
        is_free: ev ? (((ev as unknown as Row).is_free as boolean | null) ?? null) : null,
        family_friendly: ev ? (((ev as unknown as Row).family_friendly as boolean | null) ?? null) : null,
        rsvp: false,
        tickets: false,
        city: a.city,
        state: a.state,
        postal_code: str(r.postal_code),
        area: (str(r.market_area_id) && areaSlugById.get(r.market_area_id as string)) || (ev?.market_area_id ? (areaSlugById.get(ev.market_area_id) ?? null) : null),
        is_featured: false,
        has_description: Boolean(a.description && a.description.length > 40),
        haystack: words(a.title, a.business.name, a.venue_name, a.location?.name, a.city),
        related: [a.business.id, ...(a.location?.id ? [a.location.id] : []), ...(a.event_id ? [a.event_id] : [])],
      });
    }
  }
  for (const l of want.has("place") ? places : []) {
    items.push({
      kind: "place",
      id: l.id,
      title: l.name,
      href: `/location/${l.slug}`,
      image: l.cover_image_url ?? null,
      subtitle: [l.category?.name, l.city].filter(Boolean).join(" · ") || null,
      start_at: null, end_at: null, start_date: null, end_date: null,
      created_at: str((l as unknown as Row).created_at),
      categories: [], formats: [], is_free: null, family_friendly: null, rsvp: false, tickets: false,
      city: l.city, state: l.state, postal_code: l.postal_code ?? null,
      area: l.market_area_id ? (areaSlugById.get(l.market_area_id) ?? null) : null,
      is_featured: false,
      has_description: Boolean(l.description && l.description.length > 40),
      haystack: words(l.name, l.category?.name, l.city),
      related: [l.id],
    });
  }
  for (const b of want.has("business") ? brands : []) {
    const r = b as unknown as Row;
    items.push({
      kind: "business",
      id: b.id,
      title: b.name,
      href: `/business/${b.slug}`,
      image: b.cover_image_url ?? b.logo_url ?? null,
      logo: b.logo_url ?? null,
      subtitle: b.short_description ?? (b.categories?.[0]?.name ?? null),
      start_at: null, end_at: null, start_date: null, end_date: null,
      created_at: str(r.created_at),
      categories: [], formats: [], is_free: null, family_friendly: null, rsvp: false, tickets: false,
      city: b.city, state: b.state, postal_code: b.postal_code ?? null,
      area: str(r.market_area_id) ? (areaSlugById.get(r.market_area_id as string) ?? null) : null,
      is_featured: Boolean(b.is_featured),
      has_description: Boolean(b.description && b.description.length > 40),
      haystack: words(b.name, b.short_description, ...(b.categories ?? []).map((c) => c.name)),
      related: [b.id],
    });
  }
  return items;
});

// ------------------------------------------------------------ personal

/** Read-time affinities from the viewer's OWN explicit actions (follows,
 * saves, relationships). Nothing inferred, nothing sensitive, nothing
 * persisted; anonymous viewers get none. */
export const getPersonalContext = cache(async (): Promise<PersonalContext | null> => {
  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const ids = (res: { data: unknown }, col: string) => ((res.data ?? []) as Row[]).map((r) => r[col] as string).filter(Boolean);
    const [fb, fe, fl, sb, se, sl, rel] = await Promise.all([
      supabase.from("account_followed_businesses").select("business_id").eq("user_id", user.id).limit(200),
      supabase.from("account_followed_events").select("event_id").eq("user_id", user.id).limit(200),
      supabase.from("account_followed_locations").select("location_id").eq("user_id", user.id).limit(200),
      supabase.from("account_saved_businesses").select("business_id").eq("user_id", user.id).limit(200),
      supabase.from("account_saved_events").select("event_id").eq("user_id", user.id).limit(200),
      supabase.from("account_saved_locations").select("location_id").eq("user_id", user.id).limit(200),
      supabase.from("user_entity_relationships").select("entity_type, entity_id, relation").eq("user_id", user.id).limit(500),
    ]);
    const relRows = (rel.data ?? []) as { entity_type: string; entity_id: string; relation: string }[];
    const vocab = await getVocabulary();
    const topicSlug = new Map(vocab.topicRows.map((t) => [t.id, t.slug]));
    const areaSlug = new Map(vocab.areaRows.map((a) => [a.id, a.slug]));
    const positive = relRows.filter((r) => r.relation !== "dislike");
    const topicSlugs = new Set<string>();
    for (const r of positive.filter((r) => r.entity_type === "topic")) {
      const t = vocab.topicRows.find((x) => x.id === r.entity_id);
      if (!t) continue;
      topicSlugs.add(topicSlug.get(r.entity_id)!);
      for (const s of [...(t.query.categories ?? []), ...(t.query.formats ?? [])]) topicSlugs.add(s);
    }
    return {
      relatedIds: new Set([...ids(fb, "business_id"), ...ids(fe, "event_id"), ...ids(fl, "location_id"), ...ids(sb, "business_id"), ...ids(se, "event_id"), ...ids(sl, "location_id"), ...positive.filter((r) => ["event", "business", "location"].includes(r.entity_type)).map((r) => r.entity_id)]),
      topicSlugs,
      areaSlugs: new Set(positive.filter((r) => r.entity_type === "area").map((r) => areaSlug.get(r.entity_id)).filter((s): s is string => Boolean(s))),
      dislikedIds: new Set(relRows.filter((r) => r.relation === "dislike").map((r) => r.entity_id)),
    };
  } catch {
    return null;
  }
});

// ------------------------------------------------------------ run

export interface RunOptions {
  /** Extra context merged BEFORE the query (an Area page's own Area). */
  context?: Partial<DiscoveryQuery>;
  personal?: boolean;
  geo?: GeoScope | null;
}

/** Topic slugs → their stored queries merged over the context. */
export function expandTopics(q: DiscoveryQuery, vocab: Vocabulary): DiscoveryQuery {
  const topics = (q.topics ?? []).map((s) => vocab.topicRows.find((t) => t.slug === s)).filter((t): t is DiscoveryTopic => Boolean(t));
  const { topics: _t, ...rest } = q;
  return mergeQueries(rest, ...topics.map((t) => t.query));
}

export async function runDiscovery(q: DiscoveryQuery, opts: RunOptions = {}): Promise<DiscoveryResult & { executed: DiscoveryQuery; geoLabel: string | null }> {
  const vocab = await getVocabulary();
  const executed = expandTopics(mergeQueries(opts.context, q), vocab);
  // An Area slug is only meaningful within its Market.
  if (executed.area && !executed.market) executed.market = vocab.areaRows.find((a) => a.slug === executed.area)?.market;
  let geo = opts.geo ?? null;
  if (!geo && executed.census) {
    const target = await censusTargetByKey(executed.census);
    if (target) geo = await geoScopeFor(target);
  }
  const geoLabel = geo?.label ?? null;
  const kinds = entitiesFor(executed).sort().join(",");
  // Canonical Entity Geography completion pass — the same resolved key
  // `?geo=`/`?census=` already carries (executed.census — see
  // discovery/query.ts's SCALAR_KEYS, where "census" IS the `geo` URL
  // param) also scopes the underlying candidate fetch now, not just the
  // in-memory GeoScope predicate below.
  const [candidates, personal] = await Promise.all([getCandidates(executed.market, executed.area, kinds, executed.census), opts.personal ? getPersonalContext() : Promise.resolve(null)]);
  const taxonomyNames: Record<string, string> = {};
  for (const t of vocab.taxonomyById.values()) taxonomyNames[t.slug] = t.name;
  const ctx: ExecuteContext = {
    geo,
    personal,
    taxonomyNames,
    topCategories: vocab.topCategories,
    areaNames: Object.fromEntries(vocab.areaRows.filter((a) => a.consumer_visible && (!executed.market || a.market === executed.market)).map((a) => [a.slug, a.name])),
  };
  // Area filtering already happened at the source (with roll-up); don't
  // re-filter by the item's own Area slug here.
  const { area: _area, market: _market, census: _census, ...inMemory } = executed;
  const result = executeDiscovery(candidates, { ...inMemory, area: executed.area }, { ...ctx, geo });
  return { ...result, query: q, executed, geoLabel };
}

// ------------------------------------------------------------ search

export interface SearchInterpretation {
  parsed: ParsedSearch;
  query: DiscoveryQuery;
  geo: { label: string; target: GeoTarget } | null;
  geoScope: GeoScope | null;
  /** Ambiguous place names: pick one (each is a real search link). */
  choices: { text: string; options: { label: string; query: DiscoveryQuery }[] }[];
  /** Near Me was asked but cannot run (no real venue coordinates). */
  nearMeUnavailable: boolean;
}

/** Text → structured query. Findmi vocabulary first, then a ZIP / State /
 * Census Place lookup for what's left; anything still unresolved is text. */
export async function interpretSearch(text: string, base: DiscoveryQuery = {}): Promise<SearchInterpretation> {
  const vocab = await getVocabulary();
  const parsed = parseSearch(text, vocab);
  const query: DiscoveryQuery = mergeQueries(base, parsed.query);
  const mappings = await getProductMappings();
  let geo: SearchInterpretation["geo"] = null;
  const choices: SearchInterpretation["choices"] = [];
  const leftovers: string[] = [];

  const apply = (target: GeoTarget) => {
    geo = { label: target.label, target };
    if (target.type === "findmi") {
      query.market = target.market;
      if (target.area) query.area = target.area;
      else delete query.area;
    } else query.census = target.geo_key;
  };

  if (!query.market && !query.area) {
    if (parsed.zip) {
      const r = await resolveZipCode(parsed.zip, mappings);
      if (r.status === "resolved") apply(r.target);
      else leftovers.push(parsed.zip);
    }
    for (const phrase of parsed.phrases) {
      if (geo) {
        leftovers.push(phrase);
        continue;
      }
      const r = await resolvePhrase(phrase, mappings, parsed.stateUsps);
      if (r.status === "resolved") apply(r.target);
      else if (r.status === "ambiguous")
        choices.push({
          text: phrase,
          options: r.options.map((t) => ({ label: t.label, query: t.type === "findmi" ? { ...query, market: t.market, ...(t.area ? { area: t.area } : {}) } : { ...query, census: t.geo_key } })),
        });
      else leftovers.push(phrase);
    }
    if (!geo && parsed.stateUsps && choices.length === 0) {
      const r = resolveState(parsed.stateUsps, mappings);
      if (r.status === "resolved") apply(r.target);
    }
  } else leftovers.push(...parsed.phrases);

  for (const a of parsed.ambiguous) choices.push({ text: a.text, options: a.options.map((o) => ({ label: o.label, query: { ...query, area: o.area, market: o.market } })) });
  const leftoverText = leftovers.filter((p) => !/^\d{5}$/.test(p)).join(" ").trim();
  if (leftoverText) query.text = leftoverText.slice(0, 100);
  const resolvedGeo = geo as SearchInterpretation["geo"];
  const geoScope = resolvedGeo && resolvedGeo.target.type === "census" ? await geoScopeFor(resolvedGeo.target) : null;
  return { parsed, query, geo: resolvedGeo, geoScope, choices, nearMeUnavailable: parsed.nearMe };
}
