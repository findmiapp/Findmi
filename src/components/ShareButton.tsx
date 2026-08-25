"use client";

import { useState } from "react";

// Generic share affordance — Web Share API where the browser supports it
// (native share sheet), falling back to copying the URL to the clipboard
// with brief "Link copied" feedback. No sharing library, no new backend —
// first reusable Share pattern in the app (Product Detail V2), written
// generically (url/title props) so a future page can reuse it instead of
// rebuilding this.
export default function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User canceled the native share sheet, or it failed — fall
        // through to the clipboard path rather than leaving no feedback.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (very old browser, permissions) — nothing
      // safe left to do; the button simply does nothing further.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-black/10 text-sm font-semibold text-ink transition active:scale-[0.98]"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
        <circle cx="18" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="18" cy="19" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
