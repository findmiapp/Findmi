// Area Visibility — the one definition of "Visible on Findmi".
//
// A Findmi Market (parent) and its Areas (children) each carry two
// independent, already-existing flags:
//
//   active            — the geography is valid for assignment. Business,
//                       Location, Event and Appearance creation (and their
//                       database functions) check ONLY this.
//   consumer_visible  — "Visible on Findmi": intentionally exposed as a
//                       Findmi discovery Area in the public Area selectors.
//                       It never decides whether content may exist there.
//
// Effective public visibility:
//   Market  = active AND consumer_visible
//   Area    = its Market is effectively visible AND the Area is active AND
//             consumer_visible
//
// A hidden Market therefore hides every one of its Areas without touching
// their own saved consumer_visible values — turn the Market back on and
// exactly the Areas that were on reappear. Pure and dependency-free.

export interface VisibilityMarket {
  id: string;
  active: boolean;
  /** Optional on older rows; the column defaults to true. */
  consumer_visible?: boolean | null;
}

export interface VisibilityArea {
  market_id: string;
  active: boolean;
  consumer_visible: boolean;
}

export function isMarketVisibleOnFindmi(market: Pick<VisibilityMarket, "active" | "consumer_visible">): boolean {
  return market.active && market.consumer_visible !== false;
}

export function isAreaVisibleOnFindmi(area: Pick<VisibilityArea, "active" | "consumer_visible">, market: Pick<VisibilityMarket, "active" | "consumer_visible">): boolean {
  return isMarketVisibleOnFindmi(market) && area.active && area.consumer_visible;
}

/** The public Area selector tree: only effectively visible Markets, each
 * with only its effectively visible Areas (input order preserved). */
export function buildVisibleAreaTree<M extends VisibilityMarket, A extends VisibilityArea>(markets: M[], areas: A[]): (M & { areas: A[] })[] {
  const visible = markets.filter(isMarketVisibleOnFindmi);
  const byId = new Map(visible.map((m) => [m.id, m]));
  const areasByMarket = new Map<string, A[]>();
  for (const area of areas) {
    const market = byId.get(area.market_id);
    if (!market || !isAreaVisibleOnFindmi(area, market)) continue;
    areasByMarket.set(area.market_id, [...(areasByMarket.get(area.market_id) ?? []), area]);
  }
  return visible.map((m) => ({ ...m, areas: areasByMarket.get(m.id) ?? [] }));
}

/** Admin wording for one row: its own setting, plus — for an Area whose
 * own setting is on — whether its Market currently keeps it off the public
 * selector. */
export function adminVisibilityLabel(
  own: { active: boolean; consumer_visible?: boolean | null },
  parent?: { active: boolean; consumer_visible?: boolean | null; name: string } | null
): string {
  if (!own.active) return "Inactive";
  if (own.consumer_visible === false) return "Hidden";
  if (parent && !isMarketVisibleOnFindmi(parent)) return `Visible on Findmi — not shown while ${parent.name} is hidden`;
  return "Visible on Findmi";
}
