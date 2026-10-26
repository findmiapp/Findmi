import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import {
  CATEGORY_DIMENSION_KIND,
  COMPAT_POLICY,
  OPPORTUNITY_TYPE_CATEGORY,
  asContext,
  choosePrimary,
  deriveFromLegacy,
  effectiveTopics,
  expandNarrowerTopicIds,
  isDurableFor,
  mergeClassified,
  v2Audience,
  v2Benefits,
  v2BusinessModels,
  v2EntryModes,
  v2PriceKind,
  v2Setting,
  type AssignedSource,
  type CategoryDimension,
  type Classified,
  type CompatDimension,
  type ContextProvenance,
  type DerivedTarget,
  type DimensionPolicy,
  type LegacyLink,
  type OwnProvenance,
  type TopicRef,
  type TopicSet,
  type V2CategoryRef,
} from "./compat-policy";
import { loadTaxonomyReference, type TaxonomyReference, type TermRef } from "./reference-server";
import type { Audience, Benefit, BusinessModel, EntryMode, PriceKind, Setting, TaxonomyEntityType, TermVocabulary, V2CategoryKind } from "./v2";
import type { LegacyKind } from "./v2-legacy";

// Taxonomy V2 — Pass 3B: batched classification reads (server-only).
//
// Entity → classification (loadClassifications) and classification → entity
// (findEntityIds), both answering by COMPAT_POLICY. The caller always brings
// the entity ids: visibility, publication state and geography are decided by
// the canonical queries that already exist, never here. Everything is batched
// by id (one query per table per chunk — never per entity), and nothing here
// reads the clock, hours, geography or classification_suggestions.
//
// Not wired into any live surface in Pass 3B.

export type ClassifiedEntity = TaxonomyEntityType | "opportunity";

export interface LoadOptions {
  client?: SupabaseClient;
  reference?: TaxonomyReference;
  /** Limit the reads to what these dimensions need (default: everything). */
  dimensions?: readonly CompatDimension[];
}

/** Event columns shared between V1 (read by the live Map) and V2. Read-only
 * here — see the note in compat-policy.ts before anything writes V2 values. */
export const SHARED_V1_EVENT_COLUMNS = ["events.benefits", "events.audience", "events.entry_modes"] as const;

export interface CategoryClassification {
  categories: Classified<V2CategoryRef>[];
  primaryCategory: Classified<V2CategoryRef> | null;
  topics: TopicSet;
}
export interface BusinessClassification extends CategoryClassification {
  businessModels: Classified<BusinessModel>[];
}
export interface LocationClassification extends CategoryClassification {
  /** Explicitly stored attribute values only (locations.attributes). */
  attributes: Record<string, unknown>;
}
export interface ProductClassification extends CategoryClassification {
  attributes: Record<string, unknown>;
  audience: Classified<Audience>[];
}
export interface EventClassification {
  domains: Classified<V2CategoryRef>[];
  primaryDomain: Classified<V2CategoryRef> | null;
  types: Classified<TermRef>[];
  primaryType: Classified<TermRef> | null;
  mechanics: Classified<TermRef>[];
  topics: TopicSet;
  /** Explicit values stored in the SHARED V1/V2 columns, V2 vocabulary only. */
  audience: Classified<Audience>[];
  entryModes: Classified<EntryMode>[];
  /** Only explicitly set Benefits — a Mechanic never creates one. */
  benefits: Classified<Benefit>[];
  setting: Classified<Setting> | null;
  price: { kind: Classified<PriceKind> | null; minCents: number | null; maxCents: number | null; currency: string | null };
  age: { min: number | null; max: number | null };
  /** Raw V1 state, untouched, for V1 surfaces and audits. */
  legacy: { categories: string[]; formats: string[]; isFree: boolean | null; familyFriendly: boolean | null };
}
export interface AppearanceClassification {
  /** The Appearance's OWN classification — never inherited. */
  own: {
    appearanceType: Classified<TermRef> | null;
    topics: Classified<TopicRef>[];
    benefits: Classified<Benefit>[];
  };
  /** Related entities' classification, explicitly contextual. null for a
   * standalone Appearance / an Appearance without a Brand. */
  context: {
    event: { eventId: string; domains: Classified<V2CategoryRef, ContextProvenance>[]; types: Classified<TermRef, ContextProvenance>[]; mechanics: Classified<TermRef, ContextProvenance>[]; topics: Classified<TopicRef, ContextProvenance>[] } | null;
    brand: { businessId: string; categories: Classified<V2CategoryRef, ContextProvenance>[]; topics: Classified<TopicRef, ContextProvenance>[] } | null;
  };
}
export interface OpportunityClassification {
  category: Classified<TermRef> | null;
}

