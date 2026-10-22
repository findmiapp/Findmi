/** Contextual navigation for long public entity pages (Business, Location,
 * Event, …): the destinations are DERIVED from the sections that actually
 * render for that entity — never a fixed menu. Each page lists its candidate
 * sections in page order with whether that section rendered real content;
 * only those become chips. Pure, so the rules are unit-testable. */

export interface SectionAnchorItem {
  /** DOM id of the section the chip jumps to ("overview" = top of page). */
  id: string;
  label: string;
}

export interface SectionAnchorCandidate extends SectionAnchorItem {
  /** True only when this section renders with meaningful content. */
  present: boolean;
}

/** A page with fewer real sections than this is short enough that a jump row
 * is noise, so the nav is omitted. */
export const MIN_ANCHOR_SECTIONS = 3;
export const OVERVIEW_ANCHOR_ID = "overview-top";

export function buildSectionAnchors(candidates: SectionAnchorCandidate[], overviewLabel = "Overview"): SectionAnchorItem[] {
  const seen = new Set<string>();
  const real = candidates.filter((c) => c.present && !seen.has(c.id) && seen.add(c.id)).map(({ id, label }) => ({ id, label }));
  if (real.length < MIN_ANCHOR_SECTIONS) return [];
  return [{ id: OVERVIEW_ANCHOR_ID, label: overviewLabel }, ...real];
}
