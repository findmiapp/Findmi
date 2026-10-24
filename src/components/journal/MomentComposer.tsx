"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MomentContextStage from "./MomentContextStage";
import MomentPhotosStage from "./MomentPhotosStage";
import MomentSheet from "./MomentSheet";
import MomentPostedBy from "./MomentPostedBy";
import TimeSelect from "@/components/scheduling/TimeSelect";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import {
  startJournalDraft,
  saveJournalBasics,
  saveJournalLocation,
  saveJournalConnections,
  publishJournalEntry,
  saveJournalAsDraft,
  setJournalAuthor,
  type JournalOccurrenceOption,
} from "@/app/(public)/my-world/journal/actions";
import type { JournalOccurrenceRef } from "@/lib/journal";
import type { JournalEntrySectionRow } from "@/lib/journal-sections";
import { manualLocationHasText, type JournalManualLocationState, type MomentComposerInitial, type MomentEventPick, type MomentPick } from "@/lib/moment-composer";
import {
  clearGuestMomentDraft,
  emptyGuestMomentDraft,
  readGuestMomentDraftStatus,
  writeGuestMomentDraft,
  type GuestMomentDraft,
  type GuestMomentIntendedAction,
} from "@/lib/guest-moment-draft";
import { decideGuestStartup, draftContextLabel, shouldPersistSnapshot, snapshotFromInitial, snapshotSignature } from "@/lib/guest-moment-session";
import { deleteAllGuestMomentMedia, getGuestMomentMedia } from "@/lib/guest-moment-media-db";
import type { JournalPhotoItem } from "./useJournalPhotoUpload";

type Stage = 1 | 2 | 3;

const STAGES: { id: Stage; label: string }[] = [
  { id: 1, label: "Context" },
  { id: 2, label: "Photos" },
  { id: 3, label: "Your Moment" },
];

/** Moments V2 — the ONE Add / Edit Moment experience:
 *
 *   1. Context      Where / What?  ·  Who / What Was There?
 *   2. Photos       add photos; optional notes and sections
 *   3. Your Moment  Name This Moment  ·  Tell The Story  ·  date
 *
 * New or not-yet-published Moments finish with Save & Publish (published
 * + public) or Save Without Publishing (draft + private); a published
 * Moment gets Save Changes (stays published) or Unpublish. Nobody has to
 * reason about status vs. visibility.
 *
 * A new Moment's row is created lazily — on the first photo upload or
 * section, or at the final save — never just for opening the composer.
 * Context and text are written at the final save via the existing
 * Server Actions (saveJournalBasics / saveJournalLocation /
 * saveJournalConnections); photos, notes and sections save as they
 * happen. */
