// Reusable slug/permalink utility — the one place slug-generation logic
// lives for every publicly-routed entity (businesses, events, products,
// locations, people) and, going forward, taxonomy records (business
// categories, product categories, event categories). Used from both a
// client component (for a live WordPress-style permalink preview as an
// admin types) and every admin Server Action (the actual safety net — slug
// validity must never depend on client JS having run at all).

const DIACRITICS_RE = /[\u0300-\u036f]/g;

/** Normalizes arbitrary text into a URL-safe slug: strips diacritics,
 * lowercases, and collapses anything that isn't a letter or digit into a
 * single hyphen, trimming any leading/trailing hyphen left over.
 *
 * "The Native Rose Coffee & Flowers" -> "the-native-rose-coffee-flowers"
 * "Food & Drink"                      -> "food-drink"
 * "  Donna   C  Designs "             -> "donna-c-designs"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS_RE, "") // strip accents, e.g. café -> cafe
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when `input` is already exactly what slugify() would produce from
 * it — i.e. it needs no normalization before being saved. */
export function isCleanSlug(input: string): boolean {
  return input.length > 0 && slugify(input) === input;
}

/** Resolves a normalized base slug to the first available candidate for
 * entity types with a uniqueness requirement, trying `base`, then
 * `base-2`, `base-3`, ... — deterministic, WordPress-style suffixing
 * instead of ever saving a colliding or broken slug. `isTaken` should
 * exclude the record's own id on an edit so re-saving an unchanged slug
 * never collides with itself. */
export async function ensureUniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
  let candidate = base;
  let attempt = 1;
  // Small, bounded retry — FindMi's catalogs are nowhere near large enough
  // to need anything fancier than a linear suffix search.
  while (await isTaken(candidate)) {
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

/** Server-side safety net for a slug field: normalizes whatever the admin
 * submitted, falling back to a slug generated from the title/name if the
 * slug is blank (or normalizes to blank) but a title/name exists. Never
 * returns an empty string when `title` has real content. */
export function resolveSlugInput(submittedSlug: string | null, title: string | null): string {
  const normalized = submittedSlug ? slugify(submittedSlug) : "";
  if (normalized) return normalized;
  return title ? slugify(title) : "";
}
