"use client";

import Link from "next/link";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import type { TrackEventPayload } from "@/lib/analytics/track";

export default function Section({
  title,
  subtitle,
  eyebrow,
  viewAllHref,
  children,
  className = "py-6",
  impressionPayload,
}: {
  title: string;
  subtitle?: string;
  /** Consumer Discovery Homepage V2 — an optional small label above the
   * title, for the rare section that should read as a discovery moment
   * rather than a plain row (e.g. Brands We Love). Every existing caller
   * omits this and renders exactly as before. */
  eyebrow?: string;
  viewAllHref?: string;
  children: React.ReactNode;
  /** Replaces (never appends to) the default "py-6" outer vertical
   * rhythm — a plain string swap avoids the usual Tailwind class-order
   * footgun of trying to override py-6 by appending a second py-*
   * utility. Every existing caller omits this and keeps today's exact
   * spacing; Business Directory Visual Rhythm pass is the first caller
   * to pass a tighter value, scoped to /businesses' own Browse Mode
   * rails only. */
  className?: string;
  /** Analytics Phase 2A — set only by a Discovery Page Builder-driven
   * section (a homepage_rows row); every other Section caller (every
   * plain discovery route's own rails) omits this and fires nothing.
   * Fires discovery_section_impression once ~50% visible. */
  impressionPayload?: TrackEventPayload | null;
}) {
  const impressionRef = useViewportImpression<HTMLElement>(impressionPayload ?? null);

  return (
    <section ref={impressionRef} className={className}>
      {/* Launch-polish follow-up: View All used to sit inside the same
          items-end row as the title+subtitle stack, so with a subtitle
          present it bottom-aligned to the SUBTITLE line, not the title —
          reading as if it belonged with the filter pills underneath. The
          title/View All pair is now its own row (items-center, so View
          All vertically centers against the title specifically), with the
          subtitle continuing on its own line below either way. */}
      <div className="mb-3 px-4 sm:px-6">
        {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>}
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="shrink-0 text-xs font-semibold text-ink/55 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
            >
              View all
            </Link>
          )}
        </div>
        {subtitle && <p className="mt-1 text-sm text-ink/55">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function HorizontalScroller({
  children,
  className = "",
}: {
  children: React.ReactNode;
  /** Extra classes appended after the defaults — e.g. a touch of top
   * padding for a caller whose cards have a selected-state ring/border
   * that would otherwise butt right up against this container's own top
   * edge and get clipped by its (required, for horizontal scroll)
   * overflow-x-auto — see EventOccurrenceCard's Upcoming Dates usage.
   * Every other caller passes nothing and renders exactly as before. */
  className?: string;
}) {
  return (
    <div
      className={`flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}
