"use client";

import { memo, useRef, useState } from "react";
import Image from "next/image";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JournalBatchPerf, JournalBatchProgress, JournalPhotoItem } from "./useJournalPhotoUpload";

/** Journal Photo Experience V2 — a sortable grid replacing V1's "big cover
 * + filmstrip" layout. The layout changes to a uniform grid specifically
 * because the product requirement is press-and-drag reordering of the
 * WHOLE set (see useJournalPhotoUpload's own header note) — a mixed-size
 * hero-plus-strip collection can't be drag-sorted cleanly. Tile styling
 * (rounded corners, border, the existing Cover badge treatment, the same
 * Remove button) is carried over unchanged; this is a reflow, not a
 * redesign of the editor around it.
 *
 * Every selected photo is visible the instant it's picked (handleFiles
 * already appended it to `items` before this renders) — the per-tile
 * status badge (small spinner / error+Retry) is the only loading UI;
 * nothing ever covers the photo itself.
 *
 * Mobile QA Repair pass — real-device Android testing found the photo
 * SURFACE itself was the drag activator (dnd-kit listeners + `touch-none`
 * spread across the whole tile), which made ordinary vertical page
 * scrolling over a thumbnail fight the drag sensor instead of scrolling.
 * Drag is now activated ONLY from a small, explicit grip handle in the
 * corner of each tile — the rest of the photo is a completely normal
 * touch surface with no `touch-action` override, so a swipe anywhere else
 * on it scrolls the page exactly like any other image. */
