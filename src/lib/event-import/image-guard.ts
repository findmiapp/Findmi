// Event Import — Event image quality guard (pure).
//
// An Event's structured image (JSON-LD Event.image) is Event-specific and is
// always kept. A page-level social meta image (og:image:secure_url /
// og:image / twitter:image) is only a FALLBACK — on many sites it is the
// site-wide share image or the Brand logo. It is dropped ONLY when it is
// provably the site's / Business's own identity imagery, by exact image
// identity with:
//   - a logo the page's own JSON-LD declares (Organization / Brand …);
//   - a logo / cover Brand Import already read from that site;
//   - the site homepage's own social image or JSON-LD logo.
// No file-name or dimension guessing: without such evidence the image is
// kept for Review. A dropped image is never replaced by another image.

/** Image identity for comparison: https, host without "www.", path; the
 * query is ignored for paths that end in an image file name (CDN sizing /
 * cache-busting parameters don't change which image it is). */
export function imageIdentity(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
    const fileLike = /\.(?:jpe?g|png|webp|gif|avif|svg)$/i.test(path);
    return `${host}${path}${fileLike ? "" : u.search}`;
  } catch {
    return null;
  }
}

export type GenericImageEvidence = "page_logo" | "brand_import" | "homepage_image";

export interface GenericImageCheck {
  /** Logos from the Event page's own JSON-LD. */
  pageLogos?: string[];
  /** Logo / cover candidates Brand Import read from this site. */
  brandImages?: string[];
  /** The homepage's social meta images and JSON-LD logos. */
  homepageImages?: string[];
}

/** Which evidence shows `imageUrl` is generic site / Business imagery, or
 * null when nothing does (keep it). */
export function genericImageEvidence(imageUrl: string, check: GenericImageCheck): GenericImageEvidence | null {
  const key = imageIdentity(imageUrl);
  if (!key) return null;
  const has = (list: string[] | undefined) => (list ?? []).some((u) => imageIdentity(u) === key);
  if (has(check.pageLogos)) return "page_logo";
  if (has(check.brandImages)) return "brand_import";
  if (has(check.homepageImages)) return "homepage_image";
  return null;
}

export const GENERIC_IMAGE_WARNING = "No Event Image Found. Generic Brand/Site Image Ignored — the page's only image is the site's standard image, not Event-specific. Add an Event image later if you have one.";
