"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { JournalPhotoItem } from "./useJournalPhotoUpload";

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
 * nothing ever covers the photo itself. */
export default function JournalPhotoStrip({
  items,
  error,
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
  // Touch-friendly activation constraints — a short tap/scroll gesture
  // must never accidentally start a drag. PointerSensor (mouse/trackpad)
  // needs a small movement threshold; TouchSensor needs a short press
  // delay plus a movement tolerance, the standard dnd-kit pattern for
  // "press and drag" without fighting normal page scroll.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  function openPicker() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onDragReorder(String(active.id), String(over.id));
  }

  const completedCount = items.filter((it) => it.status === "complete").length;
  const activeCount = items.length - completedCount - items.filter((it) => it.status === "error").length;
  const isUploadingAny = items.some((it) => it.status === "uploading" || it.status === "saving");

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((it) => it.localId)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((item, index) => (
                <JournalPhotoTile
                  key={item.localId}
                  item={item}
                  isCover={index === 0}
                  canMoveEarlier={index > 0}
                  canMoveLater={index < items.length - 1}
                  menuOpen={openMenuId === item.localId}
                  onToggleMenu={() => setOpenMenuId((prev) => (prev === item.localId ? null : item.localId))}
                  onCloseMenu={() => setOpenMenuId(null)}
                  onRemove={() => onRemove(item.localId)}
                  onRetry={() => onRetry(item.localId)}
                  onMoveEarlier={() => onMoveEarlier(item.localId)}
                  onMoveLater={() => onMoveLater(item.localId)}
                  onMakeCover={() => onMakeCover(item.localId)}
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
        </DndContext>
      )}

      {activeCount > 0 && (
        <p className="text-xs font-semibold text-ink/50">
          {completedCount === 0 && !isUploadingAny ? "Preparing…" : `Uploading ${completedCount} of ${items.length}`}
        </p>
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

function JournalPhotoTile({
  item,
  isCover,
  canMoveEarlier,
  canMoveLater,
  menuOpen,
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
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onMakeCover: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.localId });
  const isBusy = item.status === "preparing" || item.status === "uploading" || item.status === "saving";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative aspect-square touch-none overflow-hidden rounded-xl border border-black/10 bg-mist ${isDragging ? "z-10 opacity-80 ring-2 ring-findmi" : ""}`}
    >
      {/* Drag handle is the photo itself (press + drag), scoped away from
          the Remove/options buttons below so those stay independently
          tappable without starting a drag. */}
      <div {...attributes} {...listeners} className="absolute inset-0 cursor-grab active:cursor-grabbing">
        <Image src={item.previewUrl} alt="" fill unoptimized sizes="(min-width: 640px) 160px, 120px" className="pointer-events-none object-cover" />
      </div>

      {isCover && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-findmi py-0.5 text-center text-[7px] font-bold uppercase tracking-wide text-white">
          Cover
        </span>
      )}

      {isBusy && (
        <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55">
          <SpinnerGlyph className="h-2.5 w-2.5 animate-spin text-white" />
        </span>
      )}

      {item.status === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute inset-x-0 bottom-0 bg-red-600/90 py-1 text-center text-[9px] font-bold uppercase tracking-wide text-white"
        >
          Retry
        </button>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[10px] font-bold text-white"
      >
        ✕
      </button>

      <div className="absolute bottom-1 right-1">
        <button
          type="button"
          onClick={onToggleMenu}
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
                    onMakeCover();
                    onCloseMenu();
                  }}
                />
              )}
              <PhotoMenuItem
                label="Move Earlier"
                disabled={!canMoveEarlier}
                onClick={() => {
                  onMoveEarlier();
                  onCloseMenu();
                }}
              />
              <PhotoMenuItem
                label="Move Later"
                disabled={!canMoveLater}
                onClick={() => {
                  onMoveLater();
                  onCloseMenu();
                }}
              />
              <PhotoMenuItem
                label="Remove"
                onClick={() => {
                  onRemove();
                  onCloseMenu();
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

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
