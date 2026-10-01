"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";
import JournalConnectionGroup from "./JournalConnectionGroup";
import {
  startJournalDraft,
  saveJournalBasics,
  uploadJournalPhoto,
  removeJournalPhoto,
  setJournalCoverPhoto,
  saveJournalLocation,
  saveJournalConnections,
  publishJournalEntry,
} from "@/app/(public)/my-world/journal/actions";

interface PhotoState {
  id: string;
  url: string;
  isCover: boolean;
}

/** Journal V1 — the mobile-first, four-step Create Journal Entry flow.
 * A draft journal_entries row is created lazily (on the first photo
 * upload, or on leaving Step 1 if no photo was added) so uploaded photos
 * always have a real row to attach to and are never lost by navigating
 * between steps — the row stays status='draft' (invisible to anyone,
 * including the owner's own Index) until the final "Save Journal Entry"
 * in Step 4 flips it to 'published'. Each step persists its own slice via
 * its own Server Action on "Next" — no continuous autosave, no client-side
 * draft state that could silently diverge from what's actually saved. */
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
  const [step, setStep] = useState(1);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [photos, setPhotos] = useState<PhotoState[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [title, setTitle] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryTime, setEntryTime] = useState("");
  const [notes, setNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2
  const [location, setLocation] = useState<JournalSearchResult | null>(prefillLocation ?? null);

  // Step 3
  const [businesses, setBusinesses] = useState<JournalSearchResult[]>(prefillBusiness ? [prefillBusiness] : []);
  const [products, setProducts] = useState<JournalSearchResult[]>(prefillProduct ? [prefillProduct] : []);
  const [events, setEvents] = useState<JournalSearchResult[]>(prefillEvent ? [prefillEvent] : []);

  // Step 4
  const [visibility, setVisibility] = useState<"private" | "public">("private");

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

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const id = await ensureEntryId();
    if (!id) return;

    for (const file of Array.from(files)) {
      setUploadingCount((c) => c + 1);
      const formData = new FormData();
      formData.set("file", file);
      // eslint-disable-next-line no-await-in-loop
      const result = await uploadJournalPhoto(id, formData);
      setUploadingCount((c) => c - 1);
      if ("error" in result) {
        setError(result.error);
        continue;
      }
      setPhotos((prev) => [...prev, { id: result.id, url: result.url, isCover: prev.length === 0 }]);
    }
  }

  async function handleRemovePhoto(mediaId: string) {
    if (!entryId) return;
    const wasCover = photos.find((p) => p.id === mediaId)?.isCover ?? false;
    setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    const result = await removeJournalPhoto(entryId, mediaId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (wasCover) {
      setPhotos((prev) => (prev.length > 0 ? prev.map((p, i) => ({ ...p, isCover: i === 0 })) : prev));
    }
  }

  async function handleSetCover(mediaId: string) {
    if (!entryId) return;
    setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === mediaId })));
    await setJournalCoverPhoto(entryId, mediaId);
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
    const result = await saveJournalLocation(entryId, location?.value ?? null);
    setSaving(false);
    if ("error" in result) return setError(result.error);
    setStep(3);
  }

  async function goToStep4() {
    setError(null);
    if (!entryId) return setStep(4);
    setSaving(true);
    const result = await saveJournalConnections(entryId, {
      businessIds: businesses.map((b) => b.value),
      productIds: products.map((p) => p.value),
      eventIds: events.map((e) => e.value),
    });
    setSaving(false);
    if ("error" in result) return setError(result.error);
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
    <div className="mx-auto max-w-lg px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Create Journal Entry</h1>
        <button type="button" onClick={() => router.push("/my-world/journal")} className="text-sm font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-findmi-700">Step {step} of 4</p>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {step === 1 && (
        <div className="mt-5 flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">1. Add the basics</h2>

          <div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((p) => (
                <div key={p.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-black/10 bg-mist">
                  {p.url && <Image src={p.url} alt="" fill unoptimized sizes="96px" className="object-cover" />}
                  {p.isCover && (
                    <span className="absolute left-1 top-1 rounded-full bg-findmi px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Cover
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1 py-0.5">
                    {!p.isCover && (
                      <button type="button" onClick={() => handleSetCover(p.id)} className="text-[9px] font-semibold uppercase text-white">
                        Make cover
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(p.id)}
                      aria-label="Remove photo"
                      className="ml-auto text-[11px] font-bold text-white"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {Array.from({ length: uploadingCount }).map((_, i) => (
                <div key={`uploading-${i}`} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-mist text-xs text-ink/40">
                  Uploading…
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-black/20 text-ink/50 transition hover:border-findmi/50 hover:text-findmi-700"
              >
                <span className="text-2xl leading-none">+</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide">Add photos</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handlePhotoFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's this called?"
              className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Date</span>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink focus:border-findmi/50 focus:outline-none"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Time (optional)</span>
              <input
                type="time"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink focus:border-findmi/50 focus:outline-none"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tell the story — what happened, how it felt..."
              rows={4}
              className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={goToStep2}
            disabled={saving}
            className="mt-2 flex h-12 items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Next"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-5 flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">2. Add a location</h2>
          {location ? (
            <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{location.label}</p>
                {location.sublabel && <p className="truncate text-xs text-ink/55">{location.sublabel}</p>}
              </div>
              <button type="button" onClick={() => setLocation(null)} className="shrink-0 text-xs font-semibold text-ink/50 hover:text-ink">
                Remove
              </button>
            </div>
          ) : (
            <JournalSearchSelect entity="locations" placeholder="Search for a place…" onSelect={setLocation} />
          )}

          <div className="mt-2 flex gap-2">
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
              {saving ? "Saving…" : location ? "Next" : "Skip"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-5 flex flex-col gap-5">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">3. Add brands, products and experiences</h2>

          <JournalConnectionGroup
            label="Businesses"
            entity="businesses"
            placeholder="Search businesses…"
            selected={businesses}
            onAdd={(r) => setBusinesses((prev) => [...prev, r])}
            onRemove={(id) => setBusinesses((prev) => prev.filter((r) => r.value !== id))}
          />
          <JournalConnectionGroup
            label="Products"
            entity="products"
            placeholder="Search products…"
            selected={products}
            onAdd={(r) => setProducts((prev) => [...prev, r])}
            onRemove={(id) => setProducts((prev) => prev.filter((r) => r.value !== id))}
          />
          <JournalConnectionGroup
            label="Events"
            entity="events"
            placeholder="Search events…"
            selected={events}
            onAdd={(r) => setEvents((prev) => [...prev, r])}
            onRemove={(id) => setEvents((prev) => prev.filter((r) => r.value !== id))}
          />

          <div className="mt-2 flex gap-2">
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
        <div className="mt-5 flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">4. Set visibility</h2>

          <button
            type="button"
            onClick={() => setVisibility("private")}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              visibility === "private" ? "border-findmi bg-findmi-50" : "border-black/10 bg-white"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">Private</span>
              <span className="block text-sm text-ink/60">Only you can see this entry.</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setVisibility("public")}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
              visibility === "public" ? "border-findmi bg-findmi-50" : "border-black/10 bg-white"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">Public</span>
              <span className="block text-sm text-ink/60">
                Visible as a public Journal Entry and eligible for future surfacing alongside connected Findmi objects.
              </span>
            </span>
          </button>

          <div className="mt-2 flex gap-2">
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
              disabled={saving}
              className="flex h-12 flex-[2] items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Journal Entry"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