export interface ClassificationMap {
  business: BusinessClassification;
  location: LocationClassification;
  event: EventClassification;
  product: ProductClassification;
  appearance: AppearanceClassification;
  opportunity: OpportunityClassification;
}

// ------------------------------------------------------------ batched reads

type Row = Record<string, unknown>;
export const ID_CHUNK = 200;
/** Upper bound for findEntityIds' candidate set. */
export const MAX_WITHIN = 5000;

async function selectIn(client: SupabaseClient, table: string, cols: string, col: string, ids: readonly string[], apply?: (q: any) => any): Promise<Row[]> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += ID_CHUNK) chunks.push(uniq.slice(i, i + ID_CHUNK));
  const pages = await Promise.all(
    chunks.map(async (c) => {
      let q = client.from(table).select(cols).in(col, c);
      if (apply) q = apply(q);
      const { data, error } = await q;
      if (error) throw new Error(`taxonomy classifications: ${table}: ${error.message}`);
      return (data ?? []) as unknown as Row[];
    })
  );
  return pages.flat();
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const group = (rows: readonly Row[], key: string) => {
  const out = new Map<string, Row[]>();
  for (const r of rows) out.set(str(r[key]), [...(out.get(str(r[key])) ?? []), r]);
  return out;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

interface Ctx {
  client: SupabaseClient;
  ref: TaxonomyReference;
  need: (d: CompatDimension) => boolean;
}

async function context(opts: LoadOptions): Promise<Ctx> {
  const client = opts.client ?? getAdminSupabase();
  if (!client) throw new Error("taxonomy classifications: service-role client unavailable");
  const ref = opts.reference ?? (await loadTaxonomyReference());
  const dims = opts.dimensions ? new Set(opts.dimensions) : null;
  return { client, ref, need: (d) => !dims || dims.has(d) };
}

/** classification_field_sources for column-stored values: entity → field → source. */
async function fieldSources(c: Ctx, entityType: string, ids: readonly string[], fields: readonly string[]): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (fields.length === 0) return out;
  const rows = await selectIn(c.client, "classification_field_sources", "entity_id, field, source", "entity_id", ids, (q) => q.eq("entity_type", entityType).in("field", [...fields]));
  for (const r of rows) {
    const m = out.get(str(r.entity_id)) ?? new Map<string, string>();
    m.set(str(r.field), str(r.source));
    out.set(str(r.entity_id), m);
  }
  return out;
}

/** V1 link rows → LegacyLink (V1 kind + slug from the categories row). */
function legacyLinks(c: Ctx, rows: readonly Row[], entityCol: string, kind: LegacyKind | "event_format", store: string): LegacyLink[] {
  const out: LegacyLink[] = [];
  for (const r of rows) {
    const cat = c.ref.v1Category(str(r.category_id));
    if (!cat || cat.kind !== kind) continue;
    out.push({ entityId: str(r[entityCol]), legacyKind: kind as LegacyKind, legacySlug: cat.slug, store });
  }
  return out;
}

function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
  return out;
}

/** Current V1 links → deterministic V2 targets, per entity. */
const derive = (c: Ctx, links: readonly LegacyLink[]): Map<string, DerivedTarget[]> =>
  groupBy(deriveFromLegacy(links, (k, s) => c.ref.mapping(k, s)), (t) => t.entityId);

// ------------------------------------------------------------ shared builders

function buildCategories(c: Ctx, dimension: CategoryDimension, derived: readonly DerivedTarget[], v2Rows: readonly Row[], store: string): { categories: Classified<V2CategoryRef>[]; primaryCategory: Classified<V2CategoryRef> | null } {
  const kind = CATEGORY_DIMENSION_KIND[dimension];
  const items: Classified<V2CategoryRef>[] = [];
  for (const t of derived) {
    if (t.dimension !== "category" || t.categoryKind !== kind) continue;
    const node = c.ref.categoryBySlug(kind, t.value);
    if (node) items.push({ value: node, provenance: [t.provenance] });
  }
  const explicitPrimary = new Set<string>();
  for (const r of v2Rows) {
    if (!isDurableFor(dimension, str(r.source))) continue;
    const node = c.ref.category(str(r.category_id));
    if (!node || node.kind !== kind) continue;
    items.push({ value: node, provenance: [{ kind: "assigned", source: str(r.source) as AssignedSource, store }] });
    if (r.is_primary === true) explicitPrimary.add(node.id);
  }
  const merged = pruneDerivedAncestors(mergeClassified(items, (n) => n.id));
  return { categories: merged, primaryCategory: choosePrimary(merged, explicitPrimary) as Classified<V2CategoryRef> | null };
}

