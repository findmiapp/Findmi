// Mobile results sheet — content-driven snap heights (pure, testable).
//
//   peek      the map dominates: handle + count, plus the first result (or
//             the selected preview when something is selected). Never a
//             fixed block of empty white space.
//   browse    results become browsable (about half the map column, or
//             less if there's less content).
//   expanded  results dominate; the search / quick controls stay visible
//             above it as the route back to the map.
//
// Every height is the smaller of what the content needs and the state's
// cap, so a sheet is never taller than its content.

export type SheetState = "peek" | "browse" | "expanded";
export const SHEET_ORDER: SheetState[] = ["peek", "browse", "expanded"];

export interface SheetMetrics {
  /** Height of the map column the sheet lives in (tracks the dynamic
   * viewport — Android browser chrome showing / hiding). */
  column: number;
  /** Sheet header: handle + count row. */
  head: number;
  /** Body height Peek should show: the selected preview, or the notices +
   * first result. */
  peekBody: number;
  /** Full body height (preview + every loaded result). */
  contentBody: number;
  /** Space kept free above the sheet for the search / quick controls. */
  topReserve: number;
}

export const PEEK_CAP = 0.62;
export const BROWSE_CAP = 0.56;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function sheetHeights(m: SheetMetrics): Record<SheetState, number> {
  const max = Math.max(m.head, m.column - m.topReserve);
  const peek = Math.round(Math.min(m.head + m.peekBody, m.column * PEEK_CAP, max));
  const browse = Math.round(clamp(m.head + m.contentBody, peek, Math.min(m.column * BROWSE_CAP, max)));
  const expanded = Math.round(clamp(m.head + m.contentBody, browse, max));
  return { peek, browse, expanded };
}

/** Where a drag of `dy` px (negative = up) that ended at `releasedHeight`
 * should settle. A deliberate flick moves one state in its direction;
 * a slow drag settles on the nearest height. States with identical
 * heights (little content) collapse into one. */
export function snapAfterDrag(current: SheetState, heights: Record<SheetState, number>, releasedHeight: number, dy: number): SheetState {
  const distinct = SHEET_ORDER.filter((s, i) => i === 0 || heights[s] > heights[SHEET_ORDER[i - 1]] + 4);
  const at = Math.max(0, distinct.indexOf(current) === -1 ? distinct.length - 1 : distinct.indexOf(current));
  if (dy <= -40) return distinct[Math.min(at + 1, distinct.length - 1)];
  if (dy >= 40) return distinct[Math.max(at - 1, 0)];
  return distinct.reduce((best, s) => (Math.abs(heights[s] - releasedHeight) < Math.abs(heights[best] - releasedHeight) ? s : best), distinct[0]);
}

/** Header tap: peek → browse → expanded → peek (skipping states that
 * wouldn't change anything). */
export function nextOnTap(current: SheetState, heights: Record<SheetState, number>): SheetState {
  const distinct = SHEET_ORDER.filter((s, i) => i === 0 || heights[s] > heights[SHEET_ORDER[i - 1]] + 4);
  const at = distinct.indexOf(current);
  return at === -1 || at === distinct.length - 1 ? "peek" : distinct[at + 1];
}

/** Has the map moved far enough from the queried bounds to offer Search
 * This Area? Any edge shifting by more than `ratio` of the view, or a
 * zoom change of about a third — never for a nudge. */
export function movedMeaningfully(queried: [number, number, number, number] | null | undefined, now: [number, number, number, number], ratio = 0.15): boolean {
  if (!queried) return false;
  const w0 = queried[2] - queried[0];
  const h0 = queried[3] - queried[1];
  const w1 = now[2] - now[0];
  if (w0 <= 0 || h0 <= 0 || w1 <= 0) return false;
  const zoom = w1 / w0;
  if (zoom > 1.35 || zoom < 0.74) return true;
  const span = Math.max(w0, h0);
  return queried.some((v, i) => Math.abs(v - now[i]) > span * ratio);
}
