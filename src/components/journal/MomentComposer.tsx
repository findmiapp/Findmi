"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import MomentContextStage from "./MomentContextStage";
import MomentPhotosStage from "./MomentPhotosStage";
import MomentSheet from "./MomentSheet";
import TimeSelect from "@/components/scheduling/TimeSelect";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import {
  startJournalDraft,
  saveJournalBasics,
  saveJournalLocation,
  saveJournalConnections,
  publishJournalEntry,
  saveJournalAsDraft,
  type JournalOccurrenceOption,
} from "@/app/(public)/my-world/journal/actions";
import type { JournalOccurrenceRef } from "@/lib/journal";
import type { JournalEntrySectionRow } from "@/lib/journal-sections";
import { manualLocationHasText, type JournalManualLocationState, type MomentComposerInitial, type MomentEventPick, type MomentPick } from "@/lib/moment-composer";

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
}: {
  mode: "create" | "edit";
  initial: MomentComposerInitial;
  cancelHref: string;
  autoResolveEventIds?: string[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(1);
  const [entryId, setEntryId] = useState<string | null>(initial.entryId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | "publish" | "draft" | "save" | "unpublish">(null);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const isPublished = initial.status === "published" && initial.visibility === "public";

  const entryIdRef = useRef(entryId);
  entryIdRef.current = entryId;
  const draftPromise = useRef<Promise<string | null> | null>(null);
  // Stable across renders so the photo hook's per-tile handlers stay
  // stable (see useJournalPhotoUpload). Concurrent callers share one
  // draft creation instead of racing two rows into existence.
  const ensureEntryId = useCallback(async (): Promise<string | null> => {
    if (entryIdRef.current) return entryIdRef.current;
    if (!draftPromise.current) {
      draftPromise.current = startJournalDraft().then((result) => {
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

  const photos = useJournalPhotoUpload(initial.photos, ensureEntryId);
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
    const [basicsResult, locationResult, connectionsResult] = await Promise.all([
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
    ]);
    if ("error" in locationResult) return { error: locationResult.error, stage: 1 };
    if ("error" in connectionsResult) return { error: connectionsResult.error, stage: 1 };
    if ("error" in basicsResult) return { error: basicsResult.error, stage: 3 };
    return { ok: true };
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
  const busy = saving !== null;

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
          <MomentPhotosStage photos={photos} sections={sections} setSections={setSections} ensureEntryId={ensureEntryId} onError={setError} />
        </div>

        <div className={stage === 3 ? "" : "hidden"}>
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="font-display text-base font-bold tracking-tight text-ink">Name This Moment</span>
              <input
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
              <textarea
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
          <button type="button" onClick={() => goTo((stage + 1) as Stage)} className={primaryButton}>
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
    </div>
  );
}