/** A purely V1-derived ancestor is redundant when one of its descendants is
 * also effective (the tree already implies it) — the same rule Pass 2's
 * backfill applied. An explicitly assigned ancestor is kept. */
function pruneDerivedAncestors(items: Classified<V2CategoryRef>[]): Classified<V2CategoryRef>[] {
  const ancestorsOfOthers = new Set(items.flatMap((i) => i.value.ancestorIds));
  return items.filter((i) => !ancestorsOfOthers.has(i.value.id) || i.provenance.some((p) => p.kind === "assigned"));
}

function buildTerms(c: Ctx, dimension: "event_type" | "experience_mechanic", vocabulary: TermVocabulary, derived: readonly DerivedTarget[], v2Rows: readonly Row[], store: string): { items: Classified<TermRef>[]; explicitPrimary: Set<string> } {
  const items: Classified<TermRef>[] = [];
  for (const t of derived) {
    if (t.dimension !== dimension) continue;
    const term = c.ref.termBySlug(vocabulary, t.value);
    if (term) items.push({ value: term, provenance: [t.provenance] });
  }
  const explicitPrimary = new Set<string>();
  for (const r of v2Rows) {
    if (!isDurableFor(dimension, str(r.source))) continue;
    const term = c.ref.term(str(r.term_id));
    if (!term || term.vocabulary !== vocabulary) continue;
    items.push({ value: term, provenance: [{ kind: "assigned", source: str(r.source) as AssignedSource, store }] });
    if (r.is_primary === true) explicitPrimary.add(term.id);
  }
  return { items: mergeClassified(items, (t) => t.id), explicitPrimary };
}

function buildTopics(c: Ctx, entity: TaxonomyEntityType, derived: readonly DerivedTarget[], v2Rows: readonly Row[], store: string, categories: readonly Classified<V2CategoryRef>[]): TopicSet {
  const explicit: Classified<TopicRef>[] = [];
  for (const t of derived) {
    if (t.dimension !== "topic") continue;
    const topic = c.ref.topicBySlug(t.value);
    if (topic && c.ref.topicAppliesTo(topic.id, entity)) explicit.push({ value: topic, provenance: [t.provenance] });
  }
  for (const r of v2Rows) {
    if (!isDurableFor("topic", str(r.source))) continue;
    const topic = c.ref.topic(str(r.topic_id));
    if (topic && c.ref.topicAppliesTo(topic.id, entity)) explicit.push({ value: topic, provenance: [{ kind: "assigned", source: str(r.source) as AssignedSource, store }] });
  }
  const implied: Classified<TopicRef>[] = [];
  for (const cat of categories) {
    for (const { topicId, viaCategoryId } of c.ref.impliedTopics(cat.value.id)) {
      const topic = c.ref.topic(topicId);
      if (topic && c.ref.topicAppliesTo(topicId, entity)) implied.push({ value: topic, provenance: [{ kind: "implied", categoryId: cat.value.id, viaCategoryId }] });
    }
  }
  return { explicit: mergeClassified(explicit, (t) => t.id), implied: mergeClassified(implied, (t) => t.id) };
}

const assignedColumn = <T>(values: readonly T[], store: string, source: string | null): Classified<T>[] =>
  values.map((value) => ({ value, provenance: [{ kind: "assigned", source: (source ?? "unrecorded") as AssignedSource, store }] }));

const EMPTY_TOPICS: TopicSet = { explicit: [], implied: [] };

// ------------------------------------------------------------ per entity

