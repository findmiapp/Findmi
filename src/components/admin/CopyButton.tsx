"use client";

import { useState } from "react";

/**
 * Pro Invite Sharing UX pass — small, generic copy-to-clipboard button
 * (admin invite link/code, list rows). Same clipboard-write + timed
 * "Copied" feedback shape as the public ShareButton
 * (src/components/ShareButton.tsx), just without that component's
 * Web Share API branch — an admin copying a link to paste into an
 * email/text has no use for the native share sheet. Copies the value
 * via the Clipboard API directly (no text selection required), so it
 * works the same on mobile as desktop.
 */
export default function CopyButton({
  value,
  label,
  copiedLabel = "Copied",
  className,
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
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
      onClick={handleCopy}
      className={
        className ??
        "shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/70 transition hover:bg-black/5"
      }
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
