"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { JournalEntryWithRelations, JournalOccurrenceRef } from "@/lib/journal";
import type { JournalSearchResult } from "./JournalSearchSelect";
import JournalConnectionsPicker from "./JournalConnectionsPicker";
import JournalLocationPicker, { type JournalManualLocationState } from "./JournalLocationPicker";
import JournalPhotoStrip from "./JournalPhotoStrip";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import {
  saveJournalBasics,
  saveJournalLocation,
  saveJournalConnections,
  updateJournalVisibility,
  publishJournalEntry,
  type JournalOccurrenceOption,
} from "@/app/(public)/my-world/journal/actions";

/** Journal V1 (visual convergence pass) — Edit own Journal Entry. Still
 * one consolidated form (not the four-step wizard) that reuses the exact
 * same Server Actions Create uses, keyed by the same entryId. Now also
 * reuses Create's own photo manager (JournalPhotoStrip +
 * useJournalPhotoUpload) and selected-Location card, so editing a memory
 * looks and behaves like documenting one, not like editing a database
 * row — grouped into clear Photos / Basics / Location / Connections /
 * Visibility sections instead of one long undifferentiated field stack.
 * Ownership was already re-verified server-side by the page that renders
 * this (getOwnJournalEntryOrNull). */
export default function JournalEditForm({ entryId, entry }: { entryId: string; entry: JournalEntryWithRelations }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Journal V2 Pass 1 — STATUS is tracked locally purely to react to a
  // successful Publish in this same session (the Draft pill/Publish button
  // disappear immediately rather than needing a full reload); it is never
  // written anywhere here except via the canonical publishJournalEntry
  // action below. Save Changes never touches this.
  const [status, setStatus] = useState(entry.entry.status);
  const [publishing, setPublishing] = useState(false);

  // Mobile QA Repair pass — stable across renders so the photo hook's own
  // per-tile handlers stay stable too (see useJournalPhotoUpload's note on
  // why that matters for drag performance).
  const ensureEntryId = useCallback(async () => entryId, [entryId]);

  const {
    items: photoItems,
    error: photoError,
    batchProgress: photoBatchProgress,
    batchPerf: photoBatchPerf,
    dismissBatchPerf: dismissPhotoBatchPerf,
    hasActiveUploads,
    handleFiles,
    handleRemove,
    retryItem,
    handleDragReorder,
    moveEarlier,
    moveLater,
    makeCover,
  } = useJournalPhotoUpload(
    entry.media.map((m) => ({ id: m.id, url: m.url ?? "", isCover: m.is_cover, sectionId: m.section_id ?? null })),
    ensureEntryId
  );

  const [title, setTitle] = useState(entry.entry.title);
  const [entryDate, setEntryDate] = useState(entry.entry.entry_date);
  const [entryTime, setEntryTime] = useState(entry.entry.entry_time ?? "");
  const [notes, setNotes] = useState(entry.entry.notes ?? "");
  const [location, setLocation] = useState<JournalSearchResult | null>(
    entry.location
      ? {
          value: entry.location.id,
          label: entry.location.name,
          sublabel: [entry.location.city, entry.location.state].filter(Boolean).join(", ") || undefined,
          image_url: entry.location.logo_url ?? entry.location.cover_image_url,
        }
      : null
  );
  const [manualLocation, setManualLocation] = useState<JournalManualLocationState>({
    name: entry.entry.manual_location_name ?? "",
    address: entry.entry.manual_location_address ?? "",
    city: entry.entry.manual_location_city ?? "",
    state: entry.entry.manual_location_state ?? "",
    zip: entry.entry.manual_location_zip ?? "",
    suggest: entry.entry.manual_location_suggested,
  });
  const [businesses, setBusinesses] = useState<JournalSearchResult[]>(
    entry.businesses.map((b) => ({ value: b.id, label: b.name, image_url: b.logo_url }))
  );
  const [products, setProducts] = useState<JournalSearchResult[]>(
    entry.products.map((p) => ({ value: p.id, label: p.name, sublabel: p.business?.name, image_url: p.image_url }))
  );
  const [events, setEvents] = useState<JournalSearchResult[]>(entry.events.map((e) => ({ value: e.id, label: e.name, image_url: e.cover_image_url })));
  // Journal V2 Pass 2B — at most one specific Event Occurrence, loaded
  // from whatever getJournalEntryWithRelations already resolved (see
  // lib/journal.ts). Never guessed here — only ever set via an explicit
  // occurrence-picker selection (handleSelectOccurrence below).
  const [occurrence, setOccurrence] = useState<JournalOccurrenceRef | null>(entry.occurrences[0] ?? null);
  const [visibility, setVisibility] = useState<"private" | "public">(entry.entry.visibility);

  // Moment V1A / Contextual Moment Composer V1 — a real connection
  // (Business/Product/Event, or a canonical Location) makes this
  // contextually a "Moment"; zero connections keeps it a purely personal
  // Journal Entry. Named once here and reused everywhere this form's
  // copy needs to agree (heading, Location/Connections section labels,
  // Visibility copy, Save/Publish buttons) rather than recomputed per
  // spot.
  const isMoment = entry.businesses.length > 0 || entry.products.length > 0 || entry.events.length > 0 || Boolean(entry.location);

  // Journal V2 Pass 2B — entry_date vs. location are deliberately handled
  // differently on occurrence selection. `location` is already an
  // explicit nullable field, so "has the owner already set one?" is
  // simply `location !== null` — reliable, no new state needed, so it
  // only defaults from the occurrence when genuinely unset. `entryDate`
  // has no equivalent "was this defaulted or deliberately typed" signal
  // today, and inventing one would be exactly the fragile hidden state
  // this pass was told not to add; instead, the occurrence-selection tap
  // itself IS the owner's explicit, visible date decision for this
  // connection, so applying it directly (still editable afterward in the
  // Basics section below) is honest, not silent.
  function handleSelectOccurrence(occ: JournalOccurrenceOption) {
    setOccurrence({ id: occ.id, event_id: occ.event_id, start_at: occ.start_at, end_at: occ.end_at, timezone: occ.timezone, location_id: occ.location?.id ?? null });
    setEntryDate(occ.localDate);
    if (!location && occ.location) {
      setLocation({
        value: occ.location.id,
        label: occ.location.name,
        sublabel: [occ.location.city, occ.location.state].filter(Boolean).join(", ") || undefined,
        image_url: occ.location.logo_url ?? occ.location.cover_image_url,
      });
    }
  }

  function handleClearOccurrence() {
    setOccurrence(null);
  }

  // Journal V2 Pass 1 — the exact same persistence Save Changes always did,
  // extracted so Publish Entry can run it first (see this file's own
  // header note on why: publishJournalEntry re-validates title/entry_date
  // by reading them back FROM THE DATABASE, so a visible-but-unsaved edit
  // must be written before that check runs, or Publish would silently
  // validate/publish stale server state while the form shows something
  // else). Returns the same shape handleSave already checked.
  async function persistAll(): Promise<{ ok: true } | { error: string }> {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("entry_date", entryDate);
    if (entryTime) formData.set("entry_time", entryTime);
    if (notes) formData.set("notes", notes);

    const [basicsResult, locationResult, connectionsResult, visibilityResult] = await Promise.all([
      saveJournalBasics(entryId, formData),
      saveJournalLocation(entryId, location?.value ?? null, {
        name: manualLocation.name.trim() || null,
        address: manualLocation.address.trim() || null,
        city: manualLocation.city.trim() || null,
        state: manualLocation.state.trim() || null,
        zip: manualLocation.zip.trim() || null,
        suggestToFindmi: manualLocation.suggest,
      }),
      saveJournalConnections(entryId, {
        businessIds: businesses.map((b) => b.value),
        productIds: products.map((p) => p.value),
        eventIds: events.map((e) => e.value),
        occurrenceId: occurrence?.id ?? null,
      }),
      updateJournalVisibility(entryId, visibility),
    ]);

    const failed = [basicsResult, locationResult, connectionsResult, visibilityResult].find((r) => "error" in r);
    if (failed && "error" in failed) return { error: failed.error };
    return { ok: true };
  }

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError(isMoment ? "Give this Moment a title." : "Give this entry a title.");
    if (!entryDate) return setError("Choose a date.");
    setSaving(true);

    const result = await persistAll();
    setSaving(false);
    if ("error" in result) return setError(result.error);

    router.push(`/journal/${entryId}`);
    router.refresh();
  }

  // Journal V2 Pass 1 — the real Publish Entry action the audit found
  // completely missing from this form: previously the ONLY code path that
  // ever set status to "published" was the Create wizard's own Step 4,
  // so a draft created any other way (Event capture, admin capture) could
  // never be published once past creation. Reuses the existing canonical
  // publishJournalEntry Server Action unchanged — never a second,
  // competing publish implementation — the only thing new here is giving
  // this form a way to call it, after first guaranteeing the save it
  // represents has actually landed (see persistAll's own note).
  async function handlePublish() {
    setError(null);
    if (!title.trim()) return setError(isMoment ? "Give this Moment a title." : "Give this entry a title.");
    if (!entryDate) return setError("Choose a date.");
    setPublishing(true);

    const saveResult = await persistAll();
    if ("error" in saveResult) {
      setPublishing(false);
      return setError(saveResult.error);
    }

    const publishResult = await publishJournalEntry(entryId, visibility);
    // A successful call redirects server-side (same pattern as
    // JournalCreateWizard's own handlePublish) and never resolves here; a
    // plain {error} object means it genuinely didn't, so the form state
    // (including the edits just saved above) stays exactly as the owner
    // left it and nothing navigates away.
    if (publishResult && "error" in publishResult) {
      setPublishing(false);
      setError(publishResult.error);
      return;
    }
    setStatus("published");
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-lg font-bold tracking-tight text-ink">{isMoment ? "Edit Moment" : "Edit Journal Entry"}</h1>
          {status === "draft" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Draft</span>
          )}
        </div>
        <button type="button" onClick={() => router.push(`/journal/${entryId}`)} className="text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <EditSection label="Photos">
        <JournalPhotoStrip
          items={photoItems}
          error={photoError}
          batchProgress={photoBatchProgress}
          batchPerf={photoBatchPerf}
          onDismissBatchPerf={dismissPhotoBatchPerf}
          disabled={hasActiveUploads}
          onFilesSelected={handleFiles}
          onRemove={handleRemove}
          onRetry={retryItem}
          onDragReorder={handleDragReorder}
          onMoveEarlier={moveEarlier}
          onMoveLater={moveLater}
          onMakeCover={makeCover}
        />
      </EditSection>

      <EditSection label="Basics">
        <div className="flex flex-col gap-2.5">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm font-medium text-ink focus:border-findmi/50 focus:outline-none"
          />
          <div className="flex gap-2.5">
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="h-11 flex-1 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-findmi/50 focus:outline-none"
            />
            <input
              type="time"
              value={entryTime}
              onChange={(e) => setEntryTime(e.target.value)}
              className="h-11 w-28 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-findmi/50 focus:outline-none"
            />
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Notes"
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
          />
        </div>
      </EditSection>

      <EditSection label="Location">
        <JournalLocationPicker
          location={location}
          onLocationChange={setLocation}
          manual={manualLocation}
          onManualChange={setManualLocation}
          selectedActionLabel={isMoment ? "Change" : undefined}
        />
      </EditSection>

      <EditSection label="Connections">
        <JournalConnectionsPicker
          businesses={businesses}
          products={products}
          events={events}
          occurrence={occurrence}
          onAddBusiness={(r) => setBusinesses((prev) => [...prev, r])}
          onRemoveBusiness={(id) => setBusinesses((prev) => prev.filter((r) => r.value !== id))}
          onAddProduct={(r) => setProducts((prev) => [...prev, r])}
          onRemoveProduct={(id) => setProducts((prev) => prev.filter((r) => r.value !== id))}
          onAddEvent={(r) => setEvents((prev) => [...prev, r])}
          onRemoveEvent={(id) => setEvents((prev) => prev.filter((r) => r.value !== id))}
          onSelectOccurrence={handleSelectOccurrence}
          onClearOccurrence={handleClearOccurrence}
          momentMode={isMoment}
        />
      </EditSection>

      <EditSection label="Visibility">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setVisibility("private")}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              visibility === "private" ? "border-findmi bg-findmi-50 text-ink" : "border-black/10 text-ink/60"
            }`}
          >
            Private
          </button>
          <button
            type="button"
            onClick={() => setVisibility("public")}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              visibility === "public" ? "border-findmi bg-findmi-50 text-ink" : "border-black/10 text-ink/60"
            }`}
          >
            Public
          </button>
        </div>
        {/* Journal V2 Pass 1 — the audited semantic mismatch: a draft
            entry with visibility="public" is NOT yet anonymously
            resolvable (the public resolver still requires
            status="published"), so the toggle above choosing "Public"
            must never be read as "this is live right now." Choosing it
            while still a draft is legitimate configuration for later —
            just not an effective state yet. Published entries get the
            plain, accurate "Public"/"Private" they already had. */}
        <p className="mt-1.5 text-xs text-ink/50">
          {status === "draft" && visibility === "public"
            ? `Public when published — not yet visible to anyone else.`
            : visibility === "public"
              ? `Public — anyone can view this ${isMoment ? "Moment" : "entry"}.`
              : `Private — only you can view this ${isMoment ? "Moment" : "entry"}.`}
        </p>
      </EditSection>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || publishing}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
      >
        {saving ? "Saving…" : isMoment ? "Save Moment" : "Save Changes"}
      </button>

      {/* Journal V2 Pass 1 — the missing Publish action. Only rendered for
          a draft (a published entry has nothing to publish); Save Changes
          above stays the one action that never changes status, exactly as
          the locked state model requires. */}
      {status === "draft" && (
        <button
          type="button"
          onClick={handlePublish}
          disabled={saving || publishing || hasActiveUploads}
          className="mt-2.5 flex h-12 w-full items-center justify-center rounded-2xl border-2 border-findmi text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {/* Publishing While Uploads Are Active — never publish while a
              selected photo is still mid-upload; Save Changes above is
              unaffected since it never touches photo/media state. */}
          {publishing ? "Publishing…" : hasActiveUploads ? "Finishing your photos…" : isMoment ? "Publish Moment" : "Publish Entry"}
        </button>
      )}
    </div>
  );
}

function EditSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-black/5 pt-5 first:mt-4 first:border-t-0 first:pt-0">
      <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-findmi-700">{label}</p>
      {children}
    </div>
  );
}
