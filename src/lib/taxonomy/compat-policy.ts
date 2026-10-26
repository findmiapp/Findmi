// Taxonomy V2 — Pass 3B: the V1/V2 compatibility policy (pure; no I/O).
//
// One place decides how every classification dimension is answered while V1
// is still the live, writable classification:
//
//   union_live             effective = deterministic targets of the entity's
//                          CURRENT V1 links ∪ durable (non-migration) V2
//                          assignments. Pass 2's source='migration' rows are a
//                          one-time snapshot of V1 and are re-derived here,
//                          never read as truth — so a V1 edit after the
//                          migration supersedes them (removed values vanish,
//                          new values appear).
//   v2_first_v1_fallback   a durable V2 value wins; otherwise the current V1
//                          field is interpreted (Opportunity Category from
//                          opportunity_type; Price from is_free).
//   v2_only                only explicitly stored V2 values; no V1 equivalent.
//   v1_only                public behavior stays V1 (shared columns whose
//                          vocabularies diverge — see below); the layer
//                          exposes stored values for inspection but refuses
//                          reverse lookup.
//
// Never a source of truth here: classification_suggestions (not read by any
// compatibility module), review_required mapping targets, intentionally
// unmapped rows, retired mappings, and Mechanic → Benefit hints.
//
// SHARED EVENT COLUMNS — events.benefits, events.audience, events.entry_modes
// are read by the live V1 Map AND are the V2 storage for Benefit / Audience /
// Entry Mode. V1's normalizers (src/lib/discovery/attributes.ts) drop V2-only
// values (registration, teens, 18_plus, creators, complimentary_services), and
// V1 counts every enabled RSVP action — including "register" CTAs — as RSVP,
// while V2 keeps RSVP and Registration distinct. Nothing may write V2 values
// into these columns until that is reconciled; this layer only reads them.

import {
  AUDIENCES,
  BENEFITS,
  BUSINESS_MODELS,
  ENTRY_MODES,
  PRICE_KINDS,
  SETTINGS,
  type Audience,
  type Benefit,
  type BusinessModel,
  type EntryMode,
  type PriceKind,
  type ProvenanceSource,
  type Setting,
  type V2CategoryKind,
} from "./v2";
import type { LegacyKind, MappingTarget, TargetDimension } from "./v2-legacy";

// ------------------------------------------------------------ dimensions + policy

export const COMPAT_DIMENSIONS = [
  "business_category", "location_category", "event_domain", "product_category",
  "event_type", "experience_mechanic", "topic", "business_model",
  "appearance_type", "opportunity_category",
  "audience", "entry_mode", "benefit", "setting", "price", "attribute",
] as const;
export type CompatDimension = (typeof COMPAT_DIMENSIONS)[number];

export type CompatMode = "union_live" | "v2_first_v1_fallback" | "v2_only" | "v1_only";

export interface DimensionPolicy {
  mode: CompatMode;
  /** True when V1 data can deterministically re-derive the dimension — then
   * source='migration' values are never durable. */
  v1Backed: boolean;
}

export const COMPAT_POLICY: Record<CompatDimension, DimensionPolicy> = {
  business_category: { mode: "union_live", v1Backed: true },
  location_category: { mode: "union_live", v1Backed: true },
  event_domain: { mode: "union_live", v1Backed: true },
  product_category: { mode: "union_live", v1Backed: true },
  event_type: { mode: "union_live", v1Backed: true },
  experience_mechanic: { mode: "union_live", v1Backed: true },
  topic: { mode: "union_live", v1Backed: true },
  business_model: { mode: "union_live", v1Backed: true },
  opportunity_category: { mode: "v2_first_v1_fallback", v1Backed: true },
  price: { mode: "v2_first_v1_fallback", v1Backed: true },
  appearance_type: { mode: "v2_only", v1Backed: false },
  benefit: { mode: "v2_only", v1Backed: false },
  setting: { mode: "v2_only", v1Backed: false },
  attribute: { mode: "v2_only", v1Backed: false },
  audience: { mode: "v1_only", v1Backed: false },
  entry_mode: { mode: "v1_only", v1Backed: false },
};

/** The V2 Category tree each category dimension reads. */
export type CategoryDimension = "business_category" | "location_category" | "event_domain" | "product_category";
export const CATEGORY_DIMENSION_KIND: Readonly<Record<CategoryDimension, V2CategoryKind>> = {
  business_category: "business",
  location_category: "location",
  event_domain: "event",
  product_category: "product",
};

/** Assignment sources that are confirmed classifications. 'migration' is
 * excluded: it is re-derived from current V1. 'suggestion' is excluded too:
 * an assignment row (or field source) marked 'suggestion' carries no
 * persisted proof that anyone reviewed it — no link to a
 * classification_suggestions row, no reviewed_at / reviewed_by — so it
 * can't be told apart from an unreviewed idea. Until an acceptance
 * workflow records that confirmation verifiably, such a value never
 * counts (open suggestions live only in classification_suggestions, which
 * this layer never reads). */
