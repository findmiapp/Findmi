// Guest Moment draft — the pure RULES for when a local draft is read,
// restored, merged with URL context and written. No React, no storage, no
// IndexedDB: MomentComposer owns the effects and calls these, and
// tests/guest-moment-session.test.mjs pins them directly.
//
// Why this exists: the first version only ever read the draft for a
// context-free (cold) entry, so reloading an Event-connected composer
// (/my-world/journal/new?event=<id>) never restored anything — and its
// autosave then overwrote the stored draft with the prefill-only state on
// mount. The rules below fix both: a guest's draft is ALWAYS considered on
// load, URL context only fills what the draft is missing, and a draft is
// only written once there is something worth keeping.
import { manualLocationHasText, type JournalManualLocationState, type MomentComposerInitial, type MomentEventPick, type MomentPick } from "./moment-composer";
import type { GuestMomentDraft, GuestMomentMediaRef } from "./guest-moment-draft";

/** The composer fields a guest draft carries — one shape for "what the
 * composer shows right now" and "what the page started it with". */
export interface ComposerSnapshot {
  title: string;
  notes: string;
  entryDate: string;
  entryTime: string;
  location: MomentPick | null;
  manual: JournalManualLocationState;
  events: MomentEventPick[];
  businesses: MomentPick[];
  products: MomentPick[];
  media: GuestMomentMediaRef[];
}

/** A cold, context-free start: no Event/Business/Location/Product prefill
 * and nothing typed. */
export function isColdInitial(initial: MomentComposerInitial): boolean {
  return (
    !initial.location &&
    !initial.title &&
    initial.events.length === 0 &&
    initial.businesses.length === 0 &&
    initial.products.length === 0 &&
    initial.photos.length === 0
  );
}

export function snapshotFromInitial(initial: MomentComposerInitial): ComposerSnapshot {
  return {
    title: initial.title,
    notes: initial.notes,
    entryDate: initial.entryDate,
    entryTime: initial.entryTime,
    location: initial.location,
    manual: initial.manual,
    events: initial.events,
    businesses: initial.businesses,
    products: initial.products,
    media: [],
  };
}

/** Order-sensitive fingerprint of everything a draft preserves. */
export function snapshotSignature(s: ComposerSnapshot): string {
  return JSON.stringify([
    s.title,
    s.notes,
    s.entryDate,
    s.entryTime,
    s.location?.value ?? null,
    [s.manual.name, s.manual.address, s.manual.city, s.manual.state, s.manual.zip, s.manual.suggest],
    s.events.map((e) => [e.value, e.occurrence?.id ?? null]),
    s.businesses.map((b) => b.value),
    s.products.map((p) => p.value),
    s.media.map((m) => [m.localId, m.isCover, m.caption]),
  ]);
}

/** Whether to write the local draft now. A composer that still looks
 * exactly like the page's own starting state (an empty cold start, or a
 * prefill-only Event start) is NOT a draft — writing it on mount is what
 * used to overwrite a real stored draft. Once anything has been persisted
 * for this draft, every later change is persisted too, including edits
 * that happen to return to the starting state. */
export function shouldPersistSnapshot(current: ComposerSnapshot, baselineSignature: string, alreadyPersisted: boolean): boolean {
  return alreadyPersisted || snapshotSignature(current) !== baselineSignature;
}

/** The guest has actually written/chosen something (as opposed to a draft
 * that is only page prefill). */
export function draftHasUserContent(d: Pick<GuestMomentDraft, "title" | "notes" | "media" | "manual">): boolean {
  return Boolean(d.title.trim() || d.notes.trim() || d.media.length > 0 || manualLocationHasText(d.manual));
}

const unionByValue = <T extends { value: string }>(a: T[], b: T[]): T[] => [...a, ...b.filter((x) => !a.some((y) => y.value === x.value))];

/** Precedence when a stored guest draft meets URL context
 * (?event=/?location=/?business=/?product= prefill): THE DRAFT WINS.
 * Everything the guest wrote or chose is kept as-is; the URL only FILLS
 * what is missing — it adds an Event/Business/Product the draft doesn't
 * have yet, supplies a Location only if the draft has neither a Location
 * nor a described place, a title only if the draft has none, and the
 * Event's date/time only when the draft holds no user content to anchor a
 * different date. A cold URL leaves the draft untouched. */
export function mergeContextIntoDraft(draft: GuestMomentDraft, initial: MomentComposerInitial): GuestMomentDraft {
  if (isColdInitial(initial)) return draft;
  const anchored = draftHasUserContent(draft);
  const events = [...draft.events];
  for (const incoming of initial.events) {
    const at = events.findIndex((e) => e.value === incoming.value);
    if (at === -1) events.push(incoming);
    else if (!events[at].occurrence && incoming.occurrence) events[at] = { ...events[at], occurrence: incoming.occurrence };
  }
  return {
    ...draft,
    title: draft.title.trim() ? draft.title : initial.title,
    entryDate: anchored ? draft.entryDate : initial.entryDate,
    entryTime: anchored ? draft.entryTime : initial.entryTime,
    location: draft.location ?? (manualLocationHasText(draft.manual) ? null : initial.location),
    events,
    businesses: unionByValue(draft.businesses, initial.businesses),
    products: unionByValue(draft.products, initial.products),
  };
}

export type GuestStartupDecision =
  | { kind: "none" }
  | { kind: "restore"; draft: GuestMomentDraft }
  | { kind: "prompt"; draft: GuestMomentDraft }
  | { kind: "convert"; draft: GuestMomentDraft };

/** What the composer does with whatever draft it finds on load.
 *
 *  - Signed out: ALWAYS restore (merged with any URL context) — a guest
 *    reloading, or returning to Add Moment, gets their own work back.
 *  - Signed in via the deterministic `?resume=1` round-trip from the auth
 *    prompt, on a cold URL: convert it into the real Moment.
 *  - Signed in on a cold URL without the resume signal: OFFER it, never
 *    act silently (converting publishes).
 *  - Signed in on a contextual URL: leave it alone. */
export function decideGuestStartup(input: { authed: boolean; resume: boolean; initial: MomentComposerInitial; draft: GuestMomentDraft | null }): GuestStartupDecision {
  const { authed, resume, initial, draft } = input;
  if (!draft) return { kind: "none" };
  if (!authed) return { kind: "restore", draft: mergeContextIntoDraft(draft, initial) };
  if (!isColdInitial(initial)) return { kind: "none" };
  return resume ? { kind: "convert", draft } : { kind: "prompt", draft };
}
