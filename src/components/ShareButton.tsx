"use client";

import { useState } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

// Generic share affordance — Web Share API where the browser supports it
// (native share sheet), falling back to copying the URL to the clipboard
// with brief "Link copied" feedback. No sharing library, no new backend —
// first reusable Share pattern in the app (Product Detail V2), written
// generically (url/title props) so a future page can reuse it instead of
// rebuilding this.
//
// Analytics attribution pass — `track` is optional (an existing caller
// that hasn't been updated yet keeps working, share UX unchanged, just
// with no analytics event). Only fires after a real completed share:
// the Web Share API path is skipped entirely when the visitor cancels
// the native sheet (navigator.share's own rejection — no distinguishable
// "cancel" reason across browsers, so this simply doesn't emit rather
// than guessing), and the clipboard path only emits once the write
// itself actually succeeds.
export default function ShareButton({
  url,
  title,
  track,
  variant = "default",
}: {
  url: string;
  title: string;
  track?: Omit<TrackEventPayload, "event_name" | "referrer" | "utm_source" | "utm_medium" | "utm_campaign" | "metadata">;
  /** Public Graph Integrity Pass 1 — "icon" is a compact, icon-only
   * circular button (same h-9/w-9/rounded-full/border footprint as
   * SaveButton) for a tight action row that has no room for the default
   * full-width labeled pill (e.g. Business's identity row, alongside
   * Message/Follow/Save). Same share logic either way — Web Share API
   * with a clipboard-copy fallback — only the resting button markup
   * differs. Default unchanged, so every existing caller (Product,
   * Event's own EventShareButton) keeps its exact current appearance.
   * Public Experience Consolidation pass — "row" matches
   * AddToCalendarButton's own new "row" layout (h-11, rounded-xl, bold
   * uppercase label) for a 3-across `grid grid-cols-3` action row (see
   * AppearanceQuickView), where "default"'s rounded-full/text-sm geometry
   * didn't match Directions/Calendar there. Location Detail V1 — "grid" is
   * an icon-over-label control that fills its parent grid cell, same
   * shape/geometry as EventShareButton's own "grid" layout, for the
   * Location page's primary action grid (see LocationPublicView.tsx). */
  variant?: "default" | "icon" | "row" | "grid";
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        if (track) trackEvent({ ...track, event_name: "share", metadata: { method: "web_share_api" } });
        return;
      } catch {
        // User canceled the native share sheet, or it failed — fall
        // through to the clipboard path rather than leaving no feedback.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (track) trackEvent({ ...track, event_name: "share", metadata: { method: "clipboard" } });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (very old browser, permissions) — nothing
      // safe left to do; the button simply does nothing further.
    }
  }

  const shareGlyph = (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
      <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleShare}
        aria-label={copied ? "Link copied" : "Share"}
        title={copied ? "Link copied" : "Share"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink transition active:scale-90"
      >
        {shareGlyph}
      </button>
    );
  }

  if (variant === "grid") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
      >
        {shareGlyph}
        <span className="text-[11px] font-semibold uppercase tracking-wide">{copied ? "Copied" : "Share"}</span>
      </button>
    );
  }

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30"
      >
        {shareGlyph}
        {copied ? "Copied" : "Share"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-black/10 text-sm font-semibold text-ink transition active:scale-[0.98]"
    >
      {shareGlyph}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
