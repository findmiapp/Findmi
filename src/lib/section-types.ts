// Pages + Sections — which Section rows the existing renderers understand
// (pure; no I/O). Sections are stored in homepage_rows (legacy table name);
// see lib/homepage-rows.ts for resolution.
//
// Fail closed: only a FEED row of a known content type is ever resolved or
// rendered by the homepage and Guide renderers. A Group is structure only,
// and any unknown / future section_type or content_type renders nothing —
// it is never guessed into another content type.

export type LegacyFeedContentType = "businesses" | "events" | "products" | "business_showcase";

export const LEGACY_FEED_CONTENT_TYPES: readonly LegacyFeedContentType[] = ["businesses", "events", "products", "business_showcase"];

export function isLegacyFeedRow(row: { section_type: string; content_type: string | null }): boolean {
  return row.section_type === "feed" && row.content_type !== null && (LEGACY_FEED_CONTENT_TYPES as readonly string[]).includes(row.content_type);
}

// Pages + Sections V1B — Section types that keep their settings in
// homepage_rows.config (validated in lib/page-sections.ts). They render on
// Guide Pages only; the homepage and every legacy feed path keep skipping
// them through isLegacyFeedRow above. Client-safe constants live here so
// Admin client components never import the validating module.

export const PAGE_SECTION_KINDS = ["entity_results", "rich_text", "map"] as const;
export type PageSectionKind = (typeof PAGE_SECTION_KINDS)[number];

export function isPageSectionKind(v: string | null | undefined): v is PageSectionKind {
  return (PAGE_SECTION_KINDS as readonly string[]).includes(v ?? "");
}

/** What an Entity Results Section lists. "events" = Events AND Appearances
 * together (Findmi's "what's happening"). */
export const ENTITY_SCOPES = ["events", "brands", "places", "products"] as const;
export type EntityScope = (typeof ENTITY_SCOPES)[number];

export const ENTITY_SCOPE_LABELS: Record<EntityScope, string> = {
  events: "Events & Appearances",
  brands: "Brands",
  places: "Places",
  products: "Products",
};

/** Canonical entity kinds a Section can reference (include / exclude / pin). */
export const ENTITY_REF_KINDS = ["event", "appearance", "business", "place", "product"] as const;
export type EntityRefKind = (typeof ENTITY_REF_KINDS)[number];

export const SCOPE_REF_KINDS: Record<EntityScope, readonly EntityRefKind[]> = {
  events: ["event", "appearance"],
  brands: ["business"],
  places: ["place"],
  products: ["product"],
};

export const ENTITY_MODES = ["manual", "dynamic", "hybrid"] as const;
export type EntityMode = (typeof ENTITY_MODES)[number];

export const ENTITY_MODE_LABELS: Record<EntityMode, string> = {
  manual: "Manual",
  dynamic: "Dynamic",
  hybrid: "Hybrid",
};

/** Time windows an Events & Appearances Section can use (the shared
 * Discovery vocabulary — see lib/discovery/query.ts WHEN_LABELS). */
export const RESULT_WHEN = ["now", "today", "tonight", "tomorrow", "weekend", "week", "next_week", "month", "upcoming"] as const;
export type ResultWhen = (typeof RESULT_WHEN)[number];

/** Boolean filters, by key. */
export const RESULT_FLAGS = ["free", "family", "rsvp", "tickets", "featured", "endingSoon", "justAnnounced"] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

export const RESULT_FLAG_LABELS: Record<ResultFlag, string> = {
  free: "Free",
  family: "Family Friendly",
  rsvp: "RSVP",
  tickets: "Tickets",
  featured: "Featured",
  endingSoon: "Ending Soon",
  justAnnounced: "Just Announced",
};

/** Which filters each scope can honestly answer with current data. */
export const SCOPE_FILTERS: Record<EntityScope, readonly string[]> = {
  events: ["when", "date", "from", "to", "categories", "formats", "text", "brands", "places", ...RESULT_FLAGS],
  brands: ["categories", "text", "featured"],
  places: ["categories", "text"],
  products: ["text", "featured", "brands"],
};

/** Bounds — a Page stays small enough to resolve on every render. */
export const SECTION_LIMITS = {
  sectionsPerPage: 24,
  itemsPerSection: 24,
  refsPerList: 50,
  filterIds: 12,
  textBody: 6000,
} as const;
