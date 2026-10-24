"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import { addEventIntentHref, type AddEventIntent } from "./eventIntent";

/** Findmi Here → Events: the ONE compact "Add Event" action (a thin outlined
 * pill with a small aqua "+" — never a giant filled CTA). It asks intent
 * FIRST, in the owner's words, never Findmi's internal Event/Appearance
 * model, then routes into the existing canonical workflow for that intent
 * (./eventIntent addEventIntentHref):
 *
 *   Hosting An Event      → Hosting panel: Import (intent=hosting) or create
 *                           in the Event Manager (/account/event/new).
 *   Appearing At An Event → the existing request-to-join composer: Search
 *                           Findmi, Import (intent=participating) or add
 *                           manually.
 *
 * Mobile: bottom sheet. sm+: centered dialog. Esc / backdrop closes. */
export default function AddEventChooser({ basePath, initialOpen = false }: { basePath: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const options: { intent: AddEventIntent; title: string; copy: string; icon: "calendar" | "compass" }[] = [
    { intent: "hosting", title: "Hosting An Event", copy: "An Event your Business is organizing.", icon: "calendar" },
    { intent: "appearing", title: "Appearing At An Event", copy: "An Event or experience someone else is hosting that your Business will participate in.", icon: "compass" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-findmi-200 bg-white pl-1.5 pr-3.5 text-[13px] font-bold text-primary transition hover:border-findmi-300 hover:bg-findmi-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 active:scale-[0.98]"
      >
        <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-findmi text-white">
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </span>
        Add Event
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-event-title"
            className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:p-5"
          >
            <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 id="add-event-title" className="font-display text-section-title font-bold text-primary">
                What Are You Adding?
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
            <ul className="mt-2 flex flex-col gap-2">
              {options.map((o) => (
                <li key={o.intent}>
                  <Link
                    href={addEventIntentHref(basePath, o.intent)}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[64px] items-start gap-3 rounded-2xl border border-black/[0.07] px-4 py-3 transition hover:border-findmi/40 hover:bg-findmi-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                      <NavIcon name={o.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-card-title font-semibold text-primary">{o.title}</span>
                      <span className="mt-0.5 block text-metadata text-muted">{o.copy}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
