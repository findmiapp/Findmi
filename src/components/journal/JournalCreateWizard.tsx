"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { JournalSearchResult } from "./JournalSearchSelect";
import JournalConnectionsPicker from "./JournalConnectionsPicker";
import JournalLocationPicker, { EMPTY_MANUAL_LOCATION, manualLocationHasText, type JournalManualLocationState } from "./JournalLocationPicker";
import JournalPhotoStrip from "./JournalPhotoStrip";
import JournalStepProgress from "./JournalStepProgress";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import {
  startJournalDraft,
  saveJournalBasics,
  saveJournalLocation,
  saveJournalConnections,
  publishJournalEntry,
  type JournalOccurrenceOption,
} from "@/app/(public)/my-world/journal/actions";
import type { JournalOccurrenceRef } from "@/lib/journal";

/** Journal V1 (visual convergence pass) — the mobile-first, four-step
 * Create Journal Entry flow. Architecture unchanged from the original
 * pass: a draft journal_entries row is created lazily (on the first photo
 * upload, or on leaving Step 1 if no photo was added) so uploaded photos
 * always have a real row to attach to and are never lost by navigating
 * between steps — the row stays status='draft' (invisible to anyone,
 * including the owner's own Index) until the final "Save Journal Entry"
 * in Step 4 flips it to 'published'. Each step persists its own slice via
 * its own Server Action on "Next". This pass only changes the
 * presentation (photo-led Step 1, compact progress, richer selected-state
 * cards) and extracts the photo-upload logic into the shared
 * useJournalPhotoUpload hook so Edit gets the exact same behavior. */
