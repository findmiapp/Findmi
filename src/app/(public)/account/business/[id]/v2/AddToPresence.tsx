"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import NavIcon from "@/components/NavIcon";

/** Business Manager V2, Pass A — the ONE activity creation entry for a
 * business owner. Owners choose by intent, never by Findmi's internal
 * model (Event vs Appearance vs Location):
 *
 *   Hosting something   → the existing Event creation flow, opened with
 *                         this business as context (?business_id=). It does
 *                         NOT make the business the Event's host — that is
 *                         Pass C (events.host_business_id).
 *   Going somewhere     → the existing Event search / request-to-join
 *                         composer in Presence, with the manual "add where
 *                         you'll be" fallback (a manual Appearance).
 *   One of our locations → the existing Business Locations add panel.
 *
 * Mobile: bottom sheet. sm+: centered dialog. Esc / backdrop closes. */
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

  const options: { href: string; title: string; copy: string; icon: ReactNode }[] = [
    {
      href: `/account/event/new?business_id=${encodeURIComponent(businessId)}`,
      title: "Host something",
      copy: "Create an activation, pop-up, tasting, class, launch or event you’re organizing.",
      icon: <SparkGlyph className="h-5 w-5" />,
    },
    {
      href: `${basePath}?tab=findmi-here&compose=1`,
      title: "Go somewhere",
      copy: "Add a festival, market, retailer sampling, trade show or somewhere else you’ll be.",
      icon: <NavIcon name="compass" className="h-5 w-5" />,
    },
    {
      href: `${basePath}?tab=findmi-here&view=locations&add=1`,
      title: "Add a location",
      copy: "Add or connect a store, café, showroom or other ongoing location for this business.",
      icon: <NavIcon name="pin" className="h-5 w-5" />,
    },
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
            className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-xl sm:rounded-3xl sm:p-5"
          >
            <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/10 sm:hidden" />
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 id="add-to-presence-title" className="font-display text-section-title font-bold text-primary">
                What would you like to add?
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
                <li key={o.title}>
                  <Link
                    href={o.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[72px] items-start gap-3 rounded-2xl border border-black/[0.07] px-4 py-3.5 transition hover:border-findmi/40 hover:bg-findmi-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                      {o.icon}
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
