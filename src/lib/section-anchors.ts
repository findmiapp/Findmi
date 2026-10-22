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

/** Navigation appears when the page has MORE THAN ONE meaningful section: the top of the
 * page (Overview) plus at least this many real sections. One section alone is nothing to
 * navigate between, so the nav is omitted — never padded with a made-up section. */
export const MIN_ANCHOR_SECTIONS = 1;
export const OVERVIEW_ANCHOR_ID = "overview-top";

export function buildSectionAnchors(candidates: SectionAnchorCandidate[], overviewLabel = "Overview"): SectionAnchorItem[] {
  const seen = new Set<string>();
  const real = candidates.filter((c) => c.present && !seen.has(c.id) && seen.add(c.id)).map(({ id, label }) => ({ id, label }));
  if (real.length < MIN_ANCHOR_SECTIONS) return [];
  return [{ id: OVERVIEW_ANCHOR_ID, label: overviewLabel }, ...real];
}
