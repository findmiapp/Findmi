"use client";

import { useRef } from "react";
import Image from "next/image";
import type { JournalPhotoState, JournalUploadBatch } from "./useJournalPhotoUpload";

/** Journal V1 (visual convergence pass) — the shared photo manager for
 * Create Step 1 and Edit: a meaningful large cover preview (once a photo
 * exists) with a compact filmstrip of everything underneath, rather than
 * a row of identical small tiles with no visual lead. Shared between
 * Create and Edit so both get the exact same upload-progress behavior —
 * see useJournalPhotoUpload's own note on why `batch` is real client-side
 * state, never a database poll or one fake tile per pending file.
 *
 * Journal V1.1 — Native File-Picker Fix. Live mobile QA found Create's
 * empty "ADD PHOTOS" state not opening the native picker at all. This
 * component already triggers the file input the correct way (a real
 * `<button type="button">` calling a stable ref's `.click()`, never a
 * wrapping `<label>`), so the trigger mechanism itself was never the
 * difference between Create and Edit — both call through this exact same
 * file. The one real gap: the input was hidden via `className="hidden"`
 * (display:none). This codebase already has a documented, proven fix for
 * exactly this symptom — see MemberImageField.tsx's own "Native
 * File-Picker Boundary Hardening" note: some Android Chrome/WebView
 * versions lose the pending-selection association for a display:none file
 * input, especially when an external Activity (a separate app, e.g.
 * Google Photos) is what hands control back to the tab. The fix there was
 * the same one applied here: `sr-only` (clipped/off-screen, still
 * rendered) instead of `hidden` (display:none, removed from layout).
 * Input value is now also reset defensively before opening the picker (not
 * just after a selection), so no stale browser/WebView state can ever
 * carry over from an earlier attempt. */
export default function JournalPhotoStrip({
  photos,
  batch,
  error,
  onFilesSelected,
  onRemove,
  onSetCover,
}: {
  photos: JournalPhotoState[];
  batch: JournalUploadBatch | null;
  error: string | null;
  onFilesSelected: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onSetCover: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cover = photos.find((p) => p.isCover) ?? photos[0] ?? null;
  // Mobile Picker Repair pass — a batch in flight disables every trigger
  // AND the input itself (not just one or the other): a disabled button
  // can't fire openPicker, and a disabled input silently no-ops `.click()`
  // if something still called it, so there's no path to a second
  // concurrent upload batch while one is already running. Mirrors the
  // same `disabled={isPending}` convention MemberImageField already uses
  // for its own single upload.
  const uploading = Boolean(batch);

  function openPicker() {
    // Defensive reset BEFORE opening the picker too, not only after a
    // selection — guarantees a stale value from an earlier attempt can
    // never block/confuse the next one. See this file's own header note.
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }

  return (
    <div className="flex flex-col gap-2">
      {cover ? (
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          className="group relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-black/10 bg-mist disabled:cursor-not-allowed"
        >
          {cover.url && <Image src={cover.url} alt="" fill unoptimized sizes="(min-width: 640px) 512px, 100vw" className="object-cover" />}
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            Cover
          </span>
          <span className="absolute bottom-2.5 right-2.5 flex h-9 items-center justify-center gap-1.5 rounded-full bg-white/95 px-3.5 text-xs font-bold uppercase tracking-wide text-ink shadow-sm transition group-active:scale-95">
            + Add Photos
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-black/15 text-ink/40 transition hover:border-findmi/50 hover:text-findmi-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="text-3xl leading-none">+</span>
          <span className="text-xs font-bold uppercase tracking-wide">Add Photos</span>
        </button>
      )}

      {(photos.length > 0 || batch) && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p) => (
            <div key={p.id} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-mist">
              {p.url && <Image src={p.url} alt="" fill unoptimized sizes="64px" className="object-cover" />}
              {p.isCover ? (
                <span className="absolute inset-x-0 bottom-0 bg-findmi py-0.5 text-center text-[7px] font-bold uppercase tracking-wide text-white">
                  Cover
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetCover(p.id)}
                  aria-label="Make cover photo"
                  title="Make cover"
                  className="absolute bottom-0 left-0 rounded-tr-lg bg-black/50 px-1 py-0.5 text-[9px] font-bold text-white"
                >
                  ★
                </button>
              )}
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                aria-label="Remove photo"
                className="absolute right-0 top-0 rounded-bl-lg bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white"
              >
                ✕
              </button>
            </div>
          ))}
          {batch && (
            <div className="flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-findmi/30 bg-findmi-50 text-center">
              <span className="text-[11px] font-bold text-ink">
                {batch.completed} of {batch.total}
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-wide text-ink/50">Uploading…</span>
            </div>
          )}
          <button
            type="button"
            onClick={openPicker}
            disabled={uploading}
            aria-label="Add more photos"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/20 text-ink/40 transition hover:border-findmi/50 hover:text-findmi-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="text-xl leading-none">+</span>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Add photos"
        className="sr-only"
        disabled={uploading}
        onChange={(e) => {
          onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