export default function JournalCreateWizard({
  prefillLocation,
  prefillBusiness,
  prefillProduct,
  prefillEvent,
}: {
  prefillLocation?: JournalSearchResult | null;
  prefillBusiness?: JournalSearchResult | null;
  prefillProduct?: JournalSearchResult | null;
  prefillEvent?: JournalSearchResult | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function ensureEntryId(): Promise<string | null> {
    if (entryId) return entryId;
    const result = await startJournalDraft();
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    setEntryId(result.id);
    return result.id;
  }

  const {
    items: photoItems,
    error: photoError,
    hasActiveUploads,
    handleFiles,
    handleRemove,
    retryItem,
    handleDragReorder,
    moveEarlier,
    moveLater,
    makeCover,
  } = useJournalPhotoUpload([], ensureEntryId);

  // Step 1
  const [title, setTitle] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryTime, setEntryTime] = useState("");
  const [notes, setNotes] = useState("");

  // Step 2
  const [location, setLocation] = useState<JournalSearchResult | null>(prefillLocation ?? null);
  const [manualLocation, setManualLocation] = useState<JournalManualLocationState>(EMPTY_MANUAL_LOCATION);

  // Step 3
  const [businesses, setBusinesses] = useState<JournalSearchResult[]>(prefillBusiness ? [prefillBusiness] : []);
  const [products, setProducts] = useState<JournalSearchResult[]>(prefillProduct ? [prefillProduct] : []);
  const [events, setEvents] = useState<JournalSearchResult[]>(prefillEvent ? [prefillEvent] : []);
  // Journal V2 Pass 2B — never prefilled even alongside prefillEvent: a
  // specific occurrence is never guessed, only ever set via an explicit
  // picker selection (same reasoning as JournalEditForm's own
  // handleSelectOccurrence). A prefilled Event with no occurrence yet
  // still gets the picker's own "Which date was this?" affordance.
  const [occurrence, setOccurrence] = useState<JournalOccurrenceRef | null>(null);

  // Step 4
  const [visibility, setVisibility] = useState<"private" | "public">("private");

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

  async function goToStep2() {
    setError(null);
    if (!title.trim()) return setError("Give this entry a title.");
    if (!entryDate) return setError("Choose a date.");
    setSaving(true);
    const id = await ensureEntryId();
    if (!id) return setSaving(false);
    const formData = new FormData();
    formData.set("title", title);
    formData.set("entry_date", entryDate);
    if (entryTime) formData.set("entry_time", entryTime);
    if (notes) formData.set("notes", notes);
    const result = await saveJournalBasics(id, formData);
    setSaving(false);
    if ("error" in result) return setError(result.error);
    setStep(2);
  }

  async function goToStep3() {
    setError(null);
    if (!entryId) return setStep(3);
    setSaving(true);
    const result = await saveJournalLocation(entryId, location?.value ?? null, {
      name: manualLocation.name.trim() || null,
      address: manualLocation.address.trim() || null,
      city: manualLocation.city.trim() || null,
      state: manualLocation.state.trim() || null,
      zip: manualLocation.zip.trim() || null,
      suggestToFindmi: manualLocation.suggest,
    });
    setSaving(false);
    if ("error" in result) return setError(result.error);
    setStep(3);
  }

  async function goToStep4() {
    setError(null);
    if (!entryId) return setStep(4);
    setSaving(true);
    // Journal Experience Date repair — Step 1's saveJournalBasics already
    // persisted entry_date once, but handleSelectOccurrence (Step 3) can
    // update the local entryDate afterward when the owner picks a specific
    // Event Occurrence. Nothing else re-saves basics before this point, so
    // that updated date must be re-persisted here — otherwise the UI shows
    // the selected occurrence correctly while journal_entries.entry_date
    // silently keeps Step 1's earlier (often default-to-today) value.
    const basicsFormData = new FormData();
    basicsFormData.set("title", title);
    basicsFormData.set("entry_date", entryDate);
    if (entryTime) basicsFormData.set("entry_time", entryTime);
    if (notes) basicsFormData.set("notes", notes);
    const [basicsResult, connectionsResult] = await Promise.all([
      saveJournalBasics(entryId, basicsFormData),
      saveJournalConnections(entryId, {
        businessIds: businesses.map((b) => b.value),
        productIds: products.map((p) => p.value),
        eventIds: events.map((e) => e.value),
        occurrenceId: occurrence?.id ?? null,
      }),
    ]);
    setSaving(false);
    const failed = [basicsResult, connectionsResult].find((r) => "error" in r);
    if (failed && "error" in failed) return setError(failed.error);
    setStep(4);
  }

  async function handlePublish() {
    if (!entryId) return;
    setError(null);
    setSaving(true);
    const result = await publishJournalEntry(entryId, visibility);
    // A successful call redirects server-side and never resolves here; a
    // plain object return means it genuinely didn't.
    if (result && "error" in result) {
      setSaving(false);
      setError(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold tracking-tight text-ink">Create Journal Entry</h1>
        <button type="button" onClick={() => router.push("/my-world/journal")} className="text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>
      <JournalStepProgress step={step} />

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {step === 1 && (
        <div className="mt-4 flex flex-col gap-3.5">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">1. Add the basics</h2>

          <JournalPhotoStrip
            items={photoItems}
            error={photoError}
            disabled={hasActiveUploads}
            onFilesSelected={handleFiles}
            onRemove={handleRemove}
            onRetry={retryItem}
            onDragReorder={handleDragReorder}
            onMoveEarlier={moveEarlier}
            onMoveLater={moveLater}
            onMakeCover={makeCover}
          />

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm font-medium text-ink placeholder:text-ink/40 placeholder:font-normal focus:border-findmi/50 focus:outline-none"
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
              placeholder="Time"
              className="h-11 w-28 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink focus:border-findmi/50 focus:outline-none"
            />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Tell the story — what happened, how it felt..."
            rows={3}
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
          />

          <button
            type="button"
            onClick={goToStep2}
            disabled={saving}
            className="mt-1 flex h-12 items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Next"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 flex flex-col gap-3.5">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">2. Add a location</h2>
          <JournalLocationPicker location={location} onLocationChange={setLocation} manual={manualLocation} onManualChange={setManualLocation} />

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-black/10 text-sm font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goToStep3}
              disabled={saving}
              className="flex h-12 flex-[2] items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : location || manualLocationHasText(manualLocation) ? "Next" : "Skip"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-ink">3. Add to this experience</h2>
            <p className="mt-0.5 text-xs text-ink/50">Connect anything that was part of your day.</p>
          </div>

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
          />

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-black/10 text-sm font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goToStep4}
              disabled={saving}
              className="flex h-12 flex-[2] items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : businesses.length || products.length || events.length ? "Next" : "Skip"}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-4 flex flex-col gap-3">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">4. Set visibility</h2>

          <VisibilityOption
            active={visibility === "private"}
            onClick={() => setVisibility("private")}
            icon={<LockGlyph className="h-4 w-4" />}
            title="Private"
            description="Only you can see this entry."
          />
          <VisibilityOption
            active={visibility === "public"}
            onClick={() => setVisibility("public")}
            icon={<GlobeGlyph className="h-4 w-4" />}
            title="Public"
            description="Anyone can see this entry. It may also appear alongside places, brands, products and events you've connected."
          />

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-black/10 text-sm font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={saving || hasActiveUploads}
              className="flex h-12 flex-[2] items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
            >
              {/* Publishing While Uploads Are Active — never finish
                  publication while a selected photo is still mid-upload
                  (it would silently omit from the saved entry). The
                  button simply stays disabled with an honest reason until
                  every active upload settles, rather than attempting a
                  background "publish once ready" state machine. */}
              {saving ? "Saving…" : hasActiveUploads ? "Finishing your photos…" : "Save Journal Entry"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VisibilityOption({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 text-left transition ${active ? "border-findmi bg-findmi-50" : "border-black/10 bg-white"}`}
    >
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? "bg-findmi text-white" : "bg-black/5 text-ink/50"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-ink">{title}</span>
        <span className="block text-sm text-ink/60">{description}</span>
      </span>
    </button>
  );
}

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V7.5a4 4 0 118 0V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GlobeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
