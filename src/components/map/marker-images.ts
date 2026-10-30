// Discovery Map marker helpers — the pieces of DiscoveryMapCanvas that
// don't need MapLibre, kept apart so they're testable.
//
// Marker hierarchy (population layers, every map that uses the canvas):
//   cluster      → white circle + count;
//   Place / item → compact shell with the Location's or Brand's logo
//                  (zoom ≥ 12.5); no logo → filled Aqua dot + initial;
//                  a logo that can't be drawn → the Findmi Place mark
//                  (never an empty shell).
// The selected result is one rich DOM label (DiscoveryMapCanvas).

import type { MapFeature } from "@/lib/discovery/map-core";

/** Every logo image is registered at this size. MapLibre's updateImage
 * only accepts an image of the SAME dimensions as the one it replaces, so
 * the placeholder, the logo and the fallback all share it. */
export const LOGO_IMAGE_SIZE = 64;

/** Transparent stand-in while a logo loads — same size as the final
 * image so the later updateImage is accepted. */
export function logoPlaceholder(): { width: number; height: number; data: Uint8Array } {
  return { width: LOGO_IMAGE_SIZE, height: LOGO_IMAGE_SIZE, data: new Uint8Array(LOGO_IMAGE_SIZE * LOGO_IMAGE_SIZE * 4) };
}

const AQUA = "#14B0BC";

/** The Findmi Place mark: an Aqua disc with a white location pin, drawn
 * where a logo was expected but couldn't be loaded (blocked, missing,
 * not an image). Same footprint as a logo, so markers stay uniform. */
export function placeFallbackImage(): ImageData | null {
  if (typeof document === "undefined") return null;
  const size = LOGO_IMAGE_SIZE;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = AQUA;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2);
  ctx.fill();
  // Pin: a round head over a point, white.
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(32, 27, 10, Math.PI * 0.85, Math.PI * 2.15);
  ctx.lineTo(32, 46);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = AQUA;
  ctx.beginPath();
  ctx.arc(32, 27, 4, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** The selected label hangs to the right of its point: anchored left,
 * pulled back this many px so the logo disc sits on the point. */
export const SELECTED_ANCHOR_OFFSET = 18;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The selected label's second line — status (LIVE, a date, a category),
 * else the place. Omitted when it would only repeat the name. */
export function secondaryLine(f: Pick<MapFeature, "label" | "status" | "place" | "live">): string | null {
  const line = f.live ? (f.status && f.status !== "LIVE" ? `● LIVE · ${f.status}` : "● LIVE") : f.status || f.place;
  if (!line || same(line, f.label)) return null;
  return line;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** How far to pan (px, MapLibre panBy) so the selected label sits inside
 * the usable map area — clear of the screen edges, the top controls and
 * the results sheet (`safe`), and of map controls (`obstacles`). Positive
 * dx moves the content left. The left edge wins if the label is wider
 * than the area (its start — logo and name — stays readable). */
export function labelShift(label: Box, safe: Box, obstacles: readonly Box[] = []): [number, number] {
  let dx = 0;
  let dy = 0;
  if (label.right > safe.right) dx = label.right - safe.right;
  if (label.left - dx < safe.left) dx = label.left - safe.left;
  if (label.bottom > safe.bottom) dy = label.bottom - safe.bottom;
  if (label.top - dy < safe.top) dy = label.top - safe.top;
  for (const o of obstacles) {
    const moved = { left: label.left - dx, right: label.right - dx, top: label.top - dy, bottom: label.bottom - dy };
    if (!overlaps(moved, o)) continue;
    const toLeft = moved.right - (o.left - 8);
    if (moved.left - toLeft >= safe.left) dx += toLeft;
  }
  return [Math.round(dx), Math.round(dy)];
}
