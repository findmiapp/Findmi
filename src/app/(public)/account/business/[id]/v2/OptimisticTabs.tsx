"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Business Manager — a row of in-destination tabs (Findmi Here's Happening /
 * Find Us Here / …, Growth's Goals / Opportunities / Ideas, the Moments
 * filter, …) whose highlight moves the instant a tab is tapped.
 *
 * The page below keeps showing the current view until the next one is ready,
 * so without this the tapped tab would look dead for the length of a server
 * round trip. The tap is remembered as "pending" and wins over the
 * server-provided `active` until the URL catches up (`active` becomes that
 * tab), or a timeout drops it if the navigation never lands. Pending always
 * holds the LAST tap, so rapid taps cannot leave the highlight on an earlier
 * tab. Remounts (a new destination) start clean. */

const PENDING_TIMEOUT_MS = 8000;

export type OptimisticTab = {
  key: string;
  href: string;
  label: ReactNode;
  /** A real count shown beside the label (omitted when 0). */
  badge?: number;
};

export default function OptimisticTabs({
  items,
  active,
  ariaLabel,
  navClass,
  linkClass,
  activeClass,
  inactiveClass,
  badgeClass,
  badgeActiveClass,
  badgeInactiveClass,
  semantics = "nav",
  children,
}: {
  items: OptimisticTab[];
  active: string;
  ariaLabel: string;
  navClass: string;
  linkClass: string;
  activeClass: string;
  inactiveClass: string;
  badgeClass?: string;
  badgeActiveClass?: string;
  badgeInactiveClass?: string;
  /** "nav": aria-current="page" links. "tab": role=tablist / aria-selected. */
  semantics?: "nav" | "tab";
  children?: ReactNode;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    if (pending !== null && active === pending) clear();
  }, [active, pending, clear]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  // Back/Forward is a navigation the user did not tap here.
  useEffect(() => {
    window.addEventListener("popstate", clear);
    return () => window.removeEventListener("popstate", clear);
  }, [clear]);

  const shown = pending ?? active;
  const tab = semantics === "tab";
  return (
    <nav aria-label={ariaLabel} role={tab ? "tablist" : undefined} className={navClass}>
      {items.map((it) => {
        const isActive = it.key === shown;
        const count = it.badge ?? 0;
        return (
          <Link
            key={it.key}
            href={it.href}
            onClick={(e) => {
              // Modified clicks (new tab/window) don't navigate this tab.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              if (timer.current) clearTimeout(timer.current);
              setPending(it.key);
              timer.current = setTimeout(clear, PENDING_TIMEOUT_MS);
            }}
            {...(tab ? { role: "tab", "aria-selected": isActive } : { "aria-current": isActive ? ("page" as const) : undefined })}
            className={`${linkClass} ${isActive ? activeClass : inactiveClass}`}
          >
            {it.label}
            {count > 0 && <span className={`${badgeClass ?? ""} ${isActive ? (badgeActiveClass ?? "") : (badgeInactiveClass ?? "")}`}>{count}</span>}
          </Link>
        );
      })}
      {children}
    </nav>
  );
}
