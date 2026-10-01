"use client";

import { useState } from "react";
import Link from "next/link";
import type { LocationHappening } from "@/lib/data";
import { formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import SupabaseImage from "./SupabaseImage";

type ViewMode = "cards" | "list";

/** Location + Event Moment Continuity pass — the Location page's own
 * "What's Happening Here" collection, visually matching the already-
 * accepted Business FindMi Here family (AppearanceFindMiHere/
 * AppearanceCarousel/AppearanceList) WITHOUT importing or modifying any
 * of those files: Business's cards open a shared Quick View modal tied
 * to one business identity, whereas a Location's happenings (a mix of
 * Event occurrences and standalone Appearances, already normalized into
 * LocationHappening by getUpcomingAtLocation) each have a real, already-
 * resolved destination of their own (`item.href`) and no single-entity
 * "business" context to anchor a shared modal to. Reusing those
 * components as-is would mean reshaping their props around a mixed
 * collection with no business, risking the exact locked Business Detail
 * surface this pass must not touch — so this is an additive, Location-
 * only implementation that mirrors the same visual language (photo-led
 * cards, live/when badge, title, identity line, date/time; a compact
 * date-tile list row) instead.
 *
 * Per the product rule this pass establishes: the featured happening
 * shown editorially above (FeaturedLocationHappeningCard) is NOT removed
 * from this collection — `happenings` here is always the FULL upcoming
 * set, same as Business's own Featured Appearance + FindMi Here
 * collection both showing the same appearance. */
export default function LocationHappeningCollection({ happenings }: { happenings: LocationHappening[] }) {
  const [view, setView] = useState<ViewMode>("cards");
  const allEvents = happenings.every((h) => h.type === "event");
  const allAppearances = happenings.every((h) => h.type === "appearance");
  const subtitle = allEvents ? "Upcoming Events" : allAppearances ? "Upcoming Appearances" : "Upcoming Events & Appearances";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">What&apos;s Happening Here</h2>
          <p className="mt-0.5 text-xs text-ink/50">{subtitle}</p>
        </div>
        <ViewSwitcher view={view} onChange={setView} />
      </div>

      <div className="mt-3">
        {view === "cards" ? <LocationMomentCards happenings={happenings} /> : <LocationMomentList happenings={happenings} />}
      </div>
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="group" aria-label="View" className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/10 bg-white p-0.5">
      {(
        [
          { mode: "cards" as const, label: "Cards" },
          { mode: "list" as const, label: "List" },
        ]
      ).map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          aria-pressed={view === mode}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
            view === mode ? "bg-findmi text-white" : "text-ink/50 hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function LocationMomentCards({ happenings }: { happenings: LocationHappening[] }) {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {happenings.map((item) => (
        <LocationMomentCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function LocationMomentCard({ item }: { item: LocationHappening }) {
  const { label, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <Link
      href={item.href}
      className="block w-64 shrink-0 overflow-hidden rounded-2xl border border-black/5 bg-white text-left shadow-sm transition active:scale-[0.98] sm:w-72"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="(min-width: 640px) 288px, 256px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <CalendarGlyph className="h-8 w-8 text-white/25" />
          </div>
        )}
        <span
          className={`absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
            live ? "bg-red-600 text-white" : "bg-white/90 text-ink backdrop-blur-sm"
          }`}
        >
          {live && <LiveDot className="text-white" />}
          {live ? "Happening Now" : label}
        </span>
      </div>
      <div className="p-3">
        {/* Venue/identity context deliberately omitted when it would just
            repeat where the visitor already is — this is the Location's
            own page, so the subtitle line here is the business/organizer
            identity (the useful, non-redundant part), same as Business's
            own FindMi Here cards omit the business's own name/logo per
            card for the identical reason. */}
        {item.subtitle && <p className="truncate text-[11px] font-bold uppercase tracking-wide text-findmi-700">{item.subtitle}</p>}
        <p className="mt-0.5 line-clamp-2 font-display text-sm font-semibold leading-snug text-ink">{item.title}</p>
        <p className="mt-1 truncate text-xs text-ink/45">{formatAppearanceDateRange(item.start_at, item.end_at, item.description)}</p>
      </div>
    </Link>
  );
}

function LocationMomentList({ happenings }: { happenings: LocationHappening[] }) {
  return (
    <ul className="flex flex-col divide-y divide-black/[0.05] overflow-hidden rounded-2xl border border-black/5 bg-white">
      {happenings.map((item) => (
        <LocationMomentRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function LocationMomentRow({ item }: { item: LocationHappening }) {
  const { label, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <li>
      <Link
        href={item.href}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition active:scale-[0.99] hover:bg-findmi-50/60"
      >
        <div
          className={`flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 ${
            live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/[0.04] text-ink"
          }`}
        >
          {live ? (
            <>
              <LiveDot className="text-white" />
              <span className="text-[9px] font-extrabold uppercase tracking-wide">Now</span>
            </>
          ) : (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
                {new Date(item.start_at).toLocaleDateString("en-US", { month: "short" })}
              </span>
              <span className="text-lg font-bold leading-none">{new Date(item.start_at).getDate()}</span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {!live && <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{label}</p>}
          <p className="mt-0.5 line-clamp-1 font-display text-sm font-semibold leading-snug text-ink">{item.title}</p>
          {item.subtitle && <p className="mt-0.5 truncate text-xs font-medium text-ink/70">{item.subtitle}</p>}
          <p className="mt-0.5 truncate text-xs text-ink/50">
            {formatAppearanceDateRange(item.start_at, item.end_at, item.description)}
          </p>
        </div>

        <ArrowGlyph className="h-3.5 w-3.5 shrink-0 text-ink/30" />
      </Link>
    </li>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
