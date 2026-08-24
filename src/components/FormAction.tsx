"use client";

import { useState } from "react";

/**
 * Tally's plain share link ("https://tally.so/r/{id}", what a founder
 * actually copies from Tally and pastes into Form Manager) refuses to
 * render inside a third-party iframe and top-navigates the embedding page
 * instead of loading — the exact cause of a stray /join/eyJ... 404 after
 * clicking an embed-mode action. Tally's dedicated "/embed/{id}" path is
 * the one meant for iframing. Only the iframe src gets translated here —
 * the Form Manager keeps storing the ordinary share link, and "external"
 * (new-tab) actions are unaffected since they were never embedded.
 */
function toEmbedSrc(href: string): string {
  try {
    const url = new URL(href);
    if (url.hostname === "tally.so" && url.pathname.startsWith("/r/")) {
      url.pathname = url.pathname.replace(/^\/r\//, "/embed/");
    }
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Renders one resolved Form Manager action (see lib/forms.ts). External
 * forms behave exactly like the plain links they replace — a new tab,
 * nothing else changes. Embed forms open in a bottom drawer on mobile /
 * centered panel on desktop, so a founder can keep a consumer inside
 * FindMi for quick actions (RSVP, contact) without restyling Tally's own
 * form content.
 */
export default function FormAction({
  href,
  displayMode,
  label,
  className,
}: {
  href: string;
  displayMode: "embed" | "external";
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (displayMode === "external") {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {label}
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative h-[85vh] w-full overflow-hidden rounded-t-3xl bg-white sm:h-[80vh] sm:max-w-lg sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink shadow-sm"
            >
              ✕
            </button>
            <iframe src={toEmbedSrc(href)} title={label} className="h-full w-full border-0" />
          </div>
        </div>
      )}
    </>
  );
}
