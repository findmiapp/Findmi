// Findmi image variants — the ONE shared convention for display-sized
// copies of uploaded images. Pure and dependency-free, so it runs in
// server and client code alike (tests/image-variants.test.mjs).
//
//   ORIGINAL (never modified/deleted)  →  160px · 800px · 1600px WebP
//
// Path convention (derived, no DB lookup):
//   variant path = original path with its final extension replaced by
//   `.w{size}.webp` — e.g.
//     3f2a….fv1.jpg            → 3f2a….fv1.w800.webp
//     journal/u/e/9c1d….jpg    → journal/u/e/9c1d….w800.webp
//   Only the LAST extension is replaced, so names with several dots stay
//   unambiguous, and a variant can never be mistaken for an original
//   (VARIANT_PATH_RE) or collide with one (originals are server-generated
//   UUID names; variants always end in `.w{160|800|1600}.webp`).
//
// How a reader knows variants exist (no Storage request, no 404 flash):
//   • PUBLIC bucket (findmi-media) — URLs are stored in DB columns and
//     rendered directly, so existence is encoded in the NAME: an upload
//     whose variants were ALL stored successfully gets the marked name
//     `{uuid}.fv1.{ext}` (variants are written BEFORE the original, so a
//     marked original guarantees its variants exist). Unmarked names —
//     every pre-existing object, and any upload whose variants failed —
//     resolve to the original, unchanged.
//   • PRIVATE bucket (journal-media) — every display URL is already signed
//     server-side in one batched call, and Storage reports a missing path
//     per item in that same call; lib/journal.ts signs variant + original
//     together and uses the variant only when it exists. Variants stay
//     private (signed, never public).

export const VARIANT_SIZES = [160, 800, 1600] as const;
export type VariantSize = (typeof VARIANT_SIZES)[number];

/** Display intent → variant. "original" is for fullscreen/zoom viewers. */
export type ImageSize = "thumb" | "card" | "large" | "original";
export const IMAGE_SIZE_PX: Record<Exclude<ImageSize, "original">, VariantSize> = {
  thumb: 160, // logos, avatars, chips, ≤~64px slots
  card: 800, // cards, Moment collages, search, gallery thumbnails
  large: 1600, // covers, heroes, large detail images
};

/** Marker in a public original's name meaning "variants v1 exist". */
export const VARIANT_MARKER = "fv1";

export const VARIANT_PATH_RE = /\.w(160|800|1600)\.webp$/i;
const MARKED_ORIGINAL_RE = /\.fv1\.[a-z0-9]+$/i;

export const PUBLIC_MEDIA_BUCKET = "findmi-media";
const PUBLIC_OBJECT_SEGMENT = `/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/`;

export function isVariantPath(path: string): boolean {
  return VARIANT_PATH_RE.test(path);
}

/** The variant path for an original path (any extension, any dots). */
export function variantPath(originalPath: string, size: VariantSize): string {
  if (isVariantPath(originalPath)) throw new Error("variantPath: already a variant");
  const slash = originalPath.lastIndexOf("/");
  const dot = originalPath.lastIndexOf(".");
  const base = dot > slash + 1 ? originalPath.slice(0, dot) : originalPath;
  return `${base}.w${size}.webp`;
}

/** Name for a new PUBLIC original whose variants were stored. */
export function markedOriginalName(id: string, extension: string): string {
  return `${id}.${VARIANT_MARKER}.${extension.toLowerCase()}`;
}

