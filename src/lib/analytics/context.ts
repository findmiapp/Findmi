// Findmi Analytics Phase 2A — shared placement/attribution context.
//
// Shared cards (BusinessCard/ProductCard/LocationCard/HomeEventCard/
// CompactCard/AppearanceCard) can't guess where they were rendered — a
// parent surface (a Discovery Page Builder row, a plain discovery route,
// a roster) optionally hands this down so the card's own
// entity_impression/entity_click carries more than just the entity's
// bare identity. Every field is optional: a caller that doesn't know or
// doesn't need this level of detail passes nothing, and the card still
// fires baseline attribution using only what it already knows about the
// entity itself (see buildEntityEventFields below) — no existing call
// site is required to change for coverage to exist.
import type { AnalyticsEntityOrigin, AnalyticsPageType, AnalyticsSubjectType } from "./taxonomy";

export interface AnalyticsPlacementContext {
  pageType?: AnalyticsPageType | string;
  pagePath?: string;
  /** A short, stable label for where on the page this rendered — e.g.
   * "homepage_row", "roster", "discover_grid". Free text, capped
   * server-side like every other text field. */
  placement?: string;
  /** Set only when the entity rendered inside a Discovery Page Builder
   * section (see lib/homepage-rows.ts) — never fabricated for a plain
   * query-param-driven route. */
  discoveryPageId?: string;
  discoverySectionId?: string;
  /** Hybrid-mode sections only — whether this specific entity was one of
   * the section's founder-pinned picks or came from the automatic fill.
   * Omitted entirely for dynamic/curated sections and anywhere outside
   * the Page Builder. */
  origin?: AnalyticsEntityOrigin;
  /** The section's own content_type/mode (e.g. "businesses"/"hybrid") —
   * the SECTION's configuration, not the entity's own type. */
  sectionContentType?: string;
  sectionMode?: string;
  /** 1-indexed position the consumer actually saw at render time.
   * Captured now — never derived later from today's mutable section/row
   * order. */
  position?: number;
}

export interface EntityRelationshipIds {
  businessId?: string | null;
  eventId?: string | null;
  eventOccurrenceId?: string | null;
  appearanceId?: string | null;
  locationId?: string | null;
  productId?: string | null;
}

function present(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

/** Builds the shared attribution fields every card's entity_impression/
 * entity_click carries — one place composing subject/relationship/
 * placement fields so all 6 shared cards stay consistent instead of each
 * re-deriving a slightly different shape. Returned object is spread
 * directly into a TrackEventPayload alongside `event_name`. */
export function buildEntityEventFields(
  subjectType: AnalyticsSubjectType,
  subjectId: string,
  relationships: EntityRelationshipIds,
  context?: AnalyticsPlacementContext
) {
  const metadata: Record<string, unknown> = {};
  if (context?.origin) metadata.origin = context.origin;
  if (context?.sectionContentType) metadata.content_type = context.sectionContentType;
  if (context?.sectionMode) metadata.mode = context.sectionMode;
  if (context?.position != null) metadata.rendered_position = context.position;

  return {
    subject_type: subjectType,
    subject_id: subjectId,
    business_id: present(relationships.businessId),
    event_id: present(relationships.eventId),
    event_occurrence_id: present(relationships.eventOccurrenceId),
    appearance_id: present(relationships.appearanceId),
    location_id: present(relationships.locationId),
    product_id: present(relationships.productId),
    discovery_page_id: context?.discoveryPageId,
    discovery_section_id: context?.discoverySectionId,
    page_type: context?.pageType,
    page_path: context?.pagePath,
    placement: context?.placement,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
