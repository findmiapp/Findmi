// Moments V2 — optional photo sections. Client-safe (no server imports):
// the ONE shared definition of the V1 section taxonomy, its consumer
// display labels, and the section row type. The database stores
// section_type as plain text with no enumerating CHECK constraint (see
// supabase/migrations/20261006000000_journal_entry_sections.sql) — this
// module is where the supported values are defined and validated, so the
// taxonomy can grow here without a migration. Internal values are never
// shown to consumers; always render through journalSectionLabel().

export const JOURNAL_SECTION_TYPES = [
  "experience",
  "place",
  "food_drink",
  "products",
  "people",
  "details",
  "favorites",
  "other",
] as const;

export type JournalSectionType = (typeof JOURNAL_SECTION_TYPES)[number];

export const JOURNAL_SECTION_TYPE_LABELS: Record<JournalSectionType, string> = {
  experience: "The Experience",
  place: "The Place",
  food_drink: "Food & Drink",
  products: "Products",
  people: "People",
  details: "Details",
  favorites: "Favorites",
  other: "More Photos",
};

export const JOURNAL_SECTION_TITLE_MAX = 80;
export const JOURNAL_SECTION_NOTES_MAX = 2000;
/** App-level caption limit (the database only enforces a looser 500-char
 * backstop). */
export const JOURNAL_PHOTO_CAPTION_MAX = 280;

export function isJournalSectionType(value: unknown): value is JournalSectionType {
  return typeof value === "string" && (JOURNAL_SECTION_TYPES as readonly string[]).includes(value);
}

/** A section's consumer-facing heading: the owner's own title when set,
 * otherwise the taxonomy's display label. An unknown stored type (e.g. a
 * value added to the taxonomy later and then removed) falls back to the
 * "other" label rather than ever leaking the raw value. */
export function journalSectionLabel(section: { section_type: string; title: string | null }): string {
  const title = section.title?.trim();
  if (title) return title;
  return isJournalSectionType(section.section_type) ? JOURNAL_SECTION_TYPE_LABELS[section.section_type] : JOURNAL_SECTION_TYPE_LABELS.other;
}

export interface JournalEntrySectionRow {
  id: string;
  journal_entry_id: string;
  /** Plain text in the database; validated against JOURNAL_SECTION_TYPES
   * on every write. */
  section_type: string;
  title: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}