/** Does this public object path/URL carry the variants marker? */
export function hasPublicVariants(pathOrUrl: string): boolean {
  const path = pathOrUrl.split(/[?#]/)[0];
  return MARKED_ORIGINAL_RE.test(path) && !isVariantPath(path);
}

export function sizeToVariant(size: ImageSize): VariantSize | null {
  return size === "original" ? null : IMAGE_SIZE_PX[size];
}

/** The URL to request for a stored image URL at a display size.
 *
 * Priority (the first case never touches a database):
 *   1. A `.fv1.`-marked original — resolved purely from its filename, exactly
 *      as before `registeredSizes` existed. `registeredSizes` is irrelevant
 *      here and isn't even consulted.
 *   2. An unmarked legacy original WITH a registry entry — resolved to the
 *      requested variant only if that size is present in `registeredSizes`
 *      (a caller's batched media_variants lookup — see
 *      media-variants-registry.ts). Missing from the set → falls through to
 *      the original, same as case 3.
 *   3. Everything else (unmarked with no registry entry, non-findmi-media
 *      URLs, null) — returned unchanged, the pre-existing safe fallback. */
export function imageVariantUrl<T extends string | null | undefined>(
  url: T,
  size: ImageSize,
  registeredSizes?: ReadonlySet<VariantSize> | null,
): T {
  if (!url || size === "original") return url;
  const i = url.indexOf(PUBLIC_OBJECT_SEGMENT);
  if (i === -1) return url;
  const [pathPart, rest = ""] = splitSuffix(url.slice(i + PUBLIC_OBJECT_SEGMENT.length));
  const variantSize = IMAGE_SIZE_PX[size];
  const hasVariant = hasPublicVariants(pathPart) || (registeredSizes?.has(variantSize) ?? false);
  if (!hasVariant) return url;
  return `${url.slice(0, i + PUBLIC_OBJECT_SEGMENT.length)}${variantPath(pathPart, variantSize)}${rest}` as T;
}

function splitSuffix(s: string): [string, string] {
  const j = s.search(/[?#]/);
  return j === -1 ? [s, ""] : [s.slice(0, j), s.slice(j)];
}

/** The findmi-media object path inside a public URL, or null if the URL
 * isn't a findmi-media public object (a different host, a signed/private
 * URL, a non-Supabase asset, null). This is the key a caller passes to the
 * media_variants registry lookup in media-variants-registry.ts. */
export function publicMediaPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_OBJECT_SEGMENT);
  if (i === -1) return null;
  const [pathPart] = splitSuffix(url.slice(i + PUBLIC_OBJECT_SEGMENT.length));
  return pathPart;
}

/** Whether a findmi-media object path is a legacy original that could
 * benefit from a registry lookup — i.e. NOT already `.fv1.`-marked (a
 * marked original's variants resolve for free from its filename, so
 * looking it up in the registry would be wasted work) and not itself a
 * variant path. Callers use this to build the (small) list of paths worth
 * batch-querying for a page, instead of querying every image path. */
export function isLegacyPublicPath(path: string): boolean {
  return !hasPublicVariants(path) && !isVariantPath(path);
}

/** Display size for a slot, inferred from the `sizes`/`width` a component
 * already declares (so existing callers need no new prop):
 *   ≤ 56 CSS px  → thumb (160px: ≥2.8× density for logos/avatars)
 *   ≤ 520 CSS px → card  (800px: ≥1.5×, typically 2–4×)
 *   larger, or unknown full-width (`fill` with no `sizes`) → large (1600px)
 * `sizes` entries: px are literal; vw is resolved against the viewport range
 * its media condition allows (`(min-width: N)` caps the NEXT entry at N; an
 * unconditioned entry alone means any viewport up to 1280px; a final
 * fallback after conditions is a phone, ≤ 480px). */
export function inferImageSize({ sizes, width, fill }: { sizes?: string; width?: number | `${number}` | string; fill?: boolean }): Exclude<ImageSize, "original"> {
  let slot: number | null = null;
  if (sizes) {
    const entries = sizes.split(",").map((e) => e.trim()).filter(Boolean);
    const hasConditions = entries.some((e) => e.startsWith("("));
    let upper = 1280;
    for (const entry of entries) {
      const cond = entry.match(/\(\s*min-width:\s*(\d+)px\s*\)/);
      const len = entry.replace(/\([^)]*\)/g, "").trim();
      const px = len.match(/^(\d+(?:\.\d+)?)px$/);
      const vw = len.match(/^(\d+(?:\.\d+)?)vw$/);
      const basis = cond || !hasConditions ? upper : Math.min(upper, 480);
      const value = px ? parseFloat(px[1]) : vw ? (parseFloat(vw[1]) / 100) * basis : null;
      if (value != null) slot = Math.max(slot ?? 0, value);
      if (cond) upper = parseInt(cond[1], 10);
    }
  } else if (width != null && !fill && Number.isFinite(Number(width))) {
    slot = Number(width);
  }
  if (slot == null) return "large";
  if (slot <= 56) return "thumb";
  if (slot <= 520) return "card";
  return "large";
}
