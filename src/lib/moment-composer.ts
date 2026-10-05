// Moments V2 — shared, client-safe shapes for the Moment composer
// (components/journal/MomentComposer.tsx) and the server pages that seed
// it (/my-world/journal/new, the consumer and admin edit pages). Kept out
// of the "use client" component files so server components can call the
// builders below directly.
import type { JournalEntryWithRelations, JournalOccurrenceRef } from "./journal";
import type { JournalEntrySectionRow } from "./journal-sections";
import type { JournalInitialPhoto } from "@/components/journal/useJournalPhotoUpload";

/** One real Findmi object picked into a Moment. */
export interface MomentPick {
  value: string;
  label: string;
  sublabel?: string;
  image_url?: string | null;
}

/** An Event connected to the Moment, with at most one chosen date. */
export interface MomentEventPick extends MomentPick {
  /** Which block it was added from, so it stays where the person put it. */
  origin: "where" | "who";
  occurrence: JournalOccurrenceRef | null;
}

/** A place that isn't on Findmi yet, described by the person (all
 * optional). Mutually exclusive with a canonical Location. Never written
 * into public.locations; `suggest` is the only "consider adding this"
 * signal. */
export interface JournalManualLocationState {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  suggest: boolean;
}

export const EMPTY_MANUAL_LOCATION: JournalManualLocationState = { name: "", address: "", city: "", state: "", zip: "", suggest: false };

export function manualLocationHasText(m: JournalManualLocationState): boolean {
  return Boolean(m.name.trim() || m.address.trim() || m.city.trim() || m.state.trim() || m.zip.trim());
}

/** Everything the composer starts from — empty for a cold Add Moment,
 * prefilled context for a contextual start, or an existing Moment. */
export interface MomentComposerInitial {
  entryId: string | null;
  status: "draft" | "published";
  visibility: "private" | "public";
  title: string;
  entryDate: string;
  entryTime: string;
  notes: string;
  location: MomentPick | null;
  manual: JournalManualLocationState;
  events: MomentEventPick[];
  businesses: MomentPick[];
  products: MomentPick[];
  photos: JournalInitialPhoto[];
  sections: JournalEntrySectionRow[];
}

export function emptyMomentInitial(): MomentComposerInitial {
  return {
    entryId: null,
    status: "draft",
    visibility: "private",
    title: "",
    entryDate: new Date().toISOString().slice(0, 10),
    entryTime: "",
    notes: "",
    location: null,
    manual: EMPTY_MANUAL_LOCATION,
    events: [],
    businesses: [],
    products: [],
    photos: [],
    sections: [],
  };
}

/** An existing Moment, exactly as stored — nothing is re-derived or
 * re-guessed when editing. */
export function momentInitialFromEntry(entry: JournalEntryWithRelations): MomentComposerInitial {
  const e = entry.entry;
  return {
    entryId: e.id,
    status: e.status,
    visibility: e.visibility,
    title: e.title,
    entryDate: e.entry_date,
    entryTime: e.entry_time ? e.entry_time.slice(0, 5) : "",
    notes: e.notes ?? "",
    location: entry.location
      ? {
          value: entry.location.id,
          label: entry.location.name,
          sublabel: [entry.location.city, entry.location.state].filter(Boolean).join(", ") || undefined,
          image_url: entry.location.logo_url ?? entry.location.cover_image_url,
        }
      : null,
    manual: {
      name: e.manual_location_name ?? "",
      address: e.manual_location_address ?? "",
      city: e.manual_location_city ?? "",
      state: e.manual_location_state ?? "",
      zip: e.manual_location_zip ?? "",
      suggest: e.manual_location_suggested,
    },
    events: entry.events.map((ev) => ({
      value: ev.id,
      label: ev.name,
      sublabel: [ev.city, ev.state].filter(Boolean).join(", ") || undefined,
      image_url: ev.cover_image_url,
      origin: "where" as const,
      occurrence: entry.occurrences.find((o) => o.event_id === ev.id) ?? null,
    })),
    businesses: entry.businesses.map((b) => ({ value: b.id, label: b.name, image_url: b.logo_url })),
    products: entry.products.map((p) => ({ value: p.id, label: p.name, sublabel: p.business?.name, image_url: p.image_url })),
    photos: entry.media.map((m) => ({ id: m.id, url: m.url ?? "", isCover: m.is_cover, sectionId: m.section_id ?? null, caption: m.caption })),
    sections: entry.sections,
  };
}
