"use client";

import Link from "next/link";
import type { CSSProperties, Ref } from "react";
import SupabaseImage from "@/components/SupabaseImage";

// The selected result's floating preview — anchored to its marker on the
// map (DiscoveryMapCanvas positions it; selected-label.ts decides where).
// Same card language as the result cards (white, rounded-2xl, LIVE in
// words, the Findmi gradient + initial when there's no image). The WHOLE
// card is one link to the result's public page; Close sits above it.

export interface MapPreview {
  /** The marker this preview belongs to (MapFeature.id). */
  featureId: string;
  /** Public destination; null while the result is still loading. */
  href: string | null;
  title: string;
  /** Entity type in words: Event, Pop-Up, Place, Brand… */
  kind: string;
  image: string | null;
  logo: string | null;
  /** Short state ("Starts 3 PM", "Ends 9 PM", a category). */
  status: string | null;
  live: boolean;
  /** When / where context ("Sat, Nov 7 · 3–9 PM"). */
  detail: string | null;
  /** Place or Brand line. */
  subtitle: string | null;
  /** Other results at the same marker. */
  more: number;
}

export default function MapFloatingPreview({
  preview,
  side,
  caretX,
  style,
  onClose,
  cardRef,
  compactMedia = false,
}: {
  preview: MapPreview;
  side: "above" | "below";
  caretX: number;
  style: CSSProperties;
  onClose: () => void;
  cardRef?: Ref<HTMLDivElement>;
  /** A short map: a shorter cover so the card still fits. */
  compactMedia?: boolean;
}) {
  const p = preview;
  const label = [p.kind, p.title].filter(Boolean).join(": ");
  return (
    <div ref={cardRef} data-map-preview={p.featureId} style={style} className="pointer-events-auto absolute z-20">
      {/* caret pointing at the pin */}
      <span
        aria-hidden
        style={{ left: caretX - 7 }}
        className={`absolute h-3.5 w-3.5 rotate-45 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.05)] ${side === "above" ? "-bottom-[7px]" : "-top-[7px]"}`}
      />
      <article className="relative overflow-hidden rounded-2xl bg-white shadow-[0_14px_36px_rgba(0,0,0,0.22)] ring-1 ring-black/5 transition hover:ring-findmi/50">
        <div className={`relative w-full overflow-hidden bg-black/5 ${compactMedia ? "h-20" : "h-[7.5rem]"}`}>
          {p.image ? (
            <SupabaseImage src={p.image} alt="" fill sizes="300px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
              {p.logo ? (
                <span className="relative h-14 w-14 overflow-hidden rounded-xl bg-white p-1.5">
                  <SupabaseImage src={p.logo} alt="" fill sizes="56px" className="object-contain p-1.5" />
                </span>
              ) : (
                <span className="font-display text-3xl font-bold text-white/30">{p.title.slice(0, 1)}</span>
              )}
            </div>
          )}
          {p.image && p.logo && p.logo !== p.image && (
            <span className="absolute bottom-2 left-2 h-8 w-8 overflow-hidden rounded-lg border border-black/[0.06] bg-white">
              <SupabaseImage src={p.logo} alt="" fill sizes="32px" className="object-contain p-0.5" />
            </span>
          )}
          {p.live && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
              Live
              {p.status && p.status !== "LIVE" && <span className="font-semibold normal-case tracking-normal">· {p.status}</span>}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3 pr-3.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {p.kind && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-findmi-700">{p.kind}</span>}
            {!p.live && p.status && <span className="truncate rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold text-findmi-700">{p.status}</span>}
          </div>
          {p.href ? (
            <Link href={p.href} aria-label={label} className="min-w-0 after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-findmi">
              <span className="line-clamp-3 break-words font-display text-base font-bold leading-snug text-ink">{p.title}</span>
            </Link>
          ) : (
            <span className="line-clamp-3 break-words font-display text-base font-bold leading-snug text-ink">{p.title}</span>
          )}
          {p.detail && <p className="truncate text-xs font-semibold text-ink/65">{p.detail}</p>}
          {p.subtitle && <p className="truncate text-xs text-ink/55">{p.subtitle}</p>}
          {p.more > 0 && <p className="text-[11px] font-semibold text-findmi-700">+{p.more} more here</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close map preview"
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-ink/70 shadow-sm hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </article>
    </div>
  );
}
