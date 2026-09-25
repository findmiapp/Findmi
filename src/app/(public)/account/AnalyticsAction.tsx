"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { WhichBusinessPanel } from "./BusinessScopedAction";
import { resolveAnalyticsHref, type BusinessOption } from "./businessScope";

/** Final Action-Bar Polish pass — the secondary half of the /account
 * action row, next to BusinessScopedAction's "Where I'll Be" (variant=
 * "full" size="row"). Deliberately a separate small component rather
 * than a new BusinessScopedAction branch: that component's own zero-
 * business fallback (Add Business) is correct for a CREATE action but
 * would be a fabricated "Analytics" destination for an account with no
 * business — see resolveAnalyticsHref's own doc comment in
 * businessScope.ts. The actual chooser UI (WhichBusinessPanel) is
 * reused as-is, same primitive BusinessScopedAction's own "full"
 * variant uses for its multi-business case — no second, duplicated
 * dropdown implementation. No persisted/URL-selected business state:
 * `open` is local component state only, gone the moment this unmounts.
 *
 * Caller contract: only ever render this when `businesses.length > 0`
 * (account/page.tsx gates it that way, matching the "omit for zero
 * businesses" choice this pass made) — the zero-length branch below is
 * a defensive fallback, not the primary path. */
const ROW_BUTTON_CLASS =
  "flex h-12 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 bg-white px-3 text-center text-xs font-bold uppercase text-ink transition hover:border-findmi/40 hover:bg-findmi-50 active:scale-[0.99]";

export default function AnalyticsAction({
  businesses,
  icon,
  label = "Analytics",
}: {
  businesses: BusinessOption[];
  icon: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Defensive only — account/page.tsx doesn't render this component at
  // all when there are zero businesses, so there's no fake destination
  // to invent here either.
  if (businesses.length === 0) return null;

  const href = resolveAnalyticsHref(businesses);
  if (href) {
    // One business — straight to the canonical Analytics destination.
    // That page's own existing pro/UpgradeLockedTab gate (unchanged,
    // untouched here) decides whether real Analytics or the locked Pro
    // explanation renders — this link never knows or cares which.
    return (
      <Link href={href} className={ROW_BUTTON_CLASS}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={ROW_BUTTON_CLASS}>
        {icon}
        {label}
      </button>
      {open && (
        <WhichBusinessPanel
          businesses={businesses}
          tab="performance"
          className="left-0 right-0"
          chooserLabel="View analytics for"
        />
      )}
    </div>
  );
}
