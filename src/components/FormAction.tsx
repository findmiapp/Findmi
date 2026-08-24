"use client";

import { useState } from "react";

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
            <iframe src={href} title={label} className="h-full w-full border-0" />
          </div>
        </div>
      )}
    </>
  );
}
