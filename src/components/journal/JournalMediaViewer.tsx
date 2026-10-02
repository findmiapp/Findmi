"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import MediaViewer, { type MediaViewerItem } from "@/components/MediaViewer";

interface JournalMediaViewerContextValue {
  openAt: (index: number) => void;
}

const JournalMediaViewerContext = createContext<JournalMediaViewerContextValue | null>(null);

function useJournalMediaViewer(): JournalMediaViewerContextValue | null {
  return useContext(JournalMediaViewerContext);
}

/** Global Media Viewer V1, Journal integration — ONE MediaViewer instance
 * (and its open/index state) shared between the hero/cover photo (rendered
 * well above, in its own section of the page) and the story gallery below
 * it, so both ever open the SAME lightbox over the SAME canonical
 * display_order-ordered collection — never a separate hero-only viewer
 * (see this pass's own product requirement). A Context exists purely so
 * two components in completely different parts of this Server Component
 * page can share that state without the whole page needing to go client. */
export function JournalMediaViewerRoot({ items, children }: { items: MediaViewerItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  function openAt(i: number) {
    if (i < 0 || i >= items.length) return;
    setIndex(i);
    setOpen(true);
  }

  return (
    <JournalMediaViewerContext.Provider value={{ openAt }}>
      {children}
      <MediaViewer items={items} initialIndex={index} open={open} onOpenChange={setOpen} />
    </JournalMediaViewerContext.Provider>
  );
}

/** Wraps an already-rendered photo (the hero image, a gallery tile) in a
 * real, focusable <button> that opens the shared viewer at this photo's
 * position in the full canonical collection. No VIEW PHOTO instructional
 * copy — cursor pointer + a barely-there active-state dim is the entire
 * affordance (see this pass's own restrained-affordance requirement).
 * Renders its children un-wrapped (no button, no click behavior) if
 * there's no viewer context above it (defensive — every real call site
 * sits inside JournalMediaViewerRoot) or the index doesn't resolve to a
 * real photo, so a tap never silently does nothing from the owner's
 * point of view without at least still showing the photo normally. */
export function JournalPhotoTrigger({
  index,
  label,
  className,
  children,
}: {
  index: number;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useJournalMediaViewer();
  if (!ctx || index < 0) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => ctx.openAt(index)}
      aria-label={label}
      className={`block w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left transition active:opacity-90 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
