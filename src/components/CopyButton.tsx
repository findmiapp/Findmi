"use client";

import { useState } from "react";

/**
 * Public-facing counterpart to components/admin/CopyButton.tsx — same
 * clipboard-write + timed "Copied" feedback shape (and the same
 * public ShareButton.tsx pattern minus its Web Share branch), kept as
 * its own small file rather than shared across the admin/public
 * boundary, matching this codebase's existing admin/public component
 * split (see components/TabNav.tsx vs components/admin/TabNav.tsx).
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
      // Clipboard unavailable — nothing safe left to do.
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
