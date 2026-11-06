// Selected-marker label placement (Map Discovery Batch 1) — pure and
// testable. DiscoveryMapCanvas draws the ONE rich label for the selected
// result; these decide which way it runs, how wide it may be, and whether
// the map should pan so the selection isn't hidden.

/** Width (px) the selected label's text may take: what's left between the
 * marker and the map edge it extends toward, within 72–176 px. The mark,
 * gaps, padding and offset take ~62 px of that room. */
export function selectedLabelWidth(room: number): number {
  return Math.max(72, Math.min(176, Math.floor(room - 62)));
}

/** Which side of the marker the selected label extends to: away from the
 * nearer edge, so it never runs off the visible map. */
export function selectedLabelSide(x: number, width: number): "left" | "right" {
  return x > width / 2 ? "left" : "right";
}

/** Should the map pan to a newly selected marker? When it sits outside the
 * padded visible area (under a sheet / panel) or in the bottom-right corner
 * where the zoom control and the map credits live. */
export function selectionNeedsPan(x: number, y: number, w: number, h: number, pad: { top: number; bottom: number; left: number; right: number }): boolean {
  const margin = 12;
  if (x < pad.left + margin || x > w - pad.right - margin || y < pad.top + margin || y > h - pad.bottom - margin) return true;
  return x > w - 56 && y > h - pad.bottom - 120;
}
