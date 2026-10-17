// Public Moment continuous gallery (Pass A) — the pure, client-safe rules
// behind JournalMomentGallery: which sections become visible categories,
// which photos each view shows, and when a filter strip is worth showing.
// Presentation only — reads the existing journal_entry_sections /
// journal_entry_media.section_id data exactly as stored; never reorders it.

import { isJournalSectionType, journalSectionLabel } from "./journal-sections";

export interface MomentGallerySection {
  id: string;
  section_type: string;
  title: string | null;
  notes: string | null;
}

export interface MomentGalleryPhoto {
  id: string;
  /** The photo's section, or null. A section_id that points at no loaded
   * section is passed as null (uncategorized — never dropped). */
  sectionId: string | null;
  isCover: boolean;
}

export interface MomentGalleryCategory {
  /** The section id IS the category identity — two sections are never
   * merged, even when their visible labels happen to match. */
  id: string;
  label: string;
  /** Shown quietly above the photos only while this category is active. */
  notes: string | null;
}

/** A section's public category label, or null when it isn't a visible
 * category: an untitled `other` section gets no badge and no chip (its
 * photos still appear in All). A custom title always wins, `other`
 * included. Unknown stored types fall back the same way as `other`. */
export function momentCategoryLabel(section: Pick<MomentGallerySection, "section_type" | "title">): string | null {
  const title = section.title?.trim();
  if (title) return title;
  if (!isJournalSectionType(section.section_type) || section.section_type === "other") return null;
  return journalSectionLabel(section);
}

/** Visible categories, in the sections' stored display order (the caller
 * passes sections already ordered), keeping only those with at least one
 * photo (the cover counts). Sections with notes but no photos get no chip. */
export function momentGalleryCategories<P extends MomentGalleryPhoto>(sections: MomentGallerySection[], photos: P[]): MomentGalleryCategory[] {
  const withPhotos = new Set(photos.map((p) => p.sectionId).filter((id): id is string => Boolean(id)));
  return sections.flatMap((s) => {
    const label = momentCategoryLabel(s);
    if (!label || !withPhotos.has(s.id)) return [];
    return [{ id: s.id, label, notes: s.notes?.trim() ? s.notes.trim() : null }];
  });
}

/** The photos a view shows, in their stored display order:
 *  - All (null): the whole story — the cover included, in its own place
 *    (being the hero is a presentation role, not removal from the story);
 *  - a category: exactly that section's photos, its cover included. */
export function momentGalleryPhotos<P extends MomentGalleryPhoto>(photos: P[], categoryId: string | null): P[] {
  return categoryId === null ? photos : photos.filter((p) => p.sectionId === categoryId);
}

/** A photo's section badge: shown in All (it explains the organization),
 * hidden inside a section's own view where every photo shares it. */
export function momentBadgeVisible(categoryId: string | null): boolean {
  return categoryId === null;
}

/** A filter strip only when it offers a real choice: at least two visible
 * categories, or one category alongside photos in All that aren't in it.
 * (One category holding the whole story would just repeat All.) */
export function showMomentFilter<P extends MomentGalleryPhoto>(categories: MomentGalleryCategory[], photos: P[]): boolean {
  if (categories.length >= 2) return true;
  if (categories.length === 0) return false;
  const only = categories[0].id;
  return momentGalleryPhotos(photos, null).some((p) => p.sectionId !== only);
}