async function loadBusinesses(c: Ctx, ids: readonly string[]): Promise<Map<string, BusinessClassification>> {
  const needCat = c.need("business_category") || c.need("topic");
  const [v1, v2, topics, rows, sources] = await Promise.all([
    needCat || c.need("business_model") ? selectIn(c.client, "business_categories", "business_id, category_id", "business_id", ids) : [],
    needCat ? selectIn(c.client, "business_category_assignments", "business_id, category_id, is_primary, source", "business_id", ids) : [],
    c.need("topic") ? selectIn(c.client, "business_topics", "business_id, topic_id, source", "business_id", ids) : [],
    c.need("business_model") ? selectIn(c.client, "businesses", "id, business_models", "id", ids) : [],
    c.need("business_model") ? fieldSources(c, "business", ids, ["business_models"]) : new Map<string, Map<string, string>>(),
  ]);
  const derived = derive(c, legacyLinks(c, v1, "business_id", "business", "business_categories"));
  const v2By = group(v2, "business_id"), topicsBy = group(topics, "business_id"), rowBy = group(rows, "id");
  const out = new Map<string, BusinessClassification>();
  for (const id of new Set(ids)) {
    const d = derived.get(id) ?? [];
    const cats = buildCategories(c, "business_category", d, v2By.get(id) ?? [], "business_category_assignments");
    const models: Classified<BusinessModel>[] = d.filter((t) => t.dimension === "business_model").flatMap((t) => v2BusinessModels([t.value]).map((value) => ({ value, provenance: [t.provenance] as OwnProvenance[] })));
    const colSource = sources.get(id)?.get("business_models") ?? null;
    if (isDurableFor("business_model", colSource)) models.push(...assignedColumn(v2BusinessModels(rowBy.get(id)?.[0]?.business_models), "businesses.business_models", colSource));
    out.set(id, { ...cats, topics: buildTopics(c, "business", d, topicsBy.get(id) ?? [], "business_topics", cats.categories), businessModels: mergeClassified(models, (m) => m) });
  }
  return out;
}

async function loadLocations(c: Ctx, ids: readonly string[]): Promise<Map<string, LocationClassification>> {
  const [rows, v2, topics] = await Promise.all([
    selectIn(c.client, "locations", c.need("attribute") ? "id, category_id, attributes" : "id, category_id", "id", ids),
    selectIn(c.client, "location_categories", "location_id, category_id, is_primary, source", "location_id", ids),
    c.need("topic") ? selectIn(c.client, "location_topics", "location_id, topic_id, source", "location_id", ids) : [],
  ]);
  const derived = derive(c, legacyLinks(c, rows.filter((r) => r.category_id).map((r) => ({ location_id: r.id, category_id: r.category_id })), "location_id", "location", "locations.category_id"));
  const v2By = group(v2, "location_id"), topicsBy = group(topics, "location_id"), rowBy = group(rows, "id");
  const out = new Map<string, LocationClassification>();
  for (const id of new Set(ids)) {
    const d = derived.get(id) ?? [];
    const cats = buildCategories(c, "location_category", d, v2By.get(id) ?? [], "location_categories");
    out.set(id, { ...cats, topics: buildTopics(c, "location", d, topicsBy.get(id) ?? [], "location_topics", cats.categories), attributes: obj(rowBy.get(id)?.[0]?.attributes) });
  }
  return out;
}

const EVENT_COLUMNS = "id, benefits, audience, entry_modes, setting, price_kind, price_min_cents, price_max_cents, currency, is_free, family_friendly, min_age, max_age";

