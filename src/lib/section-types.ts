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
