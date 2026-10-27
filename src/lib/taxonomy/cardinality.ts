// Taxonomy V2 — Pass 4A: the classification cardinality contract (pure; no
// I/O). One declaration of which dimensions each entity type has, decided
// SEMANTICALLY (not from what the SQL tables happen to allow), shared by the
// Admin write library now and by importer / owner workflows later.
//
//   single     one canonical value per entity (the vocabulary itself can
//              hold any number of options)
//   multi      any number of values
//   required   a single value that may be replaced but never cleared
//   primary    a multi dimension where one value is designated primary
//              whenever the set is non-empty
//   write      "admin"     Pass 4 Admin may write it
//              "live_v1"   stored in a column the live V1 Map reads — no
//                          Pass 4 writes (Discovery Details stays its editor)
//              "deferred"  not part of the classification foundation yet
//
// Curation (see compat-policy.ts): for dimensions the compatibility layer
// re-derives from V1, the dimension's `curationField` — a
// classification_field_sources.field value — marks an entity whose explicit
// V2 values have become authoritative for that dimension.

import type { CompatDimension } from "./compat-policy";
import type { ClassificationDimension, V2CategoryKind } from "./v2";

export const CLASSIFIED_ENTITIES = ["business", "location", "event", "product", "appearance", "opportunity"] as const;
export type ClassifiedEntityType = (typeof CLASSIFIED_ENTITIES)[number];

export type Cardinality = "single" | "multi";
export type WriteMode = "admin" | "live_v1" | "deferred";

export interface DimensionRule {
  entity: ClassifiedEntityType;
  dimension: ClassificationDimension;
  cardinality: Cardinality;
  /** single only: replace allowed, clear not. */
  required: boolean;
  /** multi only: one value is designated primary whenever non-empty. */
  primary: boolean;
  write: WriteMode;
  /** The compatibility-layer dimension that answers it. */
  compat: CompatDimension;
  /** The curation marker (classification_field_sources.field) when this
   * entity's dimension is inferred from V1 and so can be curated; null when
   * its explicit values already are the whole answer. */
  curationField: string | null;
}

/** The curation marker field for each dimension the compatibility layer
 * re-derives from V1 (COMPAT_POLICY mode union_live). Dimensions without V1
 * inference need no marker: their explicit values are already the whole
 * answer. business_models is also the provenance field of the
 * businesses.business_models column — that column is written as a whole set,
 * so an explicit write there is always a curated write. */
export const CURATION_FIELD: Partial<Record<CompatDimension, string>> = {
  business_category: "categories",
  location_category: "categories",
  event_domain: "categories",
  product_category: "categories",
  event_type: "event_type",
  experience_mechanic: "experience_mechanics",
  topic: "topics",
  business_model: "business_models",
};

const rule = (entity: ClassifiedEntityType, dimension: ClassificationDimension, cardinality: Cardinality, compat: CompatDimension, o: { required?: boolean; primary?: boolean; write?: WriteMode } = {}): DimensionRule => ({
  entity,
  dimension,
  cardinality,
  required: o.required ?? false,
  primary: o.primary ?? false,
  write: o.write ?? "admin",
  compat,
  // Appearances and Opportunity Listings have no V1 inference to override.
  curationField: entity === "appearance" || entity === "opportunity" ? null : (CURATION_FIELD[compat] ?? null),
});

/** Every approved entity × dimension combination. Anything not listed does
 * not exist (e.g. Business Attributes, Opportunity Topics). */
export const CLASSIFICATION_RULES: readonly DimensionRule[] = [
  rule("business", "category", "multi", "business_category", { primary: true }),
  rule("business", "business_model", "multi", "business_model"),
  rule("business", "topic", "multi", "topic"),

  rule("location", "category", "multi", "location_category", { primary: true }),
  rule("location", "topic", "multi", "topic"),
  rule("location", "attribute", "multi", "attribute", { write: "deferred" }),

  // Optional at the taxonomy layer: "explicitly unclassified" must be
  // representable (drafts, incomplete imports, records awaiting review).
  // Requiring one for published Events is a later publication concern.
  rule("event", "category", "single", "event_domain"),
  rule("event", "event_type", "single", "event_type"),
  rule("event", "experience_mechanic", "multi", "experience_mechanic"),
  rule("event", "topic", "multi", "topic"),
  rule("event", "audience", "multi", "audience", { write: "live_v1" }),
  rule("event", "entry_mode", "multi", "entry_mode", { write: "live_v1" }),
  rule("event", "benefit", "multi", "benefit", { write: "live_v1" }),
  rule("event", "setting", "single", "setting"),

  // Products are catalog items; Services are never classified as Products.
  rule("product", "category", "multi", "product_category", { primary: true }),
  rule("product", "topic", "multi", "topic"),
  rule("product", "audience", "multi", "audience"),
  rule("product", "attribute", "multi", "attribute", { write: "deferred" }),

  // An Appearance's OWN classification; its Event's is context, never copied.
  rule("appearance", "appearance_type", "single", "appearance_type"),
  rule("appearance", "topic", "multi", "topic"),
  rule("appearance", "benefit", "multi", "benefit"),

  rule("opportunity", "opportunity_category", "single", "opportunity_category", { required: true }),
];

export function ruleFor(entity: ClassifiedEntityType, dimension: ClassificationDimension): DimensionRule | undefined {
  return CLASSIFICATION_RULES.find((r) => r.entity === entity && r.dimension === dimension);
}

export function rulesFor(entity: ClassifiedEntityType): DimensionRule[] {
  return CLASSIFICATION_RULES.filter((r) => r.entity === entity);
}

/** classification_field_sources.entity_type for each entity. */
export const FIELD_SOURCE_ENTITY: Readonly<Record<ClassifiedEntityType, string>> = {
  business: "business",
  location: "location",
  event: "event",
  product: "product",
  appearance: "appearance",
  opportunity: "opportunity_listing",
};

/** The V2 Category tree an entity's Category dimension uses. */
export const CATEGORY_KIND_OF: Partial<Record<ClassifiedEntityType, V2CategoryKind>> = {
  business: "business",
  location: "location",
  event: "event",
  product: "product",
};

// ------------------------------------------------------------ vocabulary status

/** Which vocabulary statuses may be newly assigned. Anything else (retired /
 * deprecated / hidden / draft) stays visible on assignments that already
 * hold it but is never offered or accepted for a new assignment. Staged V2
 * Categories are assignable: they are V2 tree members that are only kept off
 * public V1 surfaces. */
export const ASSIGNABLE_STATUSES = {
  category: ["active", "staged"],
  term: ["active"],
  topic: ["active"],
} as const;

/** The status that means "retired" in each vocabulary store. */
export const RETIRED_STATUS = { category: "deprecated", term: "deprecated", topic: "retired" } as const;

export const isAssignable = (store: keyof typeof ASSIGNABLE_STATUSES, status: string | null | undefined): boolean =>
  (ASSIGNABLE_STATUSES[store] as readonly string[]).includes(status ?? "");
