"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { JournalEntryWithRelations } from "@/lib/journal";
import JournalSearchSelect, { type JournalSearchResult } from "./JournalSearchSelect";
import JournalConnectionGroup from "./JournalConnectionGroup";
import {
  saveJournalBasics,
  uploadJournalPhoto,
  removeJournalPhoto,
  setJournalCoverPhoto,
  saveJournalLocation,
  saveJournalConnections,
  updateJournalVisibility,
} from "@/app/(public)/my-world/journal/actions";

interface PhotoState {
  id: string;
  url: string;
  isCover: boolean;
}

/** Journal V1 — Edit own Journal Entry. One consolidated form (not a
 * second copy of the four-step Create wizard) that reuses the exact same
 * Server Actions Create uses, keyed by the same entryId — title/date/time/
 * notes, photos, cover, Location, connections, and visibility are all
 * editable here, saved in one "Save Changes" pass. Ownership was already
 * re-verified server-side by the page that renders this (getOwnJournalEntryOrNull). */
export default function JournalEditForm({ entryId, entry }: { entryId: string; entry: JournalEntryWithRelations }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<PhotoState[]>(
    entry.media.map((m) => ({ id: m.id, url: m.url ?? "", isCover: m.is_cover }))
  );
  const [uploadingCount, setUploadingCount] = useState(0);
  const [title, setTitle] = useState(entry.entry.title);
  const [entryDate, setEntryDate] = useState(entry.entry.entry_date);
  const [entryTime, setEntryTime] = useState(entry.entry.entry_time ?? "");
  const [notes, setNotes] = useState(entry.entry.notes ?? "");
  const [location, setLocation] = useState<JournalSearchResult | null>(
    entry.location
      ? { value: entry.location.id, label: entry.location.name, sublabel: [entry.location.city, entry.location.state].filter(Boolean).join(", ") || undefined, image_url: entry.location.logo_url ?? entry.location.cover_image_url }
      : null
  );
  const [businesses, setBusinesses] = useState<JournalSearchResult[]>(
    entry.businesses.map((b) => ({ value: b.id, label: b.name, image_url: b.logo_url }))
  );
  const [products, setProducts] = useState<JournalSearchResult[]>(
    entry.products.map((p) => ({ value: p.id, label: p.name, sublabel: p.business?.name, image_url: p.image_url }))
  );
  const [events, setEvents] = useState<JournalSearchResult[]>(
    entry.events.map((e) => ({ value: e.id, label: e.name, image_url: e.cover_image_url }))
  );
  const [visibility, setVisibility] = useState<"private" | "public">(entry.entry.visibility);

  async function handlePhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      setUploadingCount((c) => c + 1);
      const formData = new FormData();
      formData.set("file", file);
      // eslint-disable-next-line no-await-in-loop
      const result = await uploadJournalPhoto(entryId, formData);
      setUploadingCount((c) => c - 1);
      if ("error" in result) {
        setError(result.error);
        continue;
      }
      setPhotos((prev) => [...prev, { id: result.id, url: result.url, isCover: prev.length === 0 }]);
    }
  }

  async function handleRemovePhoto(mediaId: string) {
    const wasCover = photos.find((p) => p.id === mediaId)?.isCover ?? false;
    setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    const result = await removeJournalPhoto(entryId, mediaId);
    if ("error" in result) return setError(result.error);
    if (wasCover) setPhotos((prev) => (prev.length > 0 ? prev.map((p, i) => ({ ...p, isCover: i === 0 })) : prev));
  }

  async function handleSetCover(mediaId: string) {
    setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === mediaId })));
    await setJournalCoverPhoto(entryId, mediaId);
  }

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError("Give this entry a title.");
    if (!entryDate) return setError("Choose a date.");
    setSaving(true);

    const formData = new FormData();
    formData.set("title", title);
    formData.set("entry_date", entryDate);
    if (entryTime) formData.set("entry_time", entryTime);
    if (notes) formData.set("notes", notes);

    const [basicsResult, locationResult, connectionsResult, visibilityResult] = await Promise.all([
      saveJournalBasics(entryId, formData),
      saveJournalLocation(entryId, location?.value ?? null),
      saveJournalConnections(entryId, {
        businessIds: businesses.map((b) => b.value),
        productIds: products.map((p) => p.value),
        eventIds: events.map((e) => e.value),
      }),
      updateJournalVisibility(entryId, visibility),
    ]);
    setSaving(false);

    const failed = [basicsResult, locationResult, connectionsResult, visibilityResult].find((r) => "error" in r);
    if (failed && "error" in failed) return setError(failed.error);

    router.push(`/journal/${entryId}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold tracking-tight text-ink">Edit Journal Entry</h1>
        <button type="button" onClick={() => router.push(`/journal/${entryId}`)} className="text-sm font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <div className="mt-5 flex flex-col gap-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <div key={p.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-black/10 bg-mist">
              {p.url && <Image src={p.url} alt="" fill unoptimized sizes="96px" className="object-cover" />}
              {p.isCover && (
                <span className="absolute left-1 top-1 rounded-full bg-findmi px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Cover</span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1 py-0.5">
                {!p.isCover && (
                  <button type="button" onClick={() => handleSetCover(p.id)} className="text-[9px] font-semibold uppercase text-white">
                    Make cover
                  </button>
                )}
                <button type="button" onClick={() => handleRemovePhoto(p.id)} aria-label="Remove photo" className="ml-auto text-[11px] font-bold text-white">
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

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-xl border border-black/10 bg-white px-3.5 text-sm text-ink focus:border-findmi/50 focus:outline-none"
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
            rows={4}
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-findmi/50 focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Location</span>
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
        </div>

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

        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Visibility</span>
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
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="mt-2 flex h-12 items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
