"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Global Media Viewer V1 — a fully generic, reusable full-screen photo
 * viewer. Deliberately knows nothing about Journal, businesses, events,
 * or any FindMi database shape — every caller adapts its own media into
 * this plain shape (see MediaViewerItem below), so this component can be
 * reused by Business/Event/Location/Product/Appearance/My World galleries
 * later without any change here. `caption` exists for future use only —
 * V1 never renders it (see this pass's own note on not inventing a
 * caption system where one doesn't already exist). */
export interface MediaViewerItem {
  id: string;
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  caption?: string | null;
}

export interface MediaViewerProps {
  items: MediaViewerItem[];
  /** Which item the viewer should open on — the caller's responsibility
   * to compute (e.g. "the index of the photo that was tapped within the
   * full, canonically-ordered collection"), never assumed to be 0. */
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Swipe settlement — a deliberate drag past ~22% of the viewer's own
// width, OR a fast flick (even a short one) past this speed, advances
// exactly one photo. Anything smaller snaps back to the current photo.
// One release can only ever move the index by 1 — never further, however
// far or fast the gesture (see this pass's own requirement on that).
const SWIPE_DISTANCE_RATIO = 0.22;
const SWIPE_VELOCITY_THRESHOLD = 0.5; // px/ms, roughly 500px/s
// Resistance applied when dragging past the first/last photo — the image
// still moves a little with the finger (so the gesture doesn't feel
// dead), but far less than 1:1, and always snaps back since there's
// nowhere to settle.
const EDGE_RESISTANCE = 0.35;
const SETTLE_TRANSITION_MS = 220;

/** Journal is the first integration; see each call site for how it adapts
 * its own media into MediaViewerItem[]. This component renders nothing
 * at all until the first time it's opened (no image fetch cost on a page
 * that never opens it), then stays mounted (briefly invisible during a
 * close) so reopening is instant and the close transition can play. */
export default function MediaViewer({ items, initialIndex, open, onOpenChange }: MediaViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, items.length - 1)));
  const [dragPx, setDragPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const trackRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTouchRef = useRef<{ x: number; t: number } | null>(null);
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const settledRef = useRef(false);

  const hasMultiple = items.length > 1;

  useEffect(() => setMounted(true), []);

  // Lazy mount — the heavy DOM (and its images) never exists until the
  // first open; it then stays mounted through later closes so the close
  // fade can play and a reopen is instant, never refetching from scratch.
  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);

  // Reset to the requested photo every time the viewer is (re)opened —
  // never resumes a previous session's position for a fresh open.
  useEffect(() => {
    if (open) {
      setIndex(clamp(initialIndex, 0, Math.max(0, items.length - 1)));
      setDragPx(0);
      setIsDragging(false);
      pendingIndexRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIndex]);

  // Focus + body scroll lock — same inline pattern already used by every
  // other full-screen overlay in this codebase (HamburgerMenu, FollowButton,
  // etc.): capture/restore document.body.style.overflow directly, no shared
  // hook exists to import. Keyboard only ever attaches while actually open.
  useEffect(() => {
    if (!open) return;
    triggerElRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
      else if (hasMultiple && e.key === "ArrowRight") goTo(1);
      else if (hasMultiple && e.key === "ArrowLeft") goTo(-1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasMultiple]);

  // Restore focus to whatever opened the viewer — only once, right as it
  // closes (not on every render), and only if that element still exists.
  useEffect(() => {
    if (!open && triggerElRef.current) {
      triggerElRef.current.focus?.();
      triggerElRef.current = null;
    }
  }, [open]);

  const commitPendingIndex = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (pendingIndexRef.current !== null) {
      setIndex(pendingIndexRef.current);
      pendingIndexRef.current = null;
    }
    setDragPx(0);
    setIsDragging(false);
  }, []);

  // Animate the same settle-and-commit path for a swipe release, an
  // arrow click, or a keyboard arrow — one consistent sliding motion
  // everywhere, never an instant src-swap (see this pass's own
  // requirement on that).
  const goTo = useCallback(
    (direction: 1 | -1) => {
      const width = trackRef.current?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 0);
      const targetIndex = clamp(index + direction, 0, items.length - 1);
      if (targetIndex === index || width === 0) return;
      settledRef.current = false;
      pendingIndexRef.current = targetIndex;
      setIsDragging(false);
      setDragPx(-direction * width);
    },
    [index, items.length]
  );

  function handleTouchStart(e: React.TouchEvent) {
    if (!hasMultiple) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    lastTouchRef.current = { x: t.clientX, t: Date.now() };
    dragAxisRef.current = null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start || !hasMultiple) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (dragAxisRef.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // too small to classify as a gesture yet
      dragAxisRef.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
      if (dragAxisRef.current === "horizontal") setIsDragging(true);
    }
    if (dragAxisRef.current !== "horizontal") return; // vertical/ambiguous — do nothing, never page-scroll

    let trackedDx = dx;
    if (index === 0 && dx > 0) trackedDx = dx * EDGE_RESISTANCE;
    if (index === items.length - 1 && dx < 0) trackedDx = dx * EDGE_RESISTANCE;
    setDragPx(trackedDx);
    lastTouchRef.current = { x: t.clientX, t: Date.now() };
  }

  function handleTouchEnd() {
    const start = touchStartRef.current;
    const last = lastTouchRef.current;
    const wasHorizontalDrag = dragAxisRef.current === "horizontal";
    touchStartRef.current = null;
    dragAxisRef.current = null;
    setIsDragging(false);

    if (!start || !last || !wasHorizontalDrag || !hasMultiple) {
      setDragPx(0);
      return;
    }

    const width = trackRef.current?.clientWidth || window.innerWidth;
    const dx = last.x - start.x;
    const dt = Math.max(1, last.t - start.t);
    const velocity = dx / dt;
    const deliberate = Math.abs(dx) > width * SWIPE_DISTANCE_RATIO || Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD;
    const direction = dx < 0 ? 1 : -1; // swiped left -> next, swiped right -> previous
    const targetIndex = deliberate ? clamp(index + direction, 0, items.length - 1) : index;

    if (targetIndex === index) {
      setDragPx(0); // too small, or already at the edge in that direction — snap back
      return;
    }
    settledRef.current = false;
    pendingIndexRef.current = targetIndex;
    setDragPx(direction * -width);
  }

  function handleBackdropTransitionEnd(e: React.TransitionEvent) {
    if (e.target !== e.currentTarget || e.propertyName !== "opacity") return;
    if (!open) setRendered(false);
  }

  if (!mounted || !rendered) return null;

  const current = items[index];
  const prev = index > 0 ? items[index - 1] : null;
  const next = index < items.length - 1 ? items[index + 1] : null;
  const slots: { item: MediaViewerItem; slot: -1 | 0 | 1 }[] = [
    ...(prev ? [{ item: prev, slot: -1 as const }] : []),
    ...(current ? [{ item: current, slot: 0 as const }] : []),
    ...(next ? [{ item: next, slot: 1 as const }] : []),
  ];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onClick={() => onOpenChange(false)}
      onTransitionEnd={handleBackdropTransitionEnd}
      className={`fixed inset-0 z-[80] bg-black transition-opacity duration-200 ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(false);
        }}
        aria-label="Close photo viewer"
        className="absolute right-2 z-20 flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition active:scale-90"
        style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
      >
        <CloseGlyph className="h-5 w-5" />
      </button>

      {hasMultiple && (
        <div
          className="absolute inset-x-0 z-20 flex justify-center"
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white/90">
            {index + 1} / {items.length}
          </span>
        </div>
      )}

      {hasMultiple && index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goTo(-1);
          }}
          aria-label="Previous photo"
          className="absolute left-2 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:flex"
        >
          <ChevronGlyph className="h-5 w-5 rotate-180" />
        </button>
      )}
      {hasMultiple && index < items.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goTo(1);
          }}
          aria-label="Next photo"
          className="absolute right-2 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 sm:flex"
        >
          <ChevronGlyph className="h-5 w-5" />
        </button>
      )}

      {/* Slide track — only ever 3 mounted slides (previous/current/next)
          regardless of how many photos the gallery has, so opening the
          viewer never fetches more than the current photo plus its two
          immediate neighbors. touch-action: none hands every touch
          gesture on this element entirely to the handlers below — no
          native scroll/pull-to-refresh/pinch can ever fire from it. */}
      <div
        ref={trackRef}
        className="absolute inset-0 overflow-hidden"
        style={{ touchAction: "none" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {slots.map(({ item, slot }) => (
          <MediaSlide
            key={item.id}
            item={item}
            loaded={loadedIds.has(item.id)}
            failed={failedIds.has(item.id)}
            onLoad={() => setLoadedIds((prev) => new Set(prev).add(item.id))}
            onError={() => setFailedIds((prev) => new Set(prev).add(item.id))}
            onTransitionEnd={commitPendingIndex}
            style={{
              transform: `translateX(calc(${slot * 100}% + ${dragPx}px))`,
              transition: isDragging ? "none" : `transform ${SETTLE_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
            }}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}