export const DURABLE_SOURCES = ["admin", "owner", "importer"] as const;
export type DurableSource = (typeof DURABLE_SOURCES)[number];

/** Whether a stored V2 value with this source counts for this dimension. A
 * missing source (a column with no classification_field_sources row) counts —
 * only migration-written values are known to be V1 snapshots. */
export function isDurableFor(dimension: CompatDimension, source: string | null | undefined): boolean {
  if (source === "migration") return !COMPAT_POLICY[dimension].v1Backed;
  if (source == null) return true;
  return (DURABLE_SOURCES as readonly string[]).includes(source);
}

// ------------------------------------------------------------ provenance

/** A confirmed V2 value — an assignment row or an explicitly stored column. */
export interface AssignedProvenance {
  kind: "assigned";
  source: ProvenanceSource | "unrecorded";
  /** Table or column it was read from, e.g. "event_type_assignments" or
   * "events.setting". */
  store: string;
}
export type AssignedSource = AssignedProvenance["source"];
/** Deterministically derived from CURRENT V1 state. */
export interface LegacyProvenance {
  kind: "legacy";
  /** The V1 relationship or field, e.g. "event_formats" or "events.is_free". */
  store: string;
  legacyKind?: LegacyKind;
  legacy: string;
}
/** A Topic implied by a confirmed (effective) Category via category_topics. */
export interface ImpliedProvenance {
  kind: "implied";
  categoryId: string;
  /** The Category the implication was declared on (the effective Category
   * itself or one of its V2 ancestors). */
  viaCategoryId: string;
}
/** Classification of a RELATED entity (an Appearance's Event or Brand) —
 * never the entity's own. */
export interface ContextProvenance {
  kind: "context";
  from: "event" | "brand";
  entityId: string;
  provenance: OwnProvenance[];
}
export type OwnProvenance = AssignedProvenance | LegacyProvenance | ImpliedProvenance;
export type Provenance = OwnProvenance | ContextProvenance;

/** One effective value, listed once, with every reason it applies. */
export interface Classified<T, P extends Provenance = OwnProvenance> {
  value: T;
  provenance: P[];
}

const provKey = (p: Provenance): string => JSON.stringify(p);

/** Collapses repeated values (by key) into one entry whose provenance is the
 * union of every reason. Order: first appearance of each value. */
export function mergeClassified<T, P extends Provenance>(items: readonly Classified<T, P>[], keyOf: (v: T) => string): Classified<T, P>[] {
  const out = new Map<string, Classified<T, P>>();
  for (const item of items) {
    const k = keyOf(item.value);
    const cur = out.get(k);
    if (!cur) {
      out.set(k, { value: item.value, provenance: dedupeProvenance(item.provenance) });
      continue;
    }
    cur.provenance = dedupeProvenance([...cur.provenance, ...item.provenance]);
  }
  return [...out.values()];
}

function dedupeProvenance<P extends Provenance>(ps: readonly P[]): P[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(provKey(p)) ? false : (seen.add(provKey(p)), true)));
}

/** Re-labels a related entity's classification as context. */
export function asContext<T>(items: readonly Classified<T>[], from: "event" | "brand", entityId: string): Classified<T, ContextProvenance>[] {
  return items.map((i) => ({ value: i.value, provenance: [{ kind: "context", from, entityId, provenance: i.provenance }] }));
}

export const isOwnProvenance = (p: Provenance): p is OwnProvenance => p.kind !== "context";

// ------------------------------------------------------------ legacy derivation

/** A stored mapping row (taxonomy_legacy_mappings, legacy_source 'category'). */
export interface LegacyMappingRow {
  legacyKind: LegacyKind;
  legacySlug: string;
  targets: MappingTarget[];
  mappingConfidence: "deterministic" | "review_required" | "intentionally_unmapped" | null;
  status: "draft" | "active" | "retired";
}

/** The targets a mapping row proves. Only DETERMINISTIC targets count —
 * review_required targets are suggestions at most, an intentionally
 * unmapped row has none, and a retired row proves nothing. A row whose
 * overall confidence is review_required can still carry deterministic
 * targets (e.g. V1 "Art & Exhibitions" proves Domain Arts & Culture but not
 * Event Type Exhibition); those, exactly as Pass 2 reviewed them, count. */
export function deterministicTargets(row: LegacyMappingRow | undefined): MappingTarget[] {
  if (!row || row.status === "retired" || row.mappingConfidence === "intentionally_unmapped") return [];
  return row.targets.filter((t) => t.confidence === "deterministic");
}

/** A V1 relationship of one entity: a link row (business_categories,
 * event_categories, event_formats, product_categories) or
 * locations.category_id. */
export interface LegacyLink {
  entityId: string;
  legacyKind: LegacyKind;
  legacySlug: string;
  store: string;
}

export interface DerivedTarget {
  entityId: string;
  dimension: TargetDimension;
  value: string;
  /** For category targets: the V2 tree it belongs to. */
  categoryKind: V2CategoryKind;
  provenance: LegacyProvenance;
}