export default function MomentComposer({
  mode,
  initial,
  cancelHref,
  autoResolveEventIds,
  authed = true,
  resume = false,
}: {
  mode: "create" | "edit";
  initial: MomentComposerInitial;
  cancelHref: string;
  autoResolveEventIds?: string[];
  /** Guest-First Experience Completion pass — false only for a signed-
   * out visitor at the cold /my-world/journal/new entry point. Stable
   * for this component's whole mount (a transition to signed-in is
   * always a fresh navigation/remount, never a mid-session flip), so
   * every hook below can branch on it directly without breaking the
   * Rules of Hooks. Always true for `mode: "edit"` — that route stays
   * fully behind the existing auth gate, untouched by this pass. */
  authed?: boolean;
  /** True when this load is the deterministic return from the auth
   * sheet's own links (`?resume=1`) — the ONE case that silently,
   * automatically converts a found local draft; every other "a local
   * draft happens to exist" case instead offers Continue Draft, never
   * acts without confirmation. */
  resume?: boolean;
}) {
  const router = useRouter();
  const guestMode = !authed;
  const [stage, setStage] = useState<Stage>(1);
  const [entryId, setEntryId] = useState<string | null>(initial.entryId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | "publish" | "draft" | "save" | "unpublish">(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Guest-First Experience Completion pass — local draft orchestration.
  // The rules (what to restore, how URL context merges in, when a draft is
  // worth writing) live in lib/guest-moment-session.ts; this component
  // only runs the effects. `autosaveReady` stays false until the mount
  // check below has finished deciding/restoring, so the cold or prefill
  // state can never overwrite a stored draft before it has been read.
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [foundDraftPrompt, setFoundDraftPrompt] = useState<GuestMomentDraft | null>(null);
  // Signed out, a Moment in progress for a DIFFERENT Business / Location /
  // Event than the one this composer was opened from: ask before anything
  // is mixed (decideGuestStartup "switch").
  const [switchDraftPrompt, setSwitchDraftPrompt] = useState<GuestMomentDraft | null>(null);
  // "Start A New Moment" never destroys the old draft on the spot: it is
  // replaced only when the new Moment is first saved to this device (its
  // first autosave), so backing out without typing keeps it.
  const pendingReplaceRef = useRef<GuestMomentDraft | null>(null);
  const [restoredNotice, setRestoredNotice] = useState<{ missingPhotos: number } | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [converting, setConverting] = useState(false);
  const [guestAuthPrompt, setGuestAuthPrompt] = useState<GuestMomentIntendedAction | null>(null);
  const conversionStartedRef = useRef(false);
  const baselineSignatureRef = useRef(snapshotSignature(snapshotFromInitial(initial)));
  const persistedOnceRef = useRef(false);
  const draftRef = useRef<GuestMomentDraft>(emptyGuestMomentDraft());

  const isPublished = initial.status === "published" && initial.visibility === "public";

  // Identity V1 — Posted By (public author). Changes only authorship.
  const [authorBusinessId, setAuthorBusinessId] = useState<string | null>(initial.postedBy?.value ?? null);
  const authorRef = useRef(authorBusinessId);
  authorRef.current = authorBusinessId;

  const entryIdRef = useRef(entryId);
  entryIdRef.current = entryId;
  const draftPromise = useRef<Promise<string | null> | null>(null);
  // Stable across renders so the photo hook's per-tile handlers stay
  // stable (see useJournalPhotoUpload). Concurrent callers share one
  // draft creation instead of racing two rows into existence.
  const ensureEntryId = useCallback(async (): Promise<string | null> => {
    if (entryIdRef.current) return entryIdRef.current;
    if (!draftPromise.current) {
      draftPromise.current = startJournalDraft({ authorBusinessId: authorRef.current }).then((result) => {
        if ("error" in result) {
          setError(result.error);
          draftPromise.current = null;
          return null;
        }
        entryIdRef.current = result.id;
        setEntryId(result.id);
        return result.id;
      });
    }
    return draftPromise.current;
  }, []);

  const photos = useJournalPhotoUpload(initial.photos, ensureEntryId, guestMode);
  const [sections, setSections] = useState<JournalEntrySectionRow[]>(initial.sections);

  // Context
  const [location, setLocation] = useState<MomentPick | null>(initial.location);
  // Where the Location came from: the person ("explicit"), or derived
  // from an Event date (the event's id) — a derived Location is replaced
  // or cleared with its Event; an explicit one is never overwritten.
  const [locationSource, setLocationSource] = useState<"explicit" | { eventId: string } | null>(initial.location ? "explicit" : null);
  const [manual, setManual] = useState<JournalManualLocationState>(initial.manual);
  const [events, setEvents] = useState<MomentEventPick[]>(initial.events);
  const [businesses, setBusinesses] = useState<MomentPick[]>(initial.businesses);
  const [products, setProducts] = useState<MomentPick[]>(initial.products);

  // Your Moment
  const [title, setTitle] = useState(initial.title);
  const [titleTouched, setTitleTouched] = useState(mode === "edit");
  const [entryDate, setEntryDate] = useState(initial.entryDate);
  const [dateTouched, setDateTouched] = useState(mode === "edit");
  const [entryTime, setEntryTime] = useState(initial.entryTime);
  const [notes, setNotes] = useState(initial.notes);
  const [fieldError, setFieldError] = useState<"title" | "date" | null>(null);

  // Deterministic name suggestion (never AI): exactly one Event → its
  // name, until the person types their own.
  useEffect(() => {
    if (titleTouched) return;
    setTitle(events.length === 1 ? events[0].label : "");
  }, [events, titleTouched]);

  function goTo(next: Stage) {
    setStage(next);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function pickLocation(pick: MomentPick) {
    setLocation(pick);
    setLocationSource("explicit");
  }

  function removeLocation() {
    setLocation(null);
    setLocationSource(null);
  }

  function addEvent(pick: MomentPick, origin: "where" | "who") {
    setEvents((prev) => (prev.some((e) => e.value === pick.value) ? prev : [...prev, { ...pick, origin, occurrence: null }]));
  }

  function removeEvent(eventId: string) {
    setEvents((prev) => prev.filter((e) => e.value !== eventId));
    if (locationSource && locationSource !== "explicit" && locationSource.eventId === eventId) {
      setLocation(null);
      setLocationSource(null);
    }
  }

  function selectOccurrence(occ: JournalOccurrenceOption) {
    const ref: JournalOccurrenceRef = {
      id: occ.id,
      event_id: occ.event_id,
      start_at: occ.start_at,
      end_at: occ.end_at,
      timezone: occ.timezone,
      location_id: occ.location?.id ?? null,
    };
    setEvents((prev) => prev.map((e) => (e.value === occ.event_id ? { ...e, occurrence: ref } : e)));
    if (!dateTouched) {
      setEntryDate(occ.localDate);
      if (occ.localTime) setEntryTime(occ.localTime);
    }
    // The date's Location fills the Moment's Location only when the
    // person hasn't chosen one (or described a place) themselves.
    const derivable = locationSource !== "explicit" && !manualLocationHasText(manual);
    if (occ.location && derivable && (!location || (locationSource && locationSource.eventId === occ.event_id))) {
      setLocation({
        value: occ.location.id,
        label: occ.location.name,
        sublabel: [occ.location.city, occ.location.state].filter(Boolean).join(", ") || undefined,
        image_url: occ.location.logo_url ?? occ.location.cover_image_url,
      });
      setLocationSource({ eventId: occ.event_id });
    }
  }

  async function persistAll(id: string): Promise<{ ok: true } | { error: string; stage: Stage }> {
    const basics = new FormData();
    basics.set("title", title.trim());
    basics.set("entry_date", entryDate);
    if (entryTime) basics.set("entry_time", entryTime);
    if (notes.trim()) basics.set("notes", notes);
    const [basicsResult, locationResult, connectionsResult, authorResult] = await Promise.all([
      saveJournalBasics(id, basics),
      saveJournalLocation(id, location?.value ?? null, {
        name: manual.name.trim() || null,
        address: manual.address.trim() || null,
        city: manual.city.trim() || null,
        state: manual.state.trim() || null,
        zip: manual.zip.trim() || null,
        suggestToFindmi: manual.suggest,
      }),
      saveJournalConnections(id, {
        businessIds: businesses.map((b) => b.value),
        productIds: products.map((p) => p.value),
        eventIds: events.map((e) => e.value),
        occurrenceIds: events.map((e) => e.occurrence?.id).filter((v): v is string => Boolean(v)),
      }),
      initial.postedBy ? setJournalAuthor(id, authorBusinessId) : Promise.resolve({ ok: true as const }),
    ]);
    if ("error" in locationResult) return { error: locationResult.error, stage: 1 };
    if ("error" in connectionsResult) return { error: connectionsResult.error, stage: 1 };
    if ("error" in basicsResult) return { error: basicsResult.error, stage: 3 };
    if ("error" in authorResult) return { error: authorResult.error, stage: 3 };
    return { ok: true };
  }

  // ── Guest-First Experience Completion pass — local draft orchestration ──

  /** The current composer state as a serializable draft, carrying
   * forward whatever identity (draftId/createdAt/serverEntryId) the
   * in-flight draft already has. Photo order/cover/caption come from the
   * photos hook's own live items (already in the guest's chosen order),
   * never a second, separately-tracked copy. */
  function currentDraftSnapshot(intendedAction: GuestMomentIntendedAction | null): GuestMomentDraft {
    const base = draftRef.current;
    return {
      ...base,
      title,
      notes,
      entryDate,
      entryTime,
      location,
      manual,
      events,
      businesses,
      products,
      media: photos.items
        .filter((it) => it.guestStaged)
        .map((it) => ({ localId: it.localId, isCover: it.isCover, caption: it.caption ?? null })),
      intendedAction,
    };
  }

  function persistGuestDraft(intendedAction: GuestMomentIntendedAction | null) {
    const next = currentDraftSnapshot(intendedAction);
    draftRef.current = next;
    persistedOnceRef.current = true;
    writeGuestMomentDraft(next);
  }

  /** Loads a draft's content into this composer's live state — the guest
   * restoring their own work after a reload, and the FIRST step of
   * converting a draft after authentication. Text/context state is set
   * synchronously; photos come back from IndexedDB (previews rebuilt as
   * fresh object URLs — they are per-page-load by nature). Resolves the
   * number of photos whose bytes were no longer on this device. */
  async function hydrateFromDraft(draft: GuestMomentDraft): Promise<number> {
    draftRef.current = draft;
    setTitle(draft.title);
    setTitleTouched(Boolean(draft.title));
    setNotes(draft.notes);
    setEntryDate(draft.entryDate);
    setDateTouched(Boolean(draft.entryDate));
    setEntryTime(draft.entryTime);
    setLocation(draft.location);
    setLocationSource(draft.location ? "explicit" : null);
    setManual(draft.manual);
    setEvents(draft.events);
    setBusinesses(draft.businesses);
    setProducts(draft.products);
    let missing = 0;
    if (draft.media.length > 0) {
      const restored: JournalPhotoItem[] = [];
      for (const m of draft.media) {
        const file = await getGuestMomentMedia(m.localId);
        if (!file) {
          missing += 1;
          continue;
        }
        restored.push({
          localId: m.localId,
          status: "complete",
          previewUrl: URL.createObjectURL(file),
          isObjectUrl: true,
          file,
          mediaId: m.localId,
          guestStaged: true,
          isCover: m.isCover,
          caption: m.caption,
        });
      }
      photos.hydrateGuestItems(restored);
    }
    return missing;
  }

  /** A signed-out visitor's draft comes back automatically. Only after it
   * is fully restored (text AND photos) does autosave switch on, so
   * nothing half-restored is ever written back over the real draft. */
  async function restoreGuestDraft(draft: GuestMomentDraft) {
    const missingPhotos = await hydrateFromDraft(draft);
    persistedOnceRef.current = true;
    setRestoredNotice({ missingPhotos });
    setAutosaveReady(true);
  }

  /** The explicit way out (never an ordinary load): drops the draft, its
   * IndexedDB photos and the restored content, and puts the composer back
   * exactly as the page opened it. */
  function startOver() {
    setConfirmStartOver(false);
    const live = photos.liveItems();
    const ids = new Set([...draftRef.current.media.map((m) => m.localId), ...live.filter((it) => it.guestStaged).map((it) => it.localId)]);
    live.forEach((it) => {
      if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
    });
    clearGuestMomentDraft();
    void deleteAllGuestMomentMedia([...ids]);
    draftRef.current = emptyGuestMomentDraft();
    persistedOnceRef.current = false;
    setRestoredNotice(null);
    setTitle(initial.title);
    setTitleTouched(false);
    setNotes(initial.notes);
    setEntryDate(initial.entryDate);
    setDateTouched(false);
    setEntryTime(initial.entryTime);
    setLocation(initial.location);
    setLocationSource(initial.location ? "explicit" : null);
    setManual(initial.manual);
    setEvents(initial.events);
    setBusinesses(initial.businesses);
    setProducts(initial.products);
    photos.hydrateGuestItems([]);
    setError(null);
    setGuestAuthPrompt(null);
    setStage(1);
  }

  /** The real, authenticated conversion: creates (or reuses) the actual
   * journal_entries row, uploads every staged photo through the exact
   * same pipeline a signed-in composer already uses, carries the
   * guest's chosen cover/caption onto the resulting real photos by
   * position (a brand-new Moment has no pre-existing photos, so the
   * upload's resulting order exactly matches `draft.media`'s), persists
   * Context/Your Moment, and finishes with whatever action the guest
   * originally pressed. The server-assigned entryId is written back into
   * the still-live local draft BEFORE anything else, so a failure or a
   * repeated call after this point reuses the same row instead of ever
   * creating a second Moment — only full success clears the draft. */
  async function convertGuestDraft(draft: GuestMomentDraft) {
    if (conversionStartedRef.current) return;
    conversionStartedRef.current = true;
    setConverting(true);
    setError(null);
    await hydrateFromDraft(draft);

    if (draft.serverEntryId) {
      entryIdRef.current = draft.serverEntryId;
      setEntryId(draft.serverEntryId);
    }
    const id = await ensureEntryId();
    if (!id) {
      setConverting(false);
      setError("Couldn't save your Moment. Please try again.");
      return;
    }
    if (draft.serverEntryId !== id) writeGuestMomentDraft({ ...draft, serverEntryId: id });

    if (draft.media.length > 0) {
      const files: File[] = [];
      for (const m of draft.media) {
        const file = await getGuestMomentMedia(m.localId);
        if (file) files.push(file);
      }
      if (files.length > 0) {
        await photos.handleFiles(files as unknown as FileList);
        const uploaded = photos.liveItems().filter((it) => it.status === "complete" && it.mediaId && !it.guestStaged);
        const newOnes = uploaded.slice(Math.max(0, uploaded.length - files.length));
        for (let i = 0; i < newOnes.length && i < draft.media.length; i++) {
          const meta = draft.media[i];
          const real = newOnes[i];
          if (meta.caption) await photos.saveCaption(real.localId, meta.caption);
          if (meta.isCover) await photos.makeCover(real.localId);
        }
      }
    }

    const saved = await persistAll(id);
    if ("error" in saved) {
      setConverting(false);
      setError(saved.error);
      return;
    }
    const action = draft.intendedAction ?? "draft";
    if (action === "publish") {
      const result = await publishJournalEntry(id, "public");
      if (result && "error" in result) {
        setConverting(false);
        setError(result.error);
        return;
      }
    } else {
      const result = await saveJournalAsDraft(id);
      if ("error" in result) {
        setConverting(false);
        setError(result.error);
        return;
      }
    }

    clearGuestMomentDraft();
    void deleteAllGuestMomentMedia(draft.media.map((m) => m.localId));
    router.push(`/journal/${id}`);
    router.refresh();
  }

  // Runs once per mount, in the post-commit effect phase (a lazy useState
  // initializer would read localStorage during the client's hydration
  // render, which can differ from the server's render). It ALWAYS
  // considers the stored draft — for a plain /new entry AND for an
  // Event/Business/Location/Product-connected one — and lets
  // decideGuestStartup say what to do with it.
  const mountCheckedRef = useRef(false);
  useEffect(() => {
    if (mountCheckedRef.current) return;
    mountCheckedRef.current = true;
    if (mode !== "create") {
      setAutosaveReady(true);
      return;
    }
    const { draft, expired } = readGuestMomentDraftStatus();
    if (expired) {
      clearGuestMomentDraft();
      void deleteAllGuestMomentMedia(expired.media.map((m) => m.localId));
    }
    const decision = decideGuestStartup({ authed, resume, initial, draft });
    if (decision.kind === "none") setAutosaveReady(true);
    else if (decision.kind === "restore") void restoreGuestDraft(decision.draft);
    else if (decision.kind === "convert") void convertGuestDraft(decision.draft);
    else if (decision.kind === "switch") setSwitchDraftPrompt(decision.draft);
    else setFoundDraftPrompt(decision.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the local draft current with every composer change, WITHOUT any
  // Save/Publish press, so a guest's work survives reloads, navigation and
  // the auth round-trip. Writes only when there is something worth
  // keeping (shouldPersistSnapshot) — never the bare cold/prefill start.
  // No-ops entirely for a signed-in composer, including one mid-conversion.
  useEffect(() => {
    if (!guestMode || !autosaveReady) return;
    const snapshot = currentDraftSnapshot(draftRef.current.intendedAction);
    if (!shouldPersistSnapshot(snapshot, baselineSignatureRef.current, persistedOnceRef.current)) return;
    persistedOnceRef.current = true;
    draftRef.current = snapshot;
    // Started a new Moment over one in progress: its photos are released
    // only now, as the new Moment takes the device's one draft slot.
    const replaced = pendingReplaceRef.current;
    if (replaced) {
      pendingReplaceRef.current = null;
      const keep = new Set(snapshot.media.map((m) => m.localId));
      void deleteAllGuestMomentMedia(replaced.media.map((m) => m.localId).filter((id) => !keep.has(id)));
    }
    writeGuestMomentDraft(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestMode, autosaveReady, title, notes, entryDate, entryTime, location, manual, events, businesses, products, photos.items]);

  /** Signed in, cold URL, a leftover guest draft, no resume signal: the
   * person chooses. Continue converts it into a real Moment. */
  function continueFoundDraft() {
    const draft = foundDraftPrompt;
    setFoundDraftPrompt(null);
    if (draft) void convertGuestDraft(draft);
  }

  /** An ambiguous dismissal (Escape, backdrop tap) never destroys the
   * old draft — it is simply offered again next time. */
  function dismissFoundDraftPrompt() {
    setFoundDraftPrompt(null);
  }

  /** You Have A Moment In Progress → Continue Moment: the existing draft
   * comes back with ITS OWN context — the page this composer was opened
   * from is not merged in. */
  function continueSwitchDraft() {
    const draft = switchDraftPrompt;
    setSwitchDraftPrompt(null);
    if (draft) void restoreGuestDraft(draft);
  }

  /** → Start A New Moment: a clean composer with the newly requested
   * context (the page's own prefill, already in state). The old draft is
   * kept until this new Moment is first saved (pendingReplaceRef). */
  function startNewOverSwitchDraft() {
    const draft = switchDraftPrompt;
    setSwitchDraftPrompt(null);
    pendingReplaceRef.current = draft;
    setAutosaveReady(true);
  }

  /** Only the explicit "Start A New Moment" button discards it. */
  function discardFoundDraft() {
    const draft = foundDraftPrompt;
    setFoundDraftPrompt(null);
    if (!draft) return;
    clearGuestMomentDraft();
    void deleteAllGuestMomentMedia(draft.media.map((m) => m.localId));
  }

  /** The guest-mode half of `finish()` below — never touches the real
   * journal_entries pipeline. Saves exactly what was about to be
   * finished as the local draft's intended action, then shows the
   * contextual auth prompt; Not Now simply closes it, leaving the draft
   * exactly as saved for later. */
  function finishAsGuest(action: GuestMomentIntendedAction) {
    persistGuestDraft(action);
    setGuestAuthPrompt(action);
  }

  async function finish(action: "publish" | "draft" | "save" | "unpublish") {
    setError(null);
    setFieldError(null);
    setConfirmUnpublish(false);
    if (!title.trim()) {
      setFieldError("title");
      setError("Name this Moment.");
      return goTo(3);
    }
    if (!entryDate) {
      setFieldError("date");
      setError("Choose a date.");
      return goTo(3);
    }
    // Guest-First Experience Completion pass — a signed-out visitor never
    // reaches the real journal_entries pipeline from here. `action` is
    // always "publish" or "draft" in guest mode: isPublished (the only
    // way "save"/"unpublish" are offered) requires an already-published
    // Moment, which no guest draft has ever been.
    if (guestMode) {
      finishAsGuest(action === "publish" ? "publish" : "draft");
      return;
    }
    setSaving(action);
    const id = await ensureEntryId();
    if (!id) return setSaving(null);
    const saved = await persistAll(id);
    if ("error" in saved) {
      setSaving(null);
      setError(saved.error);
      return goTo(saved.stage);
    }
    if (action === "publish") {
      // Redirects to the published Moment on success.
      const result = await publishJournalEntry(id, "public");
      if (result && "error" in result) {
        setSaving(null);
        setError(result.error);
        goTo(3);
      }
      return;
    }
    if (action === "draft" || action === "unpublish") {
      const result = await saveJournalAsDraft(id);
      if ("error" in result) {
        setSaving(null);
        return setError(result.error);
      }
    }
    router.push(`/journal/${id}`);
    router.refresh();
  }

  const uploading = photos.hasActiveUploads;
  const busy = saving !== null || converting;

  const primaryButton = "flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60";
  const secondaryButton =
    "flex h-11 w-full items-center justify-center rounded-2xl border border-black/10 text-sm font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-60";

  const finishActions = isPublished ? (
    <>
      <button type="button" onClick={() => void finish("save")} disabled={busy || uploading} className={primaryButton}>
        {saving === "save" ? "Saving…" : uploading ? "Finishing Your Photos…" : "Save Changes"}
      </button>
      <button type="button" onClick={() => setConfirmUnpublish(true)} disabled={busy || uploading} className={secondaryButton}>
        Unpublish
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={() => void finish("publish")} disabled={busy || uploading} className={primaryButton}>
        {saving === "publish" ? "Publishing…" : uploading ? "Finishing Your Photos…" : "Save & Publish"}
      </button>
      <button type="button" onClick={() => void finish("draft")} disabled={busy || uploading} className={secondaryButton}>
        {saving === "draft" ? "Saving…" : "Save Without Publishing"}
      </button>
    </>
  );

  return (
    <div ref={topRef} className="mx-auto max-w-lg scroll-mt-16 px-4 pb-10 pt-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-display text-lg font-bold tracking-tight text-ink">{mode === "create" ? "Add Moment" : "Edit Moment"}</h1>
          {mode === "edit" && !isPublished && (
            <span className="shrink-0 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">Not Published</span>
          )}
        </div>
        <button type="button" onClick={() => router.push(cancelHref)} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>

      <nav aria-label="Moment steps" className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-black/[0.04] p-1">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(s.id)}
            aria-current={stage === s.id ? "step" : undefined}
            className={`h-8 truncate rounded-full px-2 text-xs font-semibold transition ${stage === s.id ? "bg-white text-ink shadow-sm" : "text-ink/50 hover:text-ink"}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {converting && <p className="mt-3 rounded-xl bg-findmi-50 px-3.5 py-2.5 text-sm text-findmi-700">Saving your Moment to your Findmi world…</p>}
      {guestMode && restoredNotice && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-findmi-50 px-3.5 py-2.5 text-sm text-findmi-700">
          <span>{restoredNotice.missingPhotos > 0 ? "Picked up your draft. Some photos couldn’t be restored on this device." : "Picked up where you left off."}</span>
          <button type="button" onClick={() => setConfirmStartOver(true)} className="shrink-0 text-xs font-bold underline underline-offset-2">
            Start Over
          </button>
        </div>
      )}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <div className="mt-5">
        <div className={stage === 1 ? "" : "hidden"}>
          <MomentContextStage
            location={location}
            onPickLocation={pickLocation}
            onRemoveLocation={removeLocation}
            manual={manual}
            onManualChange={setManual}
            events={events}
            onAddEvent={addEvent}
            onRemoveEvent={removeEvent}
            onSelectOccurrence={selectOccurrence}
            businesses={businesses}
            products={products}
            onAddBusiness={(b) => setBusinesses((prev) => (prev.some((x) => x.value === b.value) ? prev : [...prev, b]))}
            onAddProduct={(p) => setProducts((prev) => (prev.some((x) => x.value === p.value) ? prev : [...prev, p]))}
            onRemoveBusiness={(id) => setBusinesses((prev) => prev.filter((b) => b.value !== id))}
            onRemoveProduct={(id) => setProducts((prev) => prev.filter((p) => p.value !== id))}
            autoResolveEventIds={autoResolveEventIds}
          />
        </div>

        <div className={stage === 2 ? "" : "hidden"}>
          <MomentPhotosStage photos={photos} sections={sections} setSections={setSections} ensureEntryId={ensureEntryId} onError={setError} guestMode={guestMode} />
        </div>

        <div className={stage === 3 ? "" : "hidden"}>
          <div className="flex flex-col gap-5">
            {initial.postedBy && <MomentPostedBy postedBy={initial.postedBy} value={authorBusinessId} onChange={setAuthorBusinessId} />}
            <label className="flex flex-col gap-1.5">
              <span className="font-display text-base font-bold tracking-tight text-ink">Name This Moment</span>
              <input autoCapitalize="words"
                type="text"
                value={title}
                maxLength={120}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleTouched(true);
                  if (fieldError === "title") {
                    setFieldError(null);
                    setError(null);
                  }
                }}
                placeholder="e.g. Saturday at the pop-up"
                aria-invalid={fieldError === "title"}
                className={`h-12 rounded-xl border bg-white px-3.5 text-base font-medium text-ink placeholder:font-normal placeholder:text-ink/40 focus:outline-none ${
                  fieldError === "title" ? "border-red-400" : "border-black/10 focus:border-findmi/50"
                }`}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-display text-base font-bold tracking-tight text-ink">Tell The Story</span>
              <span className="-mt-1 text-sm text-ink/55">Optional. What happened, and how it felt.</span>
              <textarea autoCapitalize="sentences"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-ink/50">When</span>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => {
                    setEntryDate(e.target.value);
                    setDateTouched(true);
                    if (fieldError === "date") {
                      setFieldError(null);
                      setError(null);
                    }
                  }}
                  aria-label="Date"
                  aria-invalid={fieldError === "date"}
                  className={`h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm text-ink focus:outline-none ${
                    fieldError === "date" ? "border-red-400" : "border-black/10 focus:border-findmi/50"
                  }`}
                />
                <div className="w-36 shrink-0">
                  <TimeSelect
                    value={entryTime}
                    onChange={(t) => {
                      setEntryTime(t);
                      setDateTouched(true);
                    }}
                    placeholder="Add Time"
                    ariaLabel="Time (optional)"
                    className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-findmi/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-2">
        {mode === "create" && stage < 3 ? (
          <button type="button" onClick={() => goTo((stage + 1) as Stage)} disabled={busy} className={primaryButton}>
            Continue
          </button>
        ) : (
          finishActions
        )}
        {mode === "create" && stage > 1 && (
          <button type="button" onClick={() => goTo((stage - 1) as Stage)} className="flex h-10 items-center justify-center text-sm font-semibold text-ink/50 hover:text-ink">
            Back
          </button>
        )}
      </div>

      {confirmUnpublish && (
        <MomentSheet
          title="Unpublish This Moment?"
          description="Only you will be able to see it. Your changes will be saved."
          onClose={() => setConfirmUnpublish(false)}
          footer={
            <>
              <button type="button" onClick={() => void finish("unpublish")} disabled={busy} className={primaryButton}>
                {saving === "unpublish" ? "Saving…" : "Unpublish"}
              </button>
              <button type="button" onClick={() => setConfirmUnpublish(false)} className="flex h-11 items-center justify-center text-sm font-semibold text-ink/60 hover:text-ink">
                Cancel
              </button>
            </>
          }
        />
      )}

      {guestAuthPrompt && (
        <MomentSheet
          title="Your Moment Is Ready"
          description="Create a free Findmi account to save it to your Findmi world."
          onClose={() => setGuestAuthPrompt(null)}
          footer={
            <>
              <a href={`/signup?next=${encodeURIComponent("/my-world/journal/new?resume=1")}`} className={primaryButton}>
                Create Free Account
              </a>
              <p className="text-center text-sm text-ink/60">
                Already have an account?{" "}
                <a href={`/login?next=${encodeURIComponent("/my-world/journal/new?resume=1")}`} className="font-semibold text-findmi-700 hover:underline">
                  Log In
                </a>
              </p>
              <button type="button" onClick={() => setGuestAuthPrompt(null)} className="text-center text-xs font-semibold text-ink/50 hover:text-ink">
                Not Now
              </button>
            </>
          }
        />
      )}

      {confirmStartOver && (
        <MomentSheet
          title="Start A New Moment?"
          description="This clears the draft saved on this device, including its photos."
          onClose={() => setConfirmStartOver(false)}
          footer={
            <>
              <button type="button" onClick={startOver} className={primaryButton}>
                Clear Draft And Start Over
              </button>
              <button type="button" onClick={() => setConfirmStartOver(false)} className="flex h-11 items-center justify-center text-sm font-semibold text-ink/60 hover:text-ink">
                Keep My Draft
              </button>
            </>
          }
        />
      )}

      {switchDraftPrompt && (
        <MomentSheet
          title="You Have A Moment In Progress"
          description={
            draftContextLabel(switchDraftPrompt)
              ? `Continue your Moment with ${draftContextLabel(switchDraftPrompt)}? Starting a new one replaces it on this device.`
              : "Continue your unfinished Moment? Starting a new one replaces it on this device."
          }
          // A required choice: Escape / backdrop never pick for the person.
          onClose={() => {}}
          footer={
            <>
              <button type="button" onClick={continueSwitchDraft} className={primaryButton}>
                Continue Moment
              </button>
              <button type="button" onClick={startNewOverSwitchDraft} className="flex h-11 items-center justify-center text-sm font-semibold text-ink/60 hover:text-ink">
                Start A New Moment
              </button>
            </>
          }
        />
      )}

      {foundDraftPrompt && (
        <MomentSheet
          title="Continue Your Draft?"
          description="You have an unfinished Moment on this device."
          onClose={dismissFoundDraftPrompt}
          footer={
            <>
              <button type="button" onClick={continueFoundDraft} className={primaryButton}>
                Continue Draft
              </button>
              <button type="button" onClick={discardFoundDraft} className="flex h-11 items-center justify-center text-sm font-semibold text-ink/60 hover:text-ink">
                Start A New Moment
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
