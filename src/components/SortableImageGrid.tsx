"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** A sortable photo grid: the visual + reorder half of a gallery editor.
 * The caller owns the list (and whatever it saves); this only reports
 * "move index A to index B" and "remove index i".
 *
 * Interaction follows the Android-tested pattern from
 * components/journal/JournalPhotoStrip.tsx: ONLY the small grip handle is
 * wired to the drag sensors and only it disables native touch gestures
 * (touch-none). The photo itself is an ordinary touch surface, so a swipe
 * anywhere else on a tile scrolls the page. A 4px movement threshold (not a
 * press delay) keeps a plain tap on the grip from counting as a drag.
 * dnd-kit's auto-scroll (on by default) scrolls the page while dragging near
 * an edge, for long galleries.
 *
 * Dragging is never the only way: every photo has a Move menu (Move to
 * Front / Earlier / Later / to End, Remove), the grip also works from the
 * keyboard (Space to lift, arrows to move, Space to drop, Escape to cancel),
 * and every move is announced to screen readers with its new position. */

export interface SortableImageItem {
  /** Stable for the item's lifetime — never its index. */
  id: string;
  src: string;
}

const POSITION = (i: number, total: number) => `position ${i + 1} of ${total}`;

export default function SortableImageGrid({
  items,
  onMove,
  onRemove,
  itemNoun = "Photo",
  trailing,
}: {
  items: SortableImageItem[];
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  itemNoun?: string;
  /** Rendered as the grid's last cell (e.g. an "add" tile). */
  trailing?: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = items.map((it) => it.id);
  const total = items.length;
  const indexOf = (id: UniqueIdentifier) => ids.indexOf(String(id));
  const noun = itemNoun.toLowerCase();

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${noun} at ${POSITION(indexOf(active.id), total)}.`,
    onDragOver: ({ active, over }) => (over ? `${itemNoun} would move to ${POSITION(indexOf(over.id), total)}.` : `${itemNoun} is no longer over a position.`),
    onDragEnd: ({ active, over }) =>
      over ? `${itemNoun} dropped at ${POSITION(indexOf(over.id), total)}.` : `${itemNoun} dropped back at ${POSITION(indexOf(active.id), total)}.`,
    onDragCancel: ({ active }) => `Move cancelled. ${itemNoun} stays at ${POSITION(indexOf(active.id), total)}.`,
  };

  function handleDragStart(event: DragStartEvent) {
    setOpenMenuId(null);
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  }

  /** A Move-menu action: apply it, then say where the photo ended up (the
   * drag announcements above only cover dragging). */
  function menuMove(from: number, to: number) {
    setOpenMenuId(null);
    if (to === from || to < 0 || to >= total) return;
    onMove(from, to);
    setAnnouncement(`${itemNoun} moved to ${POSITION(to, total)}.`);
  }

  function menuRemove(index: number) {
    setOpenMenuId(null);
    onRemove(index);
    setAnnouncement(`${itemNoun} removed. ${total - 1} left.`);
  }

  const activeItem = activeId ? items.find((it) => it.id === activeId) : null;

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: `To reorder, press Space or Enter to pick up the ${noun}, use the arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel. Each ${noun} also has an Options menu with Move actions.`,
          },
        }}
      >
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`${itemNoun}s, in display order`}>
            {items.map((item, index) => (
              <SortableTile
                key={item.id}
                item={item}
                index={index}
                total={total}
                itemNoun={itemNoun}
                menuOpen={openMenuId === item.id}
                onToggleMenu={() => setOpenMenuId((cur) => (cur === item.id ? null : item.id))}
                onCloseMenu={() => setOpenMenuId(null)}
                onMoveTo={(to) => menuMove(index, to)}
                onRemove={() => menuRemove(index)}
              />
            ))}
            {trailing && <li className="aspect-square">{trailing}</li>}
          </ul>
        </SortableContext>

        {/* A floating copy follows the finger/pointer; the tile's own slot
            dims in place (same as JournalPhotoStrip). */}
        <DragOverlay>
          {activeItem ? (
            <div className="aspect-square scale-105 overflow-hidden rounded-xl border-2 border-findmi bg-mist shadow-xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- preview only, a live Storage URL */}
              <img src={activeItem.src} alt="" className="h-full w-full object-cover" />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>
    </div>
  );
}

function SortableTile({
  item,
  index,
  total,
  itemNoun,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onMoveTo,
  onRemove,
}: {
  item: SortableImageItem;
  index: number;
  total: number;
  itemNoun: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onMoveTo: (to: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const label = `${itemNoun} ${index + 1} of ${total}`;
  const first = index === 0;
  const last = index === total - 1;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative aspect-square overflow-hidden rounded-xl border border-black/10 bg-mist ${isDragging ? "opacity-30" : ""}`}
    >
      {/* The photo is a normal touch surface — no drag listeners, no
          touch-action override — so swiping over it scrolls the page. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- preview only, a live Storage URL */}
      <img src={item.src} alt={label} loading="lazy" className="h-full w-full object-cover" />

      {/* Drag handle — the ONLY element given the drag listeners and the
          only one with touch-none. 40px hit area, smaller visible chip. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${label}`}
        className="absolute left-0 top-0 flex h-10 w-10 cursor-grab touch-none items-center justify-center rounded-br-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi active:cursor-grabbing"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
          <GripGlyph className="h-4 w-4" />
        </span>
      </button>

      {/* Options — Move actions and Remove, so dragging is never required. */}
      <button
        type="button"
        ref={menuButtonRef}
        onClick={onToggleMenu}
        aria-label={`Options for ${label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-bl-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-[11px] font-bold leading-none text-white">•••</span>
      </button>

      {/* Visible position — the saved display order. */}
      <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/95 px-1.5 text-[11px] font-bold text-primary shadow-sm">
        {index + 1}
      </span>

      {menuOpen && (
        <MenuPopover anchorRef={menuButtonRef} onClose={onCloseMenu} label={`Options for ${label}`}>
          <MenuItem label="Move to Front" disabled={first} onClick={() => onMoveTo(0)} />
          <MenuItem label="Move Earlier" disabled={first} onClick={() => onMoveTo(index - 1)} />
          <MenuItem label="Move Later" disabled={last} onClick={() => onMoveTo(index + 1)} />
          <MenuItem label="Move to End" disabled={last} onClick={() => onMoveTo(total - 1)} />
          <MenuItem label="Remove" danger onClick={onRemove} />
        </MenuPopover>
      )}
    </li>
  );
}

const MENU_VIEWPORT_MARGIN = 8;

/** Same approach as JournalPhotoStrip's photo menu: rendered into
 * document.body (a tile's overflow-hidden would clip it), fixed next to its
 * button and clamped inside the viewport, closed on outside tap, scroll,
 * resize or Escape. Focus moves into the menu on open and back to its
 * button on close. */
function MenuPopover({ anchorRef, onClose, label, children }: { anchorRef: RefObject<HTMLButtonElement | null>; onClose: () => void; label: string; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (anchor && menu) {
      const a = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(MENU_VIEWPORT_MARGIN, Math.min(a.right - width, viewportWidth - width - MENU_VIEWPORT_MARGIN));
      const below = a.bottom + 4;
      const top = below + height <= viewportHeight - MENU_VIEWPORT_MARGIN ? below : Math.max(MENU_VIEWPORT_MARGIN, a.top - 4 - height);
      setPosition({ left, top });
    }
    const close = () => onCloseRef.current();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const anchor = anchorRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      anchor?.focus({ preventScroll: true });
    };
  }, [anchorRef]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={label}
        style={position ?? { left: 0, top: 0, visibility: "hidden" }}
        className="fixed z-50 flex w-48 flex-col overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-lg"
      >
        {children}
      </div>
    </>,
    document.body
  );
}

function MenuItem({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-10 px-4 py-2 text-left text-body font-semibold transition hover:bg-findmi-50 focus-visible:bg-findmi-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink/30 disabled:hover:bg-transparent ${
        danger ? "border-t border-black/[0.06] text-red-600" : "text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function GripGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
