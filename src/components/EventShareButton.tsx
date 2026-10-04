"use client";

import { useState } from "react";
import { trackEvent, type TrackEventPayload } from "@/lib/analytics/track";

// Event Detail V2 polish pass, item 10 — native Web Share API when the
// browser supports it (mobile Safari/Chrome), falling back to copying the
// real canonical event URL to the clipboard otherwise. No third-party
// share dependency.
//
// Analytics attribution pass — same optional `track` shape as
// ShareButton.tsx (its own separate implementation, deliberately not
// consolidated in this pass — see the audit). Only emits after a real
// completed share, same cancel-safe reasoning as ShareButton.
export default function EventShareButton({
  title,
  url,
  track,
  layout = "pill",
}: {
  title: string;
  url: string;
  track?: Omit<TrackEventPayload, "event_name" | "referrer" | "utm_source" | "utm_medium" | "utm_campaign" | "metadata">;
  /** Event Detail Action Bar Correction pass — "pill" (default, unchanged)
   * is the existing Tier B rounded-full pill. "grid" is an icon-over-label
   * control that fills its parent grid cell, used only by the Event
   * page's Tier B utility row (see EventUtilityActions). Home Event Card
   * Reconstruction pass — "glass" is a compact icon-only translucent/
   * blurred circle for overlaying directly on photography (HomeEventCard's
   * bottom action dock). */
  layout?: "pill" | "grid" | "glass" | "icon";
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const nav: Navigator = navigator;
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title, url });
        if (track) trackEvent({ ...track, event_name: "share", metadata: { method: "web_share_api" } });
      } catch {
        // User canceled the native share sheet — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (track) trackEvent({ ...track, event_name: "share", metadata: { method: "clipboard" } });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (older browser/permissions) — nothing more
      // to do; the button simply doesn't confirm a copy that didn't happen.
    }
  }

  if (layout === "grid") {
    return (
      <button
        type="button"
        onClick={handleShare}
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 text-ink/70 transition hover:border-ink/30 hover:text-ink"
      >
        <ShareGlyph className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{copied ? "Copied" : "Share"}</span>
      </button>
    );
  }

  if (layout === "icon") {
    return (
      <button
        type="button"
        onClick={handleShare}
        aria-label={copied ? "Link copied" : "Share"}
        title={copied ? "Link copied" : "Share"}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 border border-black/10 bg-white text-ink/70 transition hover:border-ink/30 hover:text-ink active:scale-95 ${copied ? "border-findmi/40 text-findmi-700" : ""}`}
      >
        <ShareGlyph className="h-[18px] w-[18px]" />
      </button>
    );
  }

  if (layout === "glass") {
    return (
      <button
        type="button"
        onClick={handleShare}
        aria-label={copied ? "Link copied" : "Share"}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-black/40 text-white backdrop-blur-md transition active:scale-95"
      >
        <ShareGlyph className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
    >
      <ShareGlyph className="h-3.5 w-3.5" />
      {copied ? "Link Copied" : "Share"}
    </button>
  );
}

function ShareGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="18" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="19" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.1 10.8l7.8-4.2M8.1 13.2l7.8 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
