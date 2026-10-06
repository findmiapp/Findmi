// Findmi Moment media collage — the deterministic geometry behind
// MomentMediaCollage. Pure and dependency-free (tests/moment-collage.test.mjs).
//
// Every layout lives in one coordinate space: x and y are percentages of the
// collage's width and height (0–100). Regions are convex polygons cut by
// SEAM LINES: near-vertical seams lean a fixed ~3° and near-horizontal seams
// rise ~3°, computed from the collage's aspect ratio so the PHYSICAL angle is
// the same at every size. Photos are never rotated — only the region shapes
// are slanted. Adjacent regions are separated by one thin, even gap; the
// outer edges are always exactly 0/100, so the collage's rounded rectangle
// stays clean. No randomness anywhere: the same count + aspect always yields
// the same polygons.

export type Point = readonly [number, number];
type Line = readonly [Point, Point];

/** Physical seam angle in degrees (subtle: 2–4° reads as "slanted", not "zigzag"). */
export const SEAM_DEGREES = 3;
/** Gap between regions, as a % of the collage WIDTH (≈2px on a 330px card). */
export const SEAM_GAP = 0.7;
/** Most regions a preview ever shows; more photos become a "+N" overlay. */
export const MAX_COLLAGE_REGIONS = 5;

export interface CollageRegion {
  /** Polygon in collage percentages. */
  points: Point[];
  /** Bounding box in collage percentages. */
  box: { left: number; top: number; width: number; height: number };
  /** The polygon in the region box's own percentages — the CSS clip-path. */
  clipPath: string;
}

const tan = Math.tan((SEAM_DEGREES * Math.PI) / 180);
const r = (n: number) => Math.round(n * 1000) / 1000;

function intersect([[x1, y1], [x2, y2]]: Line, [[x3, y3], [x4, y4]]: Line): Point {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const a = x1 * y2 - y1 * x2;
  const b = x3 * y4 - y3 * x4;
  return [(a * (x3 - x4) - (x1 - x2) * b) / d, (a * (y3 - y4) - (y1 - y2) * b) / d];
}

const TOP: Line = [[0, 0], [100, 0]];
const BOTTOM: Line = [[0, 100], [100, 100]];
const RIGHT: Line = [[100, 0], [100, 100]];

/** A near-vertical seam centred on x=`at`, leaning top-right → bottom-left. */
function vSeam(at: number, aspect: number, offset = 0): Line {
  const dx = (tan * 100) / aspect; // % of width across the full height
  return [
    [at + dx / 2 + offset, 0],
    [at - dx / 2 + offset, 100],
  ];
}

/** A near-horizontal seam centred on y=`at` over [x0, 100], rising to the right. */
function hSeam(at: number, x0: number, aspect: number, offset = 0): Line {
  const dy = tan * ((100 - x0) / 100) * aspect * 100; // % of height across the column
  return [
    [x0, at + dy / 2 + offset],
    [100, at - dy / 2 + offset],
  ];
}

function region(points: Point[]): CollageRegion {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(100, Math.max(...xs));
  const bottom = Math.min(100, Math.max(...ys));
  const width = right - left;
  const height = bottom - top;
  const local = points.map(([x, y]) => `${r(((x - left) / width) * 100)}% ${r(((y - top) / height) * 100)}%`);
  return {
    points: points.map(([x, y]) => [r(x), r(y)] as Point),
    box: { left: r(left), top: r(top), width: r(width), height: r(height) },
    clipPath: `polygon(${local.join(", ")})`,
  };
}

/** The deterministic regions for `count` photos (1–5) at a width/height
 * `aspect`. Region 0 is always the hero. */