async function loadEvents(c: Ctx, ids: readonly string[]): Promise<Map<string, EventClassification>> {
  const needTax = ["event_domain", "event_type", "experience_mechanic", "topic"].some((d) => c.need(d as CompatDimension));
  const needCols = ["audience", "entry_mode", "benefit", "setting", "price"].some((d) => c.need(d as CompatDimension));
  const [cats, fmts, eca, eta, ema, topics, rows] = await Promise.all([
    needTax ? selectIn(c.client, "event_categories", "event_id, category_id", "event_id", ids) : [],
    needTax ? selectIn(c.client, "event_formats", "event_id, category_id", "event_id", ids) : [],
    c.need("event_domain") || c.need("topic") ? selectIn(c.client, "event_category_assignments", "event_id, category_id, is_primary, source", "event_id", ids) : [],
    c.need("event_type") ? selectIn(c.client, "event_type_assignments", "event_id, term_id, is_primary, source", "event_id", ids) : [],
    c.need("experience_mechanic") ? selectIn(c.client, "event_mechanic_assignments", "event_id, term_id, source", "event_id", ids) : [],
    c.need("topic") ? selectIn(c.client, "event_topics", "event_id, topic_id, source", "event_id", ids) : [],
    needCols ? selectIn(c.client, "events", EVENT_COLUMNS, "id", ids) : [],
  ]);
  const links = [...legacyLinks(c, cats, "event_id", "event", "event_categories"), ...legacyLinks(c, fmts, "event_id", "event_format", "event_formats")];
  const derived = derive(c, links);
  const linksBy = groupBy(links, (l) => l.entityId);
  const ecaBy = group(eca, "event_id"), etaBy = group(eta, "event_id"), emaBy = group(ema, "event_id"), topicsBy = group(topics, "event_id"), rowBy = group(rows, "id");
  const out = new Map<string, EventClassification>();
  for (const id of new Set(ids)) {
    const d = derived.get(id) ?? [];
    const dom = buildCategories(c, "event_domain", d, ecaBy.get(id) ?? [], "event_category_assignments");
    const types = buildTerms(c, "event_type", "event_type", d, etaBy.get(id) ?? [], "event_type_assignments");
    const mechanics = buildTerms(c, "experience_mechanic", "experience_mechanic", d, emaBy.get(id) ?? [], "event_mechanic_assignments");
    const row = rowBy.get(id)?.[0] ?? {};
    const own = linksBy.get(id) ?? [];

    // Price: V2 price_kind first; otherwise V1 is_free / the V1-only
    // 'free_admission' Benefit. Never inferred from anything else.
    const priceItems: Classified<PriceKind>[] = [];
    const v2Kind = v2PriceKind(row.price_kind);
    if (v2Kind) priceItems.push(...assignedColumn([v2Kind], "events.price_kind", null));
    else {
      if (row.is_free === true) priceItems.push({ value: "free", provenance: [{ kind: "legacy", store: "events.is_free", legacy: "true" }] });
      if (row.is_free === false) priceItems.push({ value: "paid", provenance: [{ kind: "legacy", store: "events.is_free", legacy: "false" }] });
      if (Array.isArray(row.benefits) && row.benefits.includes("free_admission")) priceItems.push({ value: "free", provenance: [{ kind: "legacy", store: "events.benefits", legacy: "free_admission" }] });
    }
    const prices = mergeClassified(priceItems, (p) => p);
    const setting = v2Setting(row.setting);

    out.set(id, {
      domains: dom.categories,
      primaryDomain: dom.primaryCategory,
      types: types.items,
      primaryType: choosePrimary(types.items, types.explicitPrimary) as Classified<TermRef> | null,
      mechanics: mechanics.items,
      topics: c.need("topic") ? buildTopics(c, "event", d, topicsBy.get(id) ?? [], "event_topics", dom.categories) : EMPTY_TOPICS,
      audience: assignedColumn(v2Audience(row.audience), "events.audience", null),
      entryModes: assignedColumn(v2EntryModes(row.entry_modes), "events.entry_modes", null),
      benefits: assignedColumn(v2Benefits(row.benefits), "events.benefits", null),
      setting: setting ? assignedColumn([setting], "events.setting", null)[0] : null,
      // Several conflicting V1 signals (free AND paid) give no Price.
      price: { kind: prices.length === 1 ? prices[0] : null, minCents: num(row.price_min_cents), maxCents: num(row.price_max_cents), currency: typeof row.currency === "string" ? row.currency : null },
      age: { min: num(row.min_age), max: num(row.max_age) },
      legacy: {
        categories: own.filter((l) => l.legacyKind === "event").map((l) => l.legacySlug),
        formats: own.filter((l) => l.legacyKind === "event_format").map((l) => l.legacySlug),
        isFree: bool(row.is_free),
        familyFriendly: bool(row.family_friendly),
      },
    });
  }
  return out;
}

async function loadProducts(c: Ctx, ids: readonly string[]): Promise<Map<string, ProductClassification>> {
  const [rows, v1, v2, topics] = await Promise.all([
    selectIn(c.client, "products", "id, product_type, attributes, audience", "id", ids),
    selectIn(c.client, "product_categories", "product_id, category_id", "product_id", ids),
    selectIn(c.client, "product_category_assignments", "product_id, category_id, is_primary, source", "product_id", ids),
    c.need("topic") ? selectIn(c.client, "product_topics", "product_id, topic_id, source", "product_id", ids) : [],
  ]);
  // Services are not Products: they get no V2 Product classification at all.
  const products = new Map(rows.filter((r) => r.product_type !== "service").map((r) => [str(r.id), r]));
  const derived = derive(c, legacyLinks(c, v1.filter((r) => products.has(str(r.product_id))), "product_id", "product", "product_categories"));
  const v2By = group(v2, "product_id"), topicsBy = group(topics, "product_id");
  const out = new Map<string, ProductClassification>();
  for (const [id, row] of products) {
    const d = derived.get(id) ?? [];
    const cats = buildCategories(c, "product_category", d, v2By.get(id) ?? [], "product_category_assignments");
    out.set(id, {
      ...cats,
      topics: buildTopics(c, "product", d, topicsBy.get(id) ?? [], "product_topics", cats.categories),
      attributes: obj(row.attributes),
      audience: assignedColumn(v2Audience(row.audience), "products.audience", null),
    });
  }
  return out;
}

