"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { GoalGlyph, MomentGlyph } from "@/components/opportunities/OpportunityGlyphs";

/** The ONE "+ Add" entry for a Business owner — choose by intent, never by
 * Findmi's internal model:
 *   Add Moment          → the canonical Moment composer (/my-world/journal/
 *                         new), prefilled with this Business.
 *   Host Something      → the existing Event creation flow, with this
 *                         Business as host (?business_id=, validated
 *                         server-side).
 *   Go Somewhere        → the existing Event search / request-to-join
 *                         composer in Presence (manual Appearance fallback).
 *   Add A Location      → the existing Business Locations add panel.
 * Grow Your Business:
 *   Find An Opportunity → Opportunities, Explore view.
 *   Tell Findmi Your Goals → the Business goal flow.
 *
 * Mobile: bottom sheet (scrolls when tall). sm+: centered dialog. Esc /
 * backdrop closes. */
export default function AddToPresence({
  basePath,
  businessId,
  initialOpen = false,
  variant = "primary",
}: {
  basePath: string;
  businessId: string;
  initialOpen?: boolean;
  variant?: "primary" | "chip";
}) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const option = (href: string, title: string, copy: string, icon: ReactNode) => ({ href, title, copy, icon });
  // Same icon for the same action everywhere: pencil = Moment (Quick
  // Create), calendar = an Event (Quick Create's Add An Event), compass =
  // going somewhere, pin = Location, spark = Opportunities (Business nav).
  const doOptions = [
    option(
      `/my-world/journal/new?business=${encodeURIComponent(businessId)}`,
      "Add Moment",
      "Document something your Business experienced.",
      <MomentGlyph className="h-5 w-5" />
    ),
    option(
      `/account/event/new?business_id=${encodeURIComponent(businessId)}`,
      "Host Something",
      "Create an activation, pop-up, tasting, class, launch or Event you’re organizing.",
      <NavIcon name="calendar" className="h-5 w-5" />
    ),
    option(
      `${basePath}?tab=findmi-here&compose=1`,
      "Go Somewhere",
      "Add a festival, market, retailer sampling, trade show or somewhere else you’ll be.",
      <NavIcon name="compass" className="h-5 w-5" />
    ),
    option(
      `${basePath}?tab=findmi-here&view=locations&add=1`,
      "Add A Location",
      "Add or connect a store, café, showroom or other ongoing Location for this Business.",
      <NavIcon name="pin" className="h-5 w-5" />
    ),
  ];
  const growOptions = [
    option(`${basePath}?tab=opportunities&view=explore`, "Find An Opportunity", "Explore Opportunities available to your Business.", <SparkGlyph className="h-5 w-5" />),
    option(
      `${basePath}/opportunities/goals/new`,
      "Tell Findmi Your Goals",
      "Share what you’re trying to accomplish and we’ll find relevant Opportunities.",
      <GoalGlyph className="h-5 w-5" />
    ),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={
          variant === "chip"
            ? "flex h-11 shrink-0 items-center gap-2 rounded-full bg-findmi pl-3 pr-4 text-button font-bold text-white shadow-sm transition hover:bg-findmi-600 active:scale-[0.98]"
            : "flex h-11 w-fit items-center gap-2 rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99]"
        }
      >
        <PlusGlyph className="h-4 w-4" />
        Add
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-to-presence-title"
            className="relative max-h-[88vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:max-h-[90vh] sm:rounded-3xl sm:p-5"
          >
            <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 id="add-to-presence-title" className="font-display text-section-title font-bold text-primary">
                What Would You Like To Do?
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-black/[0.04] hover:text-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <OptionList options={doOptions} onPick={() => setOpen(false)} />
            <p className="mt-4 px-1 text-label font-bold uppercase text-subtle">Grow Your Business</p>
            <OptionList options={growOptions} onPick={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function OptionList({ options, onPick }: { options: { href: string; title: string; copy: string; icon: ReactNode }[]; onPick: () => void }) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {options.map((o) => (
        <li key={o.title}>
          <Link
            href={o.href}
            onClick={onPick}
            className="flex min-h-[64px] items-start gap-3 rounded-2xl border border-black/[0.07] px-4 py-3 transition hover:border-findmi/40 hover:bg-findmi-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">{o.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-card-title font-semibold text-primary">{o.title}</span>
              <span className="mt-0.5 block text-metadata text-muted">{o.copy}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** Same 24px / 1.8-stroke family as NavIcon (mirrors the shell's SparkGlyph). */
function SparkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 3.5l2.1 5.4 5.4 2.1-5.4 2.1L12 18.5l-2.1-5.4L4.5 11l5.4-2.1L12 3.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor" />
    </svg>
  );
}
