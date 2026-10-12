"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MediaViewerItem } from "@/components/MediaViewer";
import JournalPhotoGallery, { type JournalGalleryItem } from "./JournalPhotoGallery";
import { JournalMediaViewerRoot } from "./JournalMediaViewer";
import {
  momentCategoryLabel,
  momentGalleryCategories,
  momentGalleryPhotos,
  showMomentFilter,
  type MomentGalleryPhoto,
  type MomentGallerySection,
} from "@/lib/moment-gallery";

export interface MomentGalleryMedia extends MomentGalleryPhoto {
  /** Card-size (800px) display URL. */
  url: string | null;
  /** Large (1600px) display URL for the anchor/single photo. */
  largeUrl: string | null;
  /** Full-size URL for the viewer; null when it can't be opened. */
  src: string | null;
  caption: string | null;
}

/** Public Moment continuous gallery (Pass A) — the Moment's photos as ONE
 * continuous story in their stored display order (no section headings, no
 * carousels), each categorized photo carrying a small badge, plus a quiet
 * filter strip ("All" + one chip per section that has photos) that narrows
 * the same editorial grid to one section. Filter state is local only — no
 * URL/hash. The viewer always walks exactly the set on screen: a nested
 * JournalMediaViewerRoot (re-keyed per filter) scopes Next/Prev to it. */
export default function JournalMomentGallery({
  photos,
  sections,
  title,
  adminToolbar,
  addMomentHref = null,
}: {
  photos: MomentGalleryMedia[];
  sections: MomentGallerySection[];
  /** Viewer alt text (the Moment's title). */
  title: string;
  /** The mobile Admin toolbar is showing — the fixed mobile header sits
   * 1.75rem lower, so the sticky strip must too. */
  adminToolbar: boolean;
  /** The existing Add Moment entry point for this Moment's source Event
   * (/event/<slug>/journal), or null when there's no legitimate source to
   * scope a new Moment to — then no end-of-stream CTA renders. */
  addMomentHref?: string | null;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [stickyTop, setStickyTop] = useState<number | null>(null);

  const categories = momentGalleryCategories(sections, photos);
  const hasFilter = showMomentFilter(categories, photos);

  // The strip sticks directly under whichever site header is showing. Its
  // classes carry the known offsets (mobile h-14 header, +1.75rem with the
  // Admin toolbar, desktop nav) for the first paint; once mounted, the
  // real header is measured, since the desktop nav's height varies with
  // its contents (e.g. a wrapping call-to-action).
  useEffect(() => {
    if (!hasFilter) return;
    const measure = () => {
      let top = 0;
      for (const h of document.querySelectorAll("header")) {
        const cs = getComputedStyle(h);
        if (cs.display === "none" || (cs.position !== "fixed" && cs.position !== "sticky")) continue;
        top = Math.max(top, (parseFloat(cs.top) || 0) + h.getBoundingClientRect().height);
      }
      setStickyTop(top > 0 ? top : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    document.querySelectorAll("header").forEach((h) => ro.observe(h));
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hasFilter]);
  const active = hasFilter ? (categories.find((c) => c.id === filter) ?? null) : null;
  const visible = momentGalleryPhotos(photos, active?.id ?? null);
  if (momentGalleryPhotos(photos, null).length === 0) return null;

  const badgeBySection = new Map(sections.map((s) => [s.id, momentCategoryLabel(s)]));
  const viewerItems: MediaViewerItem[] = [];
  const items: JournalGalleryItem[] = visible.map((p) => {
    let mediaIndex = -1;
    if (p.src) {
      mediaIndex = viewerItems.length;
      viewerItems.push({ id: p.id, src: p.src, alt: title, caption: p.caption });
    }
    return {
      id: p.id,
      url: p.url,
      largeUrl: p.largeUrl,
      caption: p.caption,
      badge: p.sectionId ? (badgeBySection.get(p.sectionId) ?? null) : null,
      mediaIndex,
    };
  });

  function choose(id: string | null) {
    setFilter(id);
    // Switching while the strip is stuck: bring the top of the (new)
    // stream back up under the strip rather than leaving the reader
    // mid-way through a now-different list.
    const root = rootRef.current;
    const strip = stripRef.current;
    if (!root || !strip) return;
    const stickyTop = parseFloat(getComputedStyle(strip).top) || 0;
    const top = root.getBoundingClientRect().top;
    if (top < stickyTop) window.scrollTo({ top: window.scrollY + top - stickyTop });
  }

  return (
    <section ref={rootRef} id="moment-photos" className="mt-6 scroll-mt-20">
      {hasFilter && (
        <div
          ref={stripRef}
          style={stickyTop !== null ? { top: stickyTop } : undefined}
          className={`sticky z-20 -mx-4 mb-3 bg-paper/95 px-4 py-1.5 backdrop-blur sm:mx-0 sm:px-0 md:top-[93px] ${adminToolbar ? "top-[calc(3.5rem+1.75rem)]" : "top-14"}`}
        >
          <div role="group" aria-label="Filter photos" className="-mx-0.5 flex gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip label="All" selected={active === null} onClick={() => choose(null)} />
            {categories.map((c) => (
              <FilterChip key={c.id} label={c.label} selected={active?.id === c.id} onClick={() => choose(c.id)} />
            ))}
          </div>
        </div>
      )}
      {active?.notes && <p className="mb-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-ink/70">{active.notes}</p>}
      <JournalMediaViewerRoot key={active?.id ?? "all"} items={viewerItems}>
        <JournalPhotoGallery items={items} />
      </JournalMediaViewerRoot>
      {/* The natural end of whichever stream is showing — All or the
          selected category — since it follows the filtered grid itself. */}
      {addMomentHref && (
        <Link
          href={addMomentHref}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-ink/85 transition hover:border-black/20"
        >
          <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-findmi text-white">
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          Add Your Moment
        </Link>
      )}
    </section>
  );
}

function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-findmi ${
        selected ? "border-findmi/40 bg-findmi-50 text-findmi-700" : "border-black/10 bg-white text-ink/70 hover:border-black/20 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
