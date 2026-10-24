// Guest-First Experience Completion pass — a signed-out visitor's
// in-progress Moment, kept entirely on this device until an account turns
// it into a real, authoritative Findmi Moment. Deliberately tiny and
// fully serializable: the actual photo files live in IndexedDB
// (lib/guest-moment-media-db.ts), keyed by the same localId this draft's
// `media` array carries — never here, never base64'd into localStorage.
//
// Exactly ONE guest Moment draft per device (the smallest correct
// solution for V1): starting a contextual Moment (from an Event/Business/
// Location/Product page) while an unfinished generic one already exists
// never destroys it — it simply isn't offered to resume until the person
// returns to the plain, context-free Add Moment entry point.
import type { JournalManualLocationState, MomentEventPick, MomentPick } from "./moment-composer";
import type { JournalEntrySectionRow } from "./journal-sections";

export const GUEST_MOMENT_DRAFT_VERSION = 1;
const KEY = "findmi_guest_moment_draft_v1";

export type GuestMomentIntendedAction = "publish" | "draft";

export interface GuestMomentMediaRef {
  /** Matches the IndexedDB key in lib/guest-moment-media-db.ts. */
  localId: string;
  isCover: boolean;
  caption: string | null;
  /** One of the draft's own `sections` ids, or null/absent = no section. */
  sectionId?: string | null;
}

/** A photo section composed before sign-in — the same fields a real
 * journal_entry_sections row carries, in the draft's section order. */
export interface GuestMomentSectionRef {
  /** Draft-local id (`local-…`), referenced by media `sectionId`. */
  id: string;
  sectionType: string;
  title: string | null;
  notes: string | null;
  /** Set once conversion has created the real section, so a retried
   * conversion never creates it twice. */
  serverId?: string | null;
}

export interface GuestMomentDraft {
  version: typeof GUEST_MOMENT_DRAFT_VERSION;
  draftId: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  notes: string;
  entryDate: string;
  entryTime: string;
  location: MomentPick | null;
  manual: JournalManualLocationState;
  events: MomentEventPick[];
  businesses: MomentPick[];
  products: MomentPick[];
  /** Ordered — this array's order IS the photo order. */
  media: GuestMomentMediaRef[];
  /** Ordered photo sections. Optional: drafts saved before sections were
   * composable signed out simply have none. */
  sections?: GuestMomentSectionRef[];
  /** Set only once the person presses a final action (Save & Publish /
   * Save Without Publishing) — null while still composing. */
  intendedAction: GuestMomentIntendedAction | null;
  /** Set the instant the real journal_entries row is created during
   * conversion, BEFORE anything else is persisted to it — the
   * idempotency anchor: a retried or re-mounted conversion reuses this
   * id instead of ever creating a second Moment. The draft (this record
   * and every IndexedDB blob it references) is removed entirely only
   * once conversion fully succeeds. */
  serverEntryId: string | null;
}

/** Same minimal shape lib/account-follow-client.ts's own FollowStorage
 * uses — an injectable storage so this module is directly unit-testable
 * (a plain in-memory object) without a DOM, while every real call site
 * simply omits `storage` and gets `window.localStorage`. */
export interface GuestMomentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): GuestMomentStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** A draft older than this is treated as abandoned — never silently
 * resumed or converted, never shown as "Continue Draft" either. Still
 * requires an explicit discard to actually clear it, same as any other
 * guest draft; this only stops a months-old orphan from quietly
 * reappearing. */
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export interface GuestMomentDraftStatus {
  /** A valid, unexpired draft — what the composer may restore or convert. */
  draft: GuestMomentDraft | null;
  /** A well-formed draft that has outlived STALE_MS. Never restored; the
   * composer purges it (record + its IndexedDB media) so an abandoned
   * draft doesn't linger forever. */
  expired: GuestMomentDraft | null;
}

export function readGuestMomentDraftStatus(storage: GuestMomentStorage | null = defaultStorage(), now: number = Date.now()): GuestMomentDraftStatus {
  if (!storage) return { draft: null, expired: null };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { draft: null, expired: null };
    const parsed = JSON.parse(raw) as Partial<GuestMomentDraft>;
    if (parsed.version !== GUEST_MOMENT_DRAFT_VERSION || typeof parsed.draftId !== "string" || typeof parsed.updatedAt !== "number") return { draft: null, expired: null };
    if (now - parsed.updatedAt > STALE_MS) return { draft: null, expired: parsed as GuestMomentDraft };
    return { draft: parsed as GuestMomentDraft, expired: null };
  } catch {
    return { draft: null, expired: null };
  }
}

export function readGuestMomentDraft(storage: GuestMomentStorage | null = defaultStorage(), now: number = Date.now()): GuestMomentDraft | null {
  return readGuestMomentDraftStatus(storage, now).draft;
}

export function writeGuestMomentDraft(draft: GuestMomentDraft, storage: GuestMomentStorage | null = defaultStorage(), now: number = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify({ ...draft, updatedAt: now }));
  } catch {
    // Storage unavailable (private browsing, quota) — the composer still
    // works for this session, it just won't survive a reload.
  }
}

export function clearGuestMomentDraft(storage: GuestMomentStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function newGuestMomentDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** An empty draft ready to be filled in as the composer's local state
 * changes — mirrors emptyMomentInitial()'s own defaults so a brand-new
 * guest draft and a brand-new authenticated composer start identically. */
export function emptyGuestMomentDraft(): GuestMomentDraft {
  const now = Date.now();
  return {
    version: GUEST_MOMENT_DRAFT_VERSION,
    draftId: newGuestMomentDraftId(),
    createdAt: now,
    updatedAt: now,
    title: "",
    notes: "",
    entryDate: new Date().toISOString().slice(0, 10),
    entryTime: "",
    location: null,
    manual: { name: "", address: "", city: "", state: "", zip: "", suggest: false },
    events: [],
    businesses: [],
    products: [],
    media: [],
    sections: [],
    intendedAction: null,
    serverEntryId: null,
  };
}

/** A section created while the Moment exists only as a local draft — the
 * same row shape the composer holds for a saved section, under a
 * draft-local id until conversion creates the real one. */
export function newLocalSectionRow(sectionType: string, existing: { display_order: number }[]): JournalEntrySectionRow {
  const now = new Date().toISOString();
  return {
    id: `local-${newGuestMomentDraftId()}`,
    journal_entry_id: "",
    section_type: sectionType,
    title: null,
    notes: null,
    display_order: existing.reduce((max, s) => Math.max(max, s.display_order + 1), 0),
    created_at: now,
    updated_at: now,
  };
}

export function sectionRefsFromRows(rows: JournalEntrySectionRow[], previous: GuestMomentSectionRef[] = []): GuestMomentSectionRef[] {
  return rows.map((r) => ({ id: r.id, sectionType: r.section_type, title: r.title, notes: r.notes, serverId: previous.find((p) => p.id === r.id)?.serverId ?? null }));
}

export function sectionRowsFromRefs(refs: GuestMomentSectionRef[] | undefined): JournalEntrySectionRow[] {
  return (refs ?? []).map((r, i) => ({ id: r.id, journal_entry_id: "", section_type: r.sectionType, title: r.title, notes: r.notes, display_order: i, created_at: "", updated_at: "" }));
}