export function collageLayout(count: number, aspect: number): CollageRegion[] {
  const n = Math.max(1, Math.min(MAX_COLLAGE_REGIONS, Math.floor(count)));
  const g = SEAM_GAP / 2; // half-gap in % of width
  const gy = (SEAM_GAP * aspect) / 2; // the same physical half-gap in % of height
  const pt = (a: Line, b: Line) => intersect(a, b);

  if (n === 1) return [region([[0, 0], [100, 0], [100, 100], [0, 100]])];

  // 2 — asymmetric ~62/38 split, one slanted seam.
  if (n === 2) {
    const L = vSeam(62, aspect, -g);
    const R = vSeam(62, aspect, g);
    return [
      region([[0, 0], pt(L, TOP), pt(L, BOTTOM), [0, 100]]),
      region([pt(R, TOP), [100, 0], [100, 100], pt(R, BOTTOM)]),
    ];
  }

  // 3 — hero ~63%, two supporting images stacked on the right.
  if (n === 3) {
    const V = 63;
    const L = vSeam(V, aspect, -g);
    const R = vSeam(V, aspect, g);
    const Hu = hSeam(50, V, aspect, -gy);
    const Hd = hSeam(50, V, aspect, gy);
    return [
      region([[0, 0], pt(L, TOP), pt(L, BOTTOM), [0, 100]]),
      region([pt(R, TOP), [100, 0], pt(Hu, RIGHT), pt(R, Hu)]),
      region([pt(R, Hd), pt(Hd, RIGHT), [100, 100], pt(R, BOTTOM)]),
    ];
  }

  // 4 — dominant hero ~60%; right column: a wide top region over two
  // unequal lower regions (not a 2×2 grid).
  if (n === 4) {
    const V = 60;
    const L = vSeam(V, aspect, -g);
    const R = vSeam(V, aspect, g);
    const Hu = hSeam(56, V, aspect, -gy);
    const Hd = hSeam(56, V, aspect, gy);
    const V2l = vSeam(82, aspect, -g);
    const V2r = vSeam(82, aspect, g);
    return [
      region([[0, 0], pt(L, TOP), pt(L, BOTTOM), [0, 100]]),
      region([pt(R, TOP), [100, 0], pt(Hu, RIGHT), pt(R, Hu)]),
      region([pt(R, Hd), pt(V2l, Hd), pt(V2l, BOTTOM), pt(R, BOTTOM)]),
      region([pt(V2r, Hd), pt(Hd, RIGHT), [100, 100], pt(V2r, BOTTOM)]),
    ];
  }

  // 5 — the signature: hero ~57%; right column split by a rising seam into
  // a top pair and a bottom pair whose internal seams sit at DIFFERENT
  // positions, so all four supporting regions have different sizes.
  const V = 57;
  const L = vSeam(V, aspect, -g);
  const R = vSeam(V, aspect, g);
  const Hu = hSeam(46, V, aspect, -gy);
  const Hd = hSeam(46, V, aspect, gy);
  const Tl = vSeam(81, aspect, -g);
  const Tr = vSeam(81, aspect, g);
  const Bl = vSeam(74, aspect, -g);
  const Br = vSeam(74, aspect, g);
  return [
    region([[0, 0], pt(L, TOP), pt(L, BOTTOM), [0, 100]]),
    region([pt(R, TOP), pt(Tl, TOP), pt(Tl, Hu), pt(R, Hu)]),
    region([pt(Tr, TOP), [100, 0], pt(Hu, RIGHT), pt(Tr, Hu)]),
    region([pt(R, Hd), pt(Bl, Hd), pt(Bl, BOTTOM), pt(R, BOTTOM)]),
    region([pt(Br, Hd), pt(Hd, RIGHT), [100, 100], pt(Br, BOTTOM)]),
  ];
}

/** Preview order: the Moment's cover (if any) is the hero, then
 * display_order — stable for a given Moment. */
export function orderPreviewMedia<T extends { is_cover: boolean; display_order: number; id?: string }>(media: readonly T[]): T[] {
  return [...media].sort((a, b) => {
    if (a.is_cover !== b.is_cover) return a.is_cover ? -1 : 1;
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

/** "+N" for photos beyond the shown regions, or null. */
export function collageOverflow(total: number, shown: number): number | null {
  return total > shown ? total - shown : null;
}
