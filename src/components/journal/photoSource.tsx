"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import MomentSheet from "./MomentSheet";

/** Moment photo capture — the two real-world ways to add photos, offered
 * the moment someone adds photos to a Moment, wherever the composer was
 * opened from (/moments, global "+", a Business, Location, Event, the
 * Manager…), because every one of them renders the same photo strip:
 *
 *   Take Photo          a file input with capture="environment" — opens
 *                       the device camera directly where the browser /
 *                       device supports it.
 *   Choose From Photos  a multiple-selection image file input — the photo
 *                       library, multiple selection where supported.
 *
 * Progressive enhancement: the camera choice is offered only on a touch
 * (coarse-pointer) device. On desktop, adding photos opens the ordinary
 * file picker exactly as before — `capture` would only produce a second,
 * identical file dialog there. Both inputs hand their files to the SAME
 * existing pipeline (`onFiles` → useJournalPhotoUpload.handleFiles), so a
 * captured photo joins the Moment and its draft persistence immediately. */

export const PHOTO_SOURCE_LABELS = { camera: "Take Photo", library: "Choose From Photos" } as const;

/** True on a touch-first device (after mount; false during SSR). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const on = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return coarse;
}

export function usePhotoSource(onFiles: (files: FileList | null) => void, { disabled = false }: { disabled?: boolean } = {}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const canCapture = useCoarsePointer();
  const open = (ref: RefObject<HTMLInputElement | null>) => {
    if (disabled || !ref.current) return;
    ref.current.value = "";
    ref.current.click();
  };
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
    e.target.value = "";
  };
  const inputs: ReactNode = (
    <>
      <input ref={libraryRef} type="file" accept="image/*" multiple aria-label="Add photos" className="sr-only" disabled={disabled} onChange={handle} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" aria-label="Take a photo" className="sr-only" disabled={disabled} onChange={handle} />
    </>
  );
  return { inputs, canCapture, takePhoto: () => open(cameraRef), choosePhotos: () => open(libraryRef) };
}

/** The two choices as compact action-menu rows (icon · label · one quiet
 * line) — the native "Add Photos" menu, never a permanent block of the
 * composer. Used inside the "Add Photos" sheet and the section sheet. */
export function PhotoSourceMenu({ takePhoto, choosePhotos, disabled }: { takePhoto: () => void; choosePhotos: () => void; disabled?: boolean }) {
  const row = "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition hover:bg-black/[0.03] active:bg-black/[0.05] disabled:opacity-60";
  return (
    <ul className="flex flex-col divide-y divide-black/[0.06]">
      <li>
        <button type="button" onClick={takePhoto} disabled={disabled} className={row}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
            <CameraGlyph className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{PHOTO_SOURCE_LABELS.camera}</span>
            <span className="block text-xs text-ink/50">Open your camera</span>
          </span>
        </button>
      </li>
      <li>
        <button type="button" onClick={choosePhotos} disabled={disabled} className={row}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
            <LibraryGlyph className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{PHOTO_SOURCE_LABELS.library}</span>
            <span className="block text-xs text-ink/50">Pick one or more from your library</span>
          </span>
        </button>
      </li>
    </ul>
  );
}

/** "Add Photos" as a small bottom sheet (phones/tablets) opened from the
 * photo strip's own add affordances — the empty "Add Photos" area or the
 * "+" tile. The photo grid stays the primary UI. */
export function PhotoSourceSheet({ onClose, takePhoto, choosePhotos }: { onClose: () => void; takePhoto: () => void; choosePhotos: () => void }) {
  return (
    <MomentSheet title="Add Photos" onClose={onClose}>
      <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <PhotoSourceMenu
        takePhoto={() => {
          onClose();
          takePhoto();
        }}
        choosePhotos={() => {
          onClose();
          choosePhotos();
        }}
      />
      </div>
    </MomentSheet>
  );
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12.8" r="3.3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** The canonical Moments photo glyph (NavIcon "moments"), inlined so this
 * client module stays dependency-light. */
function LibraryGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="5" width="17" height="14.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 16.5l4.6-4.2a1.2 1.2 0 011.6 0l3.3 3 2.2-2a1.2 1.2 0 011.6 0l3.7 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="15.5" cy="9.6" r="1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
