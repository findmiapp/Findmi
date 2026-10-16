/** Location Import V1 — deterministic presentation for a Location with no
 * verified media, derived only from its own data (never a fake photo,
 * never a stored placeholder file). Real media replaces it automatically. */

const SKIP = new Set(["the", "a", "an", "of", "at", "and", "&"]);

/** "LAVAN Chelsea" → "LC", "The Shed" → "S", "541" → "5". */
export function locationInitials(name: string | null | undefined): string {
  const words = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s\-–—/]+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter((w) => w && !SKIP.has(w.toLowerCase()));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "F";
}

/** "Event Venue · Chelsea" / "Event Venue · New York, NY" / "" — the
 * category and the most local area available. */
export function locationFallbackLine(input: { category?: string | null; area?: string | null; city?: string | null; state?: string | null }): string {
  const place = input.area?.trim() || [input.city?.trim(), input.state?.trim()].filter(Boolean).join(", ");
  return [input.category?.trim(), place].filter(Boolean).join(" · ");
}