export const categoryKindOfLegacy = (k: LegacyKind): V2CategoryKind => (k === "event_format" ? "event" : k);

/** Current V1 links → the deterministic V2 targets they prove. */
export function deriveFromLegacy(links: readonly LegacyLink[], mappingOf: (kind: LegacyKind, slug: string) => LegacyMappingRow | undefined): DerivedTarget[] {
  const out: DerivedTarget[] = [];
  for (const l of links) {
    for (const t of deterministicTargets(mappingOf(l.legacyKind, l.legacySlug))) {
      out.push({
        entityId: l.entityId,
        dimension: t.dimension,
        value: t.value,
        categoryKind: categoryKindOfLegacy(l.legacyKind),
        provenance: { kind: "legacy", store: l.store, legacyKind: l.legacyKind, legacy: l.legacySlug },
      });
    }
  }
  return out;
}

/** V1 opportunity_type → V2 Opportunity Category (term slug). Mirrors the
 * Pass 2 migration's step 7i; 'other' has none. */
export const OPPORTUNITY_TYPE_CATEGORY: Readonly<Record<string, string>> = {
  activation: "activation-sampling",
  sampling_demo: "activation-sampling",
  vending: "retail-vending",
  sponsorship: "sponsorship",
  content: "content-media",
  partnership: "partnerships",
};

// ------------------------------------------------------------ categories

/** A V2 Category as the compatibility layer sees it. Status always travels
 * with it: staged rows are part of the V2 tree but are not public. */
export interface V2CategoryRef {
  id: string;
  kind: V2CategoryKind;
  slug: string;
  /** Internal label (V2 display name, else the row's name). Never render it
   * publicly — use publicCategoryLabel(). */
  label: string;
  status: "active" | "staged";
  depth: number;
  /** V2 tree parent (category_tree_v2) — never V1 parent_id. */
  parentId: string | null;
  /** V2 ancestors, nearest first. */
  ancestorIds: readonly string[];
}

/** The only label a public surface may show: null for a staged Category
 * (not activated — it must not appear in UI, filters, SEO or search). */
export function publicCategoryLabel(c: Pick<V2CategoryRef, "status" | "label"> | null | undefined): string | null {
  return c && c.status === "active" ? c.label : null;
}

/** Primary Category: an explicit, durable V2 primary that is also effective;
 * otherwise the single effective value; otherwise none — never an arbitrary
 * pick among several. */
export function choosePrimary<T extends { id: string }>(effective: readonly Classified<T, Provenance>[], explicitPrimaryIds: ReadonlySet<string>): Classified<T, Provenance> | null {
  const explicit = effective.filter((c) => explicitPrimaryIds.has(c.value.id));
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;
  return effective.length === 1 ? effective[0] : null;
}

// ------------------------------------------------------------ topics

export interface TopicRef {
  id: string;
  slug: string;
  name: string;
  kind: "subject" | "occasion";
  broaderTopicId: string | null;
}

export interface TopicSet {
  explicit: Classified<TopicRef>[];
  implied: Classified<TopicRef>[];
}

/** Explicit ∪ implied, one entry per Topic, keeping every provenance (so a
 * Topic both assigned and implied shows both reasons). */
export function effectiveTopics(t: TopicSet): Classified<TopicRef>[] {
  return mergeClassified([...t.explicit, ...t.implied], (x) => x.id);
}

/** Query-time broader-Topic expansion: the requested Topics plus every
 * narrower Topic beneath them (asking for "Food" also matches "Coffee" when
 * Coffee's broader Topic is Food). Never writes or changes an entity's
 * classification. */
export function expandNarrowerTopicIds(topicIds: readonly string[], all: readonly Pick<TopicRef, "id" | "broaderTopicId">[]): Set<string> {
  const out = new Set(topicIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of all) if (t.broaderTopicId && out.has(t.broaderTopicId) && !out.has(t.id)) (out.add(t.id), (grew = true));
  }
  return out;
}

// ------------------------------------------------------------ explicit value filters

const pick = <T extends string>(allowed: readonly T[], raw: unknown): T[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((v): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v)))] : [];

/** V2 vocabularies for explicitly stored values (read-only — the V1
 * normalizers in discovery/attributes.ts stay as they are). 'free_admission'
 * is a V1 Benefit; V2 models it as Price 'free', so it is not a V2 Benefit. */
export const v2Audience = (raw: unknown): Audience[] => pick(AUDIENCES, raw);
export const v2EntryModes = (raw: unknown): EntryMode[] => pick(ENTRY_MODES, raw);
export const v2Benefits = (raw: unknown): Benefit[] => pick(BENEFITS, raw);
export const v2BusinessModels = (raw: unknown): BusinessModel[] => pick(BUSINESS_MODELS, raw);
export const v2Setting = (raw: unknown): Setting | null => (typeof raw === "string" && (SETTINGS as readonly string[]).includes(raw) ? (raw as Setting) : null);
export const v2PriceKind = (raw: unknown): PriceKind | null => (typeof raw === "string" && (PRICE_KINDS as readonly string[]).includes(raw) ? (raw as PriceKind) : null);