export default function JournalPhotoStrip({
  items,
  error,
  batchProgress,
  batchPerf,
  onDismissBatchPerf,
  onFilesSelected,
  onRemove,
  onRetry,
  onDragReorder,
  onMoveEarlier,
  onMoveLater,
  onMakeCover,
  disabled,
}: {
  items: JournalPhotoItem[];
  error: string | null;
  batchProgress: JournalBatchProgress | null;
  /** Upload Performance V3 — temporary, phone-visible QA readout for the
   * batch that just finished. See useJournalPhotoUpload's own doc comment
   * on JournalBatchPerf — safe to delete this prop and the block below
   * entirely once upload performance is confirmed fixed by real-device QA. */
  batchPerf?: JournalBatchPerf | null;
  onDismissBatchPerf?: () => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onDragReorder: (activeLocalId: string, overLocalId: string) => void;
  onMoveEarlier: (localId: string) => void;
  onMoveLater: (localId: string) => void;
  onMakeCover: (localId: string) => void;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Mobile QA Repair pass — the handle is now the ONLY surface these
  // sensors ever see a pointer/touch-start on, so the long press-delay
  // that used to disambiguate "is this a scroll or a drag?" is no longer
  // needed: touching the handle is already an unambiguous reorder intent.
  // A small movement threshold (not a delay) just avoids a plain tap on
  // the handle being misread as a drag with zero actual movement —
  // "touch grip -> move a few px -> it lifts," not "touch grip -> wait."
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 4 } })
  );

  function openPicker() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onDragReorder(String(active.id), String(over.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const activeItem = activeId ? items.find((it) => it.localId === activeId) : null;

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 ? (
        <button
          type="button"
          onClick={openPicker}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-black/15 text-ink/40 transition hover:border-findmi/50 hover:text-findmi-700"
        >
          <span className="text-3xl leading-none">+</span>
          <span className="text-xs font-bold uppercase tracking-wide">Add Photos</span>
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={items.map((it) => it.localId)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item, index) => (
                <JournalPhotoTile
                  key={item.localId}
                  item={item}
                  isCover={index === 0}
                  canMoveEarlier={index > 0}
                  canMoveLater={index < items.length - 1}
                  menuOpenId={openMenuId}
                  onToggleMenu={setOpenMenuId}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onRemove={onRemove}
                  onRetry={onRetry}
                  onMoveEarlier={onMoveEarlier}
                  onMoveLater={onMoveLater}
                  onMakeCover={onMakeCover}
                />
              ))}
              <button
                type="button"
                onClick={openPicker}
                disabled={disabled}
                aria-label="Add more photos"
                className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-black/20 text-ink/40 transition hover:border-findmi/50 hover:text-findmi-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-xl leading-none">+</span>
              </button>
            </div>
          </SortableContext>

          {/* Drag Visual Feedback — a floating copy that follows the
              pointer/finger in its own layer, the dnd-kit-recommended
              pattern for both an unmistakable "I am now moving this
              photo" cue and smoother performance (the dragged tile's own
              slot just dims in place rather than needing its own live
              transform alongside everyone else's). */}
          <DragOverlay>
            {activeItem ? (
              <div className="aspect-square scale-105 overflow-hidden rounded-xl border-2 border-findmi shadow-xl">
                <Image src={activeItem.previewUrl} alt="" fill unoptimized sizes="160px" className="object-cover" />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {batchProgress && (
        <p className="text-xs font-semibold text-ink/50">
          {batchProgress.completed === 0 ? "Preparing…" : `Uploading ${batchProgress.completed} of ${batchProgress.total}`}
        </p>
      )}

      {/* Upload Performance V3.1 — temporary QA readout, dev-only. No
          signed URLs/tokens/raw errors — just counts and durations. Delete
          this block (and batchPerf/dismissBatchPerf) once upload
          performance is confirmed fixed by real-device QA. Spans are
          earliest-start -> latest-end per stage across the whole batch
          (see useJournalPhotoUpload's own note on why this replaced a
          simpler but misleading single-mark approach) — Prep/Upload/
          Finalize can and do overlap, so they won't sum to Total.
          legacyCount > 0 means that many photos went through the slow
          per-photo HEIC Server Action path instead of direct-to-Storage —
          the single most useful signal here if a batch is unexpectedly
          slow.
          Debug/QA leakage fix — "editor-only" was only ever an intent, not
          an actual gate: every real owner editing their own entry (Add
          Moment included) is "the editor," so this rendered for ordinary
          production users on every real device, which is exactly how the
          literal "QA — 3 photos · Total 0.7s · ..." string ended up
          visible during live mobile QA. process.env.NODE_ENV is the same
          gating pattern already used elsewhere in this codebase (see
          lib/admin/auth.ts, lib/analytics/session.ts) — this stays fully
          visible in local/dev, never renders in the production build. */}
      {batchPerf && process.env.NODE_ENV !== "production" && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-dashed border-black/10 bg-mist px-2.5 py-1.5 text-[11px] text-ink/60">
          <span>
            QA — {batchPerf.count} photo{batchPerf.count === 1 ? "" : "s"} · Total {(batchPerf.totalMs / 1000).toFixed(1)}s · Preview{" "}
            {(batchPerf.previewMs / 1000).toFixed(1)}s · Prep span {(batchPerf.prepSpanMs / 1000).toFixed(1)}s · Upload span{" "}
            {(batchPerf.uploadSpanMs / 1000).toFixed(1)}s · Finalize span {(batchPerf.finalizeSpanMs / 1000).toFixed(1)}s · Compressed{" "}
            {(batchPerf.compressedBytes / (1024 * 1024)).toFixed(1)} MB
            {batchPerf.legacyCount > 0 && ` · ${batchPerf.legacyCount} via HEIC fallback`}
          </span>
          {onDismissBatchPerf && (
            <button type="button" onClick={onDismissBatchPerf} aria-label="Dismiss" className="shrink-0 font-bold text-ink/40">
              ✕
            </button>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="Add photos"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onFilesSelected(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Mobile QA Repair pass — memoized so an unrelated state change elsewhere
 * in the editor (typing in the title field, a sibling tile's own status
 * changing) doesn't force every OTHER tile to re-render too. This only
 * pays off because the handler props below are themselves stable
 * (useCallback'd in useJournalPhotoUpload) and `item` keeps the same
 * object reference for every tile untouched by a given state update (see
 * that hook's own updateItems) — React's default shallow prop comparison
 * is enough, no custom comparator needed. */
const JournalPhotoTile = memo(function JournalPhotoTile({
  item,
  isCover,
  canMoveEarlier,
  canMoveLater,
  menuOpenId,
  onToggleMenu,
  onCloseMenu,
  onRemove,
  onRetry,
  onMoveEarlier,
  onMoveLater,
  onMakeCover,
}: {
  item: JournalPhotoItem;
  isCover: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  menuOpenId: string | null;
  onToggleMenu: (localId: string) => void;
  onCloseMenu: () => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
  onMoveEarlier: (localId: string) => void;
  onMoveLater: (localId: string) => void;
  onMakeCover: (localId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.localId });
  const isBusy = item.status === "preparing" || item.status === "uploading" || item.status === "saving";
  const menuOpen = menuOpenId === item.localId;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative aspect-square overflow-hidden rounded-xl border border-black/10 bg-mist ${isDragging ? "opacity-30" : ""}`}
    >
      {/* The photo itself is a normal, un-intercepted touch surface — no
          drag listeners, no touch-action override. A vertical swipe
          anywhere on it scrolls the page like any other image. */}
      <Image src={item.previewUrl} alt="" fill unoptimized sizes="(min-width: 640px) 160px, 120px" className="object-cover" />

      {/* Drag handle — the ONLY element wired to dnd-kit's listeners, and
          the only one that disables native touch gestures (touch-none),
          scoped to this small corner grip rather than the whole tile. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="absolute left-1 top-1 flex h-6 w-6 touch-none items-center justify-center rounded-full bg-black/55 text-white active:scale-95"
      >
        <GripGlyph className="h-3.5 w-3.5" />
      </button>

      {isCover && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-findmi py-0.5 text-center text-[7px] font-bold uppercase tracking-wide text-white">
          Cover
        </span>
      )}

      {isBusy && (
        <span className="pointer-events-none absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55">
          <SpinnerGlyph className="h-2.5 w-2.5 animate-spin text-white" />
        </span>
      )}

      {item.status === "error" && (
        <button
          type="button"
          onClick={() => onRetry(item.localId)}
          title={item.errorMessage}
          className="absolute inset-x-0 bottom-0 bg-red-600/90 py-1 text-center text-[9px] font-bold uppercase tracking-wide text-white"
        >
          Retry
        </button>
      )}

      <button
        type="button"
        onClick={() => onRemove(item.localId)}
        aria-label="Remove photo"
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[10px] font-bold text-white"
      >
        ✕
      </button>

      <div className="absolute bottom-1 right-1">
        <button
          type="button"
          onClick={() => onToggleMenu(item.localId)}
          aria-label="Photo options"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[9px] font-bold leading-none text-white"
        >
          •••
        </button>
        {menuOpen && (
          <>
            {/* Backdrop — closes the menu on an outside tap without
                building a global click-outside listener. */}
            <div className="fixed inset-0 z-10" onClick={onCloseMenu} />
            <div className="absolute bottom-6 right-0 z-20 flex w-32 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg">
              {!isCover && (
                <PhotoMenuItem
                  label="Make Cover"
                  onClick={() => {
                    onMakeCover(item.localId);
                    onCloseMenu();
                  }}
                />
              )}
              <PhotoMenuItem
                label="Move Earlier"
                disabled={!canMoveEarlier}
                onClick={() => {
                  onMoveEarlier(item.localId);
                  onCloseMenu();
                }}
              />
              <PhotoMenuItem
                label="Move Later"
                disabled={!canMoveLater}
                onClick={() => {
                  onMoveLater(item.localId);
                  onCloseMenu();
                }}
              />
              <PhotoMenuItem
                label="Remove"
                onClick={() => {
                  onRemove(item.localId);
                  onCloseMenu();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
});

function PhotoMenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-2 text-left text-[11px] font-semibold text-ink transition hover:bg-findmi-50 disabled:cursor-not-allowed disabled:text-ink/30 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}

function SpinnerGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** A plain 2x3 dot grip — the standard "drag handle" affordance, scaled to
 * a small touch target. No existing icon set in this codebase to reuse
 * (every other glyph in Journal components is its own local inline SVG —
 * see e.g. this file's own SpinnerGlyph), so this follows that convention
 * rather than introducing an icon library for one glyph. */
function GripGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
