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

// ---------------------------------------------------------------- floating preview
//
// The selected result's floating preview card sits at the marker's
// geographic position: above the pin when it fits, otherwise below; always
// inside the visible map (between the top controls and the bottom sheet /
// edges, which arrive as camera padding), never over the zoom control /
// map credits in the bottom-right corner.

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Pin radius + caret gap between the marker and the card (px). */
export const PREVIEW_PIN_GAP = 26;
const EDGE = 8;
/** The bottom-right control stack (zoom + credits): width / height. */
const CONTROLS_W = 52;
const CONTROLS_H = 120;

/** Card width for a map this wide: substantial on phones (300px at 360 /
 * 390 / 412), never wider than the map allows. */
export function previewWidth(viewW: number): number {
  return Math.max(200, Math.min(300, Math.floor(viewW - 2 * EDGE - 16)));
}

/** The part of the map a preview may occupy: full width minus a small
 * edge, vertically between the padding the controls / sheet cover. */
export function previewSafeArea(view: { w: number; h: number }, pad: Insets) {
  return { l: EDGE, r: view.w - EDGE, t: pad.top + 4, b: view.h - pad.bottom - 4 };
}

export interface PreviewPlacement {
  left: number;
  top: number;
  side: "above" | "below";
  /** Caret x within the card, pointing at the pin. */
  caretX: number;
  /** The pin is in the visible map (otherwise the card is hidden). */
  visible: boolean;
  /** The card fits whole on its side without covering the pin. */
  fits: boolean;
}

export function placePreview(pin: { x: number; y: number }, card: { w: number; h: number }, view: { w: number; h: number }, pad: Insets): PreviewPlacement {
  const s = previewSafeArea(view, pad);
  // Hidden only when its pin is off the map or clearly under the bottom
  // sheet (24px grace: bottom padding isn't always a covering sheet — on
  // desktop it's camera breathing room). A pin near the top keeps its
  // card, placed below it inside the safe area.
  const visible = pin.x >= 0 && pin.x <= view.w && pin.y >= 0 && pin.y <= view.h - pad.bottom + 24;
  const aboveTop = pin.y - PREVIEW_PIN_GAP - card.h;
  const belowTop = pin.y + PREVIEW_PIN_GAP;
  const fitsAbove = aboveTop >= s.t;
  const fitsBelow = belowTop + card.h <= s.b;
  const side: "above" | "below" = fitsAbove ? "above" : fitsBelow ? "below" : pin.y - s.t >= s.b - pin.y ? "above" : "below";
  let top = side === "above" ? aboveTop : belowTop;
  top = Math.max(s.t, Math.min(top, s.b - card.h));
  let left = Math.max(s.l, Math.min(pin.x - card.w / 2, s.r - card.w));
  // Step left of the zoom control / credits when the card would cover them.
  const controlsTop = view.h - pad.bottom - CONTROLS_H;
  if (left + card.w > view.w - CONTROLS_W && top + card.h > controlsTop) left = Math.max(s.l, view.w - CONTROLS_W - 4 - card.w);
  const caretX = Math.max(18, Math.min(card.w - 18, pin.x - left));
  const fits = visible && (side === "above" ? fitsAbove : fitsBelow) && pin.x - left >= 12 && left + card.w - pin.x >= 12;
  return { left: Math.round(left), top: Math.round(top), side, caretX: Math.round(caretX), visible, fits };
}

/** When a new selection's preview doesn't fit, the one corrective pan
 * (`map.panBy` offset): the pin moves to the horizontal middle, low enough
 * for the card to sit above it (or to the middle of a short map). */
export function previewPan(pin: { x: number; y: number }, card: { w: number; h: number }, view: { w: number; h: number }, pad: Insets): [number, number] {
  const s = previewSafeArea(view, pad);
  const wantX = view.w / 2;
  // Card above the pin if the visible map is tall enough; otherwise the
  // pin near the top with the card below it; only then the middle.
  const above = s.t + card.h + PREVIEW_PIN_GAP + 6;
  const below = s.t + 18;
  const wantY = above <= s.b - 16 ? above : below + PREVIEW_PIN_GAP + card.h <= s.b ? below : (s.t + s.b) / 2;
  return [Math.round(pin.x - wantX), Math.round(pin.y - wantY)];
}
