import Link from "next/link";
import type { ReactNode } from "react";

const action = "inline-flex min-h-10 items-center rounded-full border border-black/10 bg-white px-3.5 text-xs font-semibold text-ink/75 transition hover:border-black/25";

/** Pages + Sections V1B — one Section, collapsed to what an editor needs at
 * a glance (type, heading, "Events & Appearances · Hybrid · 18 results",
 * "NYC · Oct 26 – Nov 2"), with Edit / Preview Results / Show-Hide and the
 * existing Move panel. The full form or the results list expands inline
 * only for the Section being worked on (?edit= / ?results=), so a long Page
 * stays scannable. Server-rendered; plain links and forms. */
export default function SectionCard({
  id,
  kindLabel,
  title,
  primary,
  secondary,
  warning,
  isVisible,
  editHref,
  resultsHref,
  closeHref,
  open,
  visibilityAction,
  deleteAction,
  movePanel,
  children,
}: {
  id: string;
  kindLabel: string;
  title: string;
  primary: string | null;
  secondary: string | null;
  warning?: string | null;
  isVisible: boolean;
  editHref: string;
  /** Entity Results only. */
  resultsHref?: string;
  closeHref: string;
  open: "edit" | "results" | null;
  visibilityAction: () => void;
  deleteAction: () => void;
  movePanel: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div id={`section-${id}`} className={`scroll-mt-24 rounded-2xl border bg-white ${open ? "border-findmi/40 shadow-sm" : "border-black/10"}`}>
      <div className="p-3.5">
        <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-ink/40">
          {kindLabel}
          {!isVisible && <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-ink/55">Hidden</span>}
        </p>
        <p className="mt-0.5 break-words font-display text-base font-semibold tracking-tight text-ink">{title}</p>
        {primary && <p className="mt-0.5 text-xs font-medium text-ink/60">{primary}</p>}
        {secondary && <p className="mt-0.5 text-xs text-ink/45">{secondary}</p>}
        {warning && <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">{warning}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {open === "edit" ? (
            <Link href={closeHref} className={`${action} border-findmi/40 text-findmi-700`}>
              Done
            </Link>
          ) : (
            <Link href={editHref} className={action}>
              Edit
            </Link>
          )}
          {resultsHref &&
            (open === "results" ? (
              <Link href={closeHref} className={`${action} border-findmi/40 text-findmi-700`}>
                Close Results
              </Link>
            ) : (
              <Link href={resultsHref} className={action}>
                Preview Results
              </Link>
            ))}
          <form action={visibilityAction}>
            <button type="submit" className={action}>
              {isVisible ? "Hide" : "Show"}
            </button>
          </form>
          <details className="relative">
            <summary className={`${action} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label={`More actions for ${title}`}>
              •••
            </summary>
            <form action={deleteAction} className="mt-1.5">
              <button type="submit" className="inline-flex min-h-10 items-center rounded-full border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700">
                Delete Section
              </button>
            </form>
          </details>
        </div>
        {movePanel}
      </div>
      {children && <div className="border-t border-black/[0.06] p-3.5">{children}</div>}
    </div>
  );
}