async function loadAppearances(c: Ctx, ids: readonly string[], withContext: boolean): Promise<Map<string, AppearanceClassification>> {
  const [rows, topics, sources] = await Promise.all([
    selectIn(c.client, "appearances", "id, event_id, business_id, appearance_type_id, benefits", "id", ids),
    selectIn(c.client, "appearance_topics", "appearance_id, topic_id, source", "appearance_id", ids),
    fieldSources(c, "appearance", ids, ["appearance_type", "benefits"]),
  ]);
  const eventIds = withContext ? rows.map((r) => str(r.event_id)).filter(Boolean) : [];
  const brandIds = withContext ? rows.map((r) => str(r.business_id)).filter(Boolean) : [];
  const ctxDims: CompatDimension[] = ["event_domain", "event_type", "experience_mechanic", "topic", "business_category"];
  const [events, brands] = await Promise.all([
    eventIds.length ? loadEvents({ ...c, need: (d) => ctxDims.includes(d) }, eventIds) : new Map<string, EventClassification>(),
    brandIds.length ? loadBusinesses({ ...c, need: (d) => ctxDims.includes(d) }, brandIds) : new Map<string, BusinessClassification>(),
  ]);
  const topicsBy = group(topics, "appearance_id");
  const out = new Map<string, AppearanceClassification>();
  for (const r of rows) {
    const id = str(r.id);
    const src = sources.get(id);
    const typeTerm = c.ref.term(str(r.appearance_type_id));
    const typeSource = src?.get("appearance_type") ?? null;
    const ownTopics: Classified<TopicRef>[] = [];
    for (const t of topicsBy.get(id) ?? []) {
      if (!isDurableFor("topic", str(t.source))) continue;
      const topic = c.ref.topic(str(t.topic_id));
      if (topic && c.ref.topicAppliesTo(topic.id, "appearance")) ownTopics.push({ value: topic, provenance: [{ kind: "assigned", source: str(t.source) as AssignedSource, store: "appearance_topics" }] });
    }
    const ev = r.event_id ? events.get(str(r.event_id)) : undefined;
    const brand = r.business_id ? brands.get(str(r.business_id)) : undefined;
    out.set(id, {
      own: {
        appearanceType: typeTerm && typeTerm.vocabulary === "appearance_type" && isDurableFor("appearance_type", typeSource) ? assignedColumn([typeTerm], "appearances.appearance_type_id", typeSource)[0] : null,
        topics: mergeClassified(ownTopics, (t) => t.id),
        benefits: isDurableFor("benefit", src?.get("benefits") ?? null) ? assignedColumn(v2Benefits(r.benefits), "appearances.benefits", src?.get("benefits") ?? null) : [],
      },
      context: {
        event: ev
          ? { eventId: str(r.event_id), domains: asContext(ev.domains, "event", str(r.event_id)), types: asContext(ev.types, "event", str(r.event_id)), mechanics: asContext(ev.mechanics, "event", str(r.event_id)), topics: asContext(effectiveTopics(ev.topics), "event", str(r.event_id)) }
          : null,
        brand: brand ? { businessId: str(r.business_id), categories: asContext(brand.categories, "brand", str(r.business_id)), topics: asContext(effectiveTopics(brand.topics), "brand", str(r.business_id)) } : null,
      },
    });
  }
  return out;
}

async function loadOpportunities(c: Ctx, ids: readonly string[]): Promise<Map<string, OpportunityClassification>> {
  const [rows, sources] = await Promise.all([
    selectIn(c.client, "opportunity_listings", "id, opportunity_type, opportunity_category_id", "id", ids),
    fieldSources(c, "opportunity_listing", ids, ["opportunity_category"]),
  ]);
  const out = new Map<string, OpportunityClassification>();
  for (const r of rows) {
    const id = str(r.id);
    const source = sources.get(id)?.get("opportunity_category") ?? null;
    const stored = c.ref.term(str(r.opportunity_category_id));
    let category: Classified<TermRef> | null = null;
    // A durable V2 Category wins; a migration-written one is re-derived from
    // the CURRENT opportunity_type (it was only ever a copy of it).
    if (stored && stored.vocabulary === "opportunity_category" && isDurableFor("opportunity_category", source)) category = assignedColumn([stored], "opportunity_listings.opportunity_category_id", source)[0];
    else {
      const slug = OPPORTUNITY_TYPE_CATEGORY[str(r.opportunity_type)];
      const term = slug ? c.ref.termBySlug("opportunity_category", slug) : undefined;
      if (term) category = { value: term, provenance: [{ kind: "legacy", store: "opportunity_listings.opportunity_type", legacy: str(r.opportunity_type) }] };
    }
    out.set(id, { category });
  }
  return out;
}

