"use client";

import { useState } from "react";

/**
 * Confirmed root cause of the /join/eyJ... 404 (see incident trace): the
 * embed iframe had no `sandbox` attribute, so Tally's hosted page — share
 * link or "/embed/{id}" alike — could freely call `window.top.location =
 * …` from inside the iframe. That's a *relative* navigation executed from
 * a cross-origin frame, so the browser resolves it against the PARENT
 * page's current origin/path (findmi.app/join/success), which is exactly
 * how a stray, non-existent /join/eyJ... URL and 404 were produced — not
 * a FindMi routing bug, and not something a /r/ → /embed/ URL swap alone
 * could prevent, since either path can still attempt the same escape.
 *
 * The fix here is a browser-platform guarantee rather than a bet on
 * Tally's exact behavior: `sandbox` without allow-top-navigation (or
 * allow-top-navigation-by-user-activation) makes it structurally
 * impossible for anything inside the iframe to navigate window.top, no
 * matter what script runs there. allow-scripts/allow-same-origin/
 * allow-forms/allow-popups keep the form itself fully interactive
 * (typing, submitting, its own internal "thank you" step navigates
 * *within* the iframe, which sandboxing never restricts).
 *
 * Embedding a third-party page without its official widget script isn't
 * guaranteed to render, so an always-visible "Open in a new tab" link
 * (the plain, un-rewritten canonical URL) sits above the iframe as a
 * standing fallback — reliability over forcing the embed to work.
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
            className="relative flex h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:h-[80vh] sm:max-w-lg sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-ink/50 underline underline-offset-2 hover:text-ink/70"
              >
                Open in a new tab
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink/60 hover:bg-black/5"
              >
                ✕
              </button>
            </div>
            <iframe
              src={toEmbedSrc(href)}
              title={label}
              className="h-full w-full flex-1 border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
      )}
    </>
  );
}
