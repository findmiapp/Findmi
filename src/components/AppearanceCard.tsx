"use client";

import { useState } from "react";
import Link from "next/link";
import type { Appearance } from "@/lib/types";
import { cityState, formatAppearanceTime, getTemporalLabel } from "@/lib/format";
import { validateCustomDestination } from "@/lib/navigation";
import ImageLightbox from "./ImageLightbox";
import LiveDot from "./LiveDot";

// Appearances — Click Behavior pass: one deterministic primary click per
// card, in this exact order —
//   1. Related Event   → the FindMi event page (always wins if set)
//   2. External Link    → appearance.external_url
//   3. Flyer/Image       → lightbox (appearance.flyer_image_url)
//   4. GPS Directions    → Google Maps search from venue/address/city/state
//   5. Nothing            → plain, non-clickable card
// A lower tier's saved value is never cleared or ignored elsewhere — it
// just doesn't win the card's own click while a higher tier is present.
// Client component (was a server component) only because tier 3 needs
// local state to open/close the shared ImageLightbox.
export default function AppearanceCard({
  appearance,
  eventSlug,
}: {
  appearance: Appearance;
  eventSlug?: string | null;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const location = cityState(appearance.city, appearance.state);
  const mapsQuery = [appearance.venue_name, appearance.address, location].filter(Boolean).join(", ");
  const { live } = getTemporalLabel(appearance.start_at, appearance.end_at);

  const hasEvent = Boolean(eventSlug);
  const externalUrl =
    !hasEvent && appearance.external_url && validateCustomDestination(appearance.external_url).ok
      ? appearance.external_url
      : null;
  // Same internal-vs-external convention used everywhere else a founder-
  // entered destination is rendered (see Bulletin.tsx): a bare "https://"
  // URL opens in a new tab, anything else ("/a-page") is an internal Link.
  const externalIsAbsolute = externalUrl ? /^https:\/\//i.test(externalUrl) : false;
  const flyerUrl = !hasEvent && !externalUrl ? appearance.flyer_image_url : null;
  const directionsHref =
    !hasEvent && !externalUrl && !flyerUrl && mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null;

  const clickable = hasEvent || Boolean(externalUrl) || Boolean(flyerUrl) || Boolean(directionsHref);

  const content = (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 transition active:scale-[0.99] ${
        live
          ? "border-findmi/50 bg-findmi-50"
          : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 ${
          live ? "bg-findmi text-white" : "bg-black/[0.04] text-ink"
        }`}
      >
        {live ? (
          <>
            <LiveDot className="text-white" />
            <span className="text-[10px] font-bold uppercase tracking-wide">Now</span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
              {new Date(appearance.start_at).toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className="text-lg font-bold leading-none">
              {new Date(appearance.start_at).getDate()}
            </span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink sm:truncate">
          {appearance.title}
        </p>
        {/* Time only — the date tile already covers the date, so
            formatDateRange (which repeats it) is deliberately not used
            here. formatAppearanceTime shows "Time TBD" instead of a
            formatted time for an imported appearance whose real time is
            genuinely unknown — see lib/format.ts's own note. */}
        <p className="mt-0.5 truncate text-xs text-ink/55">
          {formatAppearanceTime(appearance.start_at, appearance.end_at, appearance.description)}
        </p>
        {(appearance.venue_name || location) && (
          <p className="mt-0.5 truncate text-xs text-ink/45">
            {[appearance.venue_name, location].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {appearance.status === "tentative" && (
        <span className="shrink-0 self-start rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-medium text-ink/50">
          Tentative
        </span>
      )}

      {/* A compact action, not a full-width bar — Aqua stays a small,
          intentional touch target rather than flooding the row. One icon
          for every clickable tier, same as before — this pass adds new
          click destinations, not new visual affordances. */}
      {clickable && (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi text-white transition group-hover:bg-findmi-600"
        >
          <ArrowGlyph className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );

  if (!clickable) return content;

  const ctaLabel = hasEvent
    ? "View event"
    : externalUrl
      ? "Open link"
      : flyerUrl
        ? "View flyer"
        : "Get directions";
  const ariaLabel = `${appearance.title} — ${ctaLabel}`;

  if (hasEvent) {
    return (
      <Link href={`/event/${eventSlug}`} className="group block" aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }

  if (externalUrl) {
    if (externalIsAbsolute) {
      return (
        <a href={externalUrl} target="_blank" rel="noreferrer" className="group block" aria-label={ariaLabel}>
          {content}
        </a>
      );
    }
    return (
      <Link href={externalUrl} className="group block" aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }

  if (flyerUrl) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className="group block w-full text-left" aria-label={ariaLabel}>
          {content}
        </button>
        {lightboxOpen && (
          <ImageLightbox
            images={[flyerUrl]}
            initialIndex={0}
            alt={appearance.title}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    );
  }

  // directionsHref
  return (
    <a href={directionsHref!} target="_blank" rel="noreferrer" className="group block" aria-label={ariaLabel}>
      {content}
    </a>
  );
}

// UI cleanup pass item 7: a plain chevron (no horizontal stem) — cleaner
// inside a small circular button than the old long arrow with a tail.
function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