function MediaSlide({
  item,
  loaded,
  failed,
  onLoad,
  onError,
  onTransitionEnd,
  style,
}: {
  item: MediaViewerItem;
  loaded: boolean;
  failed: boolean;
  onLoad: () => void;
  onError: () => void;
  onTransitionEnd: () => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-4 sm:p-8"
      style={style}
      onTransitionEnd={(e) => {
        if (e.propertyName === "transform") onTransitionEnd();
      }}
    >
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-white/50" onClick={(e) => e.stopPropagation()}>
          <BrokenImageGlyph className="h-10 w-10" />
          <p className="text-xs">Photo unavailable</p>
        </div>
      ) : (
        // Plain <img>, not next/image — deliberately: this is a brand new
        // presentation surface, not a change to the existing Supabase
        // image delivery pipeline (SupabaseImage/`unoptimized` stay
        // exactly as they are everywhere else). An intrinsically-sized
        // <img> (never `fill`) also means its own clickable box matches
        // the real rendered picture, not the full letterboxed slide —
        // so a tap on the dark space AROUND a portrait/landscape photo
        // correctly reaches the backdrop and closes, while a tap on the
        // photo itself (this element) never does.
        <img
          src={item.src}
          alt={item.alt ?? ""}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onLoad={onLoad}
          onError={onError}
          style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", opacity: loaded ? 1 : 0 }}
          className="select-none rounded-sm transition-opacity duration-150"
        />
      )}
      {!loaded && !failed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <SpinnerGlyph className="h-6 w-6 animate-spin text-white/40" />
        </div>
      )}
    </div>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrokenImageGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 16l5-5 3 3 4-4 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4.5l16 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
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
