/** Stale Edit Appearance guard. The Edit Appearance form records the Event /
 * occurrence link it was RENDERED with (loaded_event_id /
 * loaded_event_occurrence_id). If the stored link has changed since then —
 * e.g. Convert To Event linked the item seconds earlier while an older copy
 * of the form was still open — a Save from that copy would silently write
 * its pre-change Related Event state back (clearing the new link). Such a
 * save is refused instead; the admin reloads and sees the real link.
 *
 * Deliberate link changes are unaffected: changing or clearing Related Event
 * on a form that was loaded with the CURRENT link passes this check, and
 * saveAppearance then applies it exactly as before. */

export interface AppearanceLink {
  eventId: string | null;
  occurrenceId: string | null;
}

const norm = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/** `loaded` is null when the submitting form carried no loaded-link markers
 * (a new appearance, or a caller that predates them) — nothing to compare. */
export function isStaleAppearanceLink(loaded: AppearanceLink | null, current: AppearanceLink): boolean {
  if (!loaded) return false;
  return norm(loaded.eventId) !== norm(current.eventId) || norm(loaded.occurrenceId) !== norm(current.occurrenceId);
}

/** Reads the loaded-link markers from a submitted form, or null if absent. */
export function loadedAppearanceLink(formData: FormData): AppearanceLink | null {
  if (!formData.has("loaded_event_id")) return null;
  const read = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? norm(v) : null;
  };
  return { eventId: read("loaded_event_id"), occurrenceId: read("loaded_event_occurrence_id") };
}

export const STALE_APPEARANCE_LINK_MESSAGE =
  "This appearance's Related Event changed after this page was opened (for example by Convert To Event). Nothing was saved — reload the page to see the current link, then make your changes again.";