// ------------------------------------------------------------ public API

/** Classification for a batch of entity ids (entity → classification).
 * Ids come from the caller's canonical, visibility-checked query. Services
 * are absent from the product result. */
export async function loadClassifications<E extends ClassifiedEntity>(entity: E, ids: readonly string[], opts: LoadOptions & { context?: boolean } = {}): Promise<Map<string, ClassificationMap[E]>> {
  if (ids.length === 0) return new Map();
  const c = await context(opts);
  const run: Record<ClassifiedEntity, () => Promise<Map<string, unknown>>> = {
    business: () => loadBusinesses(c, ids),
    location: () => loadLocations(c, ids),
    event: () => loadEvents(c, ids),
    product: () => loadProducts(c, ids),
    appearance: () => loadAppearances(c, ids, opts.context !== false),
    opportunity: () => loadOpportunities(c, ids),
  };
  return (await run[entity]()) as Map<string, ClassificationMap[E]>;
}

/** Which dimensions each entity can be queried by. */
export const QUERYABLE: Readonly<Record<ClassifiedEntity, readonly CompatDimension[]>> = {
  business: ["business_category", "topic", "business_model"],
  location: ["location_category", "topic", "attribute"],
  event: ["event_domain", "event_type", "experience_mechanic", "topic", "benefit", "setting", "price", "audience", "entry_mode"],
  product: ["product_category", "topic", "attribute", "audience"],
  appearance: ["appearance_type", "topic", "benefit"],
  opportunity: ["opportunity_category"],
};

/** The effective policy for an entity's dimension. Product Audience is a
 * V2-only column (not the shared Event column), so it is not V1-only. */
export function policyFor(entity: ClassifiedEntity, dimension: CompatDimension): DimensionPolicy {
  if (entity === "product" && dimension === "audience") return { mode: "v2_only", v1Backed: false };
  return COMPAT_POLICY[dimension];
}

export interface FindSpec {
  entity: ClassifiedEntity;
  dimension: CompatDimension;
  /** Slugs (Categories, terms, Topics) or codes (models, benefits, …). */
  values: readonly string[];
  match?: "any" | "all";
  /** REQUIRED: the candidate ids the caller already established through
   * canonical visibility / geography. The result is always a subset. */
  within: readonly string[];
  /** Category dimensions: a Category also matches its V2 descendants
   * (default true). */
  descendants?: boolean;
  /** Topics: effective (explicit + implied, default) or explicit only. */
  topicScope?: "effective" | "explicit";
  /** Topics: query-time broader-Topic expansion (default false). */
  includeNarrower?: boolean;
}

/** Classification → entities: the subset of `within` that matches. */
export async function findEntityIds(spec: FindSpec, opts: Omit<LoadOptions, "dimensions"> = {}): Promise<Set<string>> {
  if (!Array.isArray(spec.within)) throw new Error("findEntityIds: `within` (the caller's candidate ids) is required");
  if (spec.within.length > MAX_WITHIN) throw new Error(`findEntityIds: \`within\` is limited to ${MAX_WITHIN} ids`);
  if (!QUERYABLE[spec.entity].includes(spec.dimension)) throw new Error(`findEntityIds: ${spec.entity} has no ${spec.dimension}`);
  if (policyFor(spec.entity, spec.dimension).mode === "v1_only") throw new Error(`findEntityIds: ${spec.dimension} stays V1 for now (shared V1/V2 column)`);
  const out = new Set<string>();
  if (spec.within.length === 0 || spec.values.length === 0) return out;

  const ref = opts.reference ?? (await loadTaxonomyReference());
  const loaded = await loadClassifications(spec.entity, spec.within, { ...opts, reference: ref, dimensions: [spec.dimension], context: false });
  const wanted = valueMatchers(spec, ref);
  const mode = spec.match ?? "any";
  for (const [id, cls] of loaded) {
    const have = valuesOf(spec, cls);
    const hits = wanted.map((m) => have.some(m));
    if (mode === "all" ? hits.every(Boolean) : hits.some(Boolean)) out.add(id);
  }
  return out;
}

