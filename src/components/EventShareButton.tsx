"use client";

import { useState } from "react";

// Event Detail V2 polish pass, item 10 — native Web Share API when the
// browser supports it (mobile Safari/Chrome), falling back to copying the
// real canonical event URL to the clipboard otherwise. No third-party
// share dependency.
export default function EventShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const nav: Navigator = navigator;
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title, url });
      } catch {
        // User canceled the native share sheet — not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (older browser/permissions) — nothing more
      // to do; the button simply doesn't confirm a copy that didn't happen.
    }
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
