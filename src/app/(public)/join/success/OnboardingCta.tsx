"use client";

import { useEffect, useState } from "react";

// Tally's officially supported embed mechanism: their own widget script
// scans the DOM for elements carrying data-tally-src and drives the
// iframe itself (handshake, resize via postMessage). This is deliberately
// NOT a bare iframe pointed straight at a Tally URL — see incident
// history: that pattern isn't Tally's supported contract and is what
// previously caused a top-frame navigation away from findmi.app.
const TALLY_EMBED_SCRIPT_SRC = "https://tally.so/widgets/embed.js";

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

/** Tally's iframe-embed path ("/embed/{id}") is what their official script
 * expects in data-tally-src. The Form Manager stores the ordinary share
 * link ("/r/{id}") a founder actually copies from Tally, so only the path
 * segment is translated here — every query param this resolved URL
 * carries (membership_id, source, plan, existing_business_id) is
 * preserved untouched. Scoped locally to this one CTA rather than shared
 * with components/FormAction.tsx, so nothing about business/product/event
 * forms is touched by this pass. */
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

export interface OnboardingCtaProps {
  /** Absolute Tally URL from lib/forms.ts's resolveOnboardingForm() —
   * Form Manager–controlled, already carrying membership_id/source/plan/
   * existing_business_id. Never transformed into an internal route. */
  url: string;
  displayMode: "embed" | "external";
  className: string;
}

/**
 * The paid-membership success page's "Build My Profile" action only.
 * external: unchanged plain new-tab anchor to the resolved absolute URL.
 * embed: opens a modal/drawer (findmi.app never navigates away) and
 * drives the Tally form via their official widget script. An "Open in a
 * new tab" link to the same absolute URL is always visible inside the
 * modal — if the embed script can't load or the form can't render, the
 * user still has a working path, with zero dependency on the embed
 * having succeeded.
 */
export default function OnboardingCta({ url, displayMode, className }: OnboardingCtaProps) {
  const [open, setOpen] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!open || displayMode !== "embed") return;

    if (window.Tally) {
      setScriptReady(true);
      window.Tally.loadEmbeds();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TALLY_EMBED_SCRIPT_SRC}"]`);
    if (existing) {
      const onLoad = () => {
        setScriptReady(true);
        window.Tally?.loadEmbeds();
      };
      existing.addEventListener("load", onLoad);
      return () => existing.removeEventListener("load", onLoad);
    }

    const script = document.createElement("script");
    script.src = TALLY_EMBED_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      setScriptReady(true);
      window.Tally?.loadEmbeds();
    };
    document.body.appendChild(script);
  }, [open, displayMode]);

  if (displayMode === "external") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
        Build My Profile
      </a>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Build My Profile
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
                href={url}
                target="_blank"
                rel="noopener noreferrer"
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
            <div className="relative flex-1 overflow-hidden">
              {!scriptReady && (
                <p className="absolute inset-x-0 top-4 text-center text-xs text-ink/40">Loading form…</p>
              )}
              <iframe
                data-tally-src={toEmbedSrc(url)}
                title="Build My Profile"
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