/** One predicate per requested value; a predicate tests one entity value
 * (an id for Categories/terms/Topics, a code otherwise). */
function valueMatchers(spec: FindSpec, ref: TaxonomyReference): ((have: string) => boolean)[] {
  const dim = spec.dimension;
  if (dim in CATEGORY_DIMENSION_KIND) {
    const kind = CATEGORY_DIMENSION_KIND[dim as CategoryDimension] as V2CategoryKind;
    return spec.values.map((slug) => {
      const node = ref.categoryBySlug(kind, slug);
      if (!node) return () => false;
      const ids = new Set(spec.descendants === false ? [node.id] : ref.withDescendants(node.id));
      return (have) => ids.has(have);
    });
  }
  if (dim === "event_type" || dim === "experience_mechanic" || dim === "appearance_type" || dim === "opportunity_category") {
    return spec.values.map((slug) => {
      const term = ref.termBySlug(dim, slug);
      return (have) => Boolean(term) && have === term!.id;
    });
  }
  if (dim === "topic") {
    const all = ref.topics();
    return spec.values.map((slug) => {
      const topic = ref.topicBySlug(slug);
      if (!topic) return () => false;
      const ids = spec.includeNarrower ? expandNarrowerTopicIds([topic.id], all) : new Set([topic.id]);
      return (have) => ids.has(have);
    });
  }
  if (dim === "attribute") {
    // "key" (true / non-empty) or "key:value" (equal / included).
    return spec.values.map((v) => (have) => have === v);
  }
  return spec.values.map((v) => (have) => have === v);
}

/** The entity's effective values for the spec's dimension, as match keys. */
function valuesOf(spec: FindSpec, cls: unknown): string[] {
  const ids = (xs: readonly Classified<{ id: string }, OwnProvenance | ContextProvenance>[]) => xs.map((x) => x.value.id);
  const codes = <T extends string>(xs: readonly Classified<T>[]) => xs.map((x) => x.value);
  const topics = (t: TopicSet) => ids(spec.topicScope === "explicit" ? t.explicit : effectiveTopics(t));
  const attrs = (a: Record<string, unknown>) =>
    Object.entries(a).flatMap(([k, v]) => [
      ...(v === true || (Array.isArray(v) && v.length) || (typeof v === "string" && v) || typeof v === "number" ? [k] : []),
      ...(Array.isArray(v) ? v.map((x) => `${k}:${String(x)}`) : v != null && typeof v !== "object" ? [`${k}:${String(v)}`] : []),
    ]);
  switch (spec.entity) {
    case "business": {
      const b = cls as BusinessClassification;
      return spec.dimension === "business_category" ? ids(b.categories) : spec.dimension === "topic" ? topics(b.topics) : codes(b.businessModels);
    }
    case "location": {
      const l = cls as LocationClassification;
      return spec.dimension === "location_category" ? ids(l.categories) : spec.dimension === "topic" ? topics(l.topics) : attrs(l.attributes);
    }
    case "product": {
      const p = cls as ProductClassification;
      return spec.dimension === "product_category" ? ids(p.categories) : spec.dimension === "topic" ? topics(p.topics) : spec.dimension === "audience" ? codes(p.audience) : attrs(p.attributes);
    }
    case "event": {
      const e = cls as EventClassification;
      if (spec.dimension === "event_domain") return ids(e.domains);
      if (spec.dimension === "event_type") return ids(e.types);
      if (spec.dimension === "experience_mechanic") return ids(e.mechanics);
      if (spec.dimension === "topic") return topics(e.topics);
      if (spec.dimension === "benefit") return codes(e.benefits);
      if (spec.dimension === "setting") return e.setting ? [e.setting.value] : [];
      if (spec.dimension === "price") return e.price.kind ? [e.price.kind.value] : [];
      return [];
    }
    case "appearance": {
      // Own classification only — Event / Brand context never matches here.
      const a = cls as AppearanceClassification;
      if (spec.dimension === "appearance_type") return a.own.appearanceType ? [a.own.appearanceType.value.id] : [];
      if (spec.dimension === "topic") return ids(a.own.topics);
      return codes(a.own.benefits);
    }
    case "opportunity": {
      const o = cls as OpportunityClassification;
      return o.category ? [o.category.value.id] : [];
    }
  }
}
