"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { JournalEntryWithRelations } from "@/lib/journal";
import type { JournalSearchResult } from "./JournalSearchSelect";
import JournalConnectionsPicker from "./JournalConnectionsPicker";
import JournalLocationPicker, { type JournalManualLocationState } from "./JournalLocationPicker";
import JournalPhotoStrip from "./JournalPhotoStrip";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import { saveJournalBasics, saveJournalLocation, saveJournalConnections, updateJournalVisibility } from "@/app/(public)/my-world/journal/actions";

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

  const { photos, batch, error: photoError, handleFiles, handleRemove, handleSetCover } = useJournalPhotoUpload(
    entry.media.map((m) => ({ id: m.id, url: m.url ?? "", isCover: m.is_cover })),
    async () => entryId
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
  const [visibility, setVisibility] = useState<"private" | "public">(entry.entry.visibility);

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
    <div className="mx-auto max-w-lg px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold tracking-tight text-ink">Edit Journal Entry</h1>
        <button type="button" onClick={() => router.push(`/journal/${entryId}`)} className="text-xs font-semibold text-ink/50 hover:text-ink">
          Cancel
        </button>
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <EditSection label="Photos">
        <JournalPhotoStrip photos={photos} batch={batch} error={photoError} onFilesSelected={handleFiles} onRemove={handleRemove} onSetCover={handleSetCover} />
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
        <JournalLocationPicker location={location} onLocationChange={setLocation} manual={manualLocation} onManualChange={setManualLocation} />
      </EditSection>

      <EditSection label="Connections">
        <JournalConnectionsPicker
          businesses={businesses}
          products={products}
          events={events}
          onAddBusiness={(r) => setBusinesses((prev) => [...prev, r])}
          onRemoveBusiness={(id) => setBusinesses((prev) => prev.filter((r) => r.value !== id))}
          onAddProduct={(r) => setProducts((prev) => [...prev, r])}
          onRemoveProduct={(id) => setProducts((prev) => prev.filter((r) => r.value !== id))}
          onAddEvent={(r) => setEvents((prev) => [...prev, r])}
          onRemoveEvent={(id) => setEvents((prev) => prev.filter((r) => r.value !== id))}
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
      </EditSection>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-findmi text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
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
