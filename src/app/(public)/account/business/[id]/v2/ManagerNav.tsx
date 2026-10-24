"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { canonicalTab, destinationGroup, sectionForTab, type BusinessSection } from "./business-nav";
import ManagerSkeleton from "./ManagerSkeleton";

/** Business Manager — persistent primary navigation (desktop rail + mobile
 * bottom bar) with instant tap feedback.
 *
 * The destinations are still `?tab=` views of /account/business/[id]. What
 * changes is who decides the highlighted item. It used to come from the
 * server render, so a tap changed nothing on screen until the whole next view
 * had been rendered and shipped. Now a tap records the tapped destination as
 * "pending" and the highlight moves on that same frame; the URL then catches
 * up and the pending marker is dropped.
 *
 * Rapid taps stay correct: pending always holds the LAST tap, and it is only
 * cleared when the URL reaches that tab (or on Back/Forward, or after a
 * timeout if a navigation never lands), so an earlier tap committing late
 * cannot move the highlight off the destination the user is actually going
 * to. */

type NavState = {
  /** The section to highlight: the pending tap, else the one for the URL. */
  active: BusinessSection;
  /** The tab a tap is heading to (null when idle). */
  pendingTab: string | null;
  /** True while a tap is heading to a DIFFERENT destination than the one on
   * screen — the content slot shows that destination's skeleton right away. */
  enteringNew: boolean;
  start: (tab: string) => void;
};

const NavContext = createContext<NavState | null>(null);

/** A tap that never lands (cancelled, failed, redirected elsewhere) must not
 * leave the highlight stuck on the wrong item. */
const PENDING_TIMEOUT_MS = 8000;

export function ManagerNavProvider({ fixedSection: fixedProp, children }: { fixedSection?: BusinessSection; children: ReactNode }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // The Manager's own sub-routes listed in More (Inbox, Search) highlight More.
  const fixedSection = fixedProp ?? (/\/account\/business\/[^/]+\/(inbox|search)(\/|$)/.test(pathname) ? "more" : undefined);
  const urlTab = canonicalTab(searchParams.get("tab"));
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPendingTab(null);
  }, []);

  const start = useCallback(
    (tab: string) => {
      if (timer.current) clearTimeout(timer.current);
      setPendingTab(tab);
      timer.current = setTimeout(clear, PENDING_TIMEOUT_MS);
    },
    [clear]
  );

  // The tap landed. Clear on ANY URL change after a tap, not just a match: a
  // redirecting key (legacy tab, referral) ends on a different tab than the
  // one tapped, and Next discards an older pending navigation when a newer one
  // starts, so an earlier tap can never commit after the last one.
  const urlKey = `${pathname}?${searchParams.toString()}`;
  const lastUrlKey = useRef(urlKey);
  useEffect(() => {
    if (lastUrlKey.current === urlKey) return;
    lastUrlKey.current = urlKey;
    clear();
  }, [urlKey, clear]);
  // Tapping the destination already on screen changes nothing in the URL.
  useEffect(() => {
    if (pendingTab !== null && canonicalTab(searchParams.get("tab")) === pendingTab) clear();
  }, [pendingTab, searchParams, clear]);

  // Back/Forward is a navigation the user did not tap: drop any pending tap.
  useEffect(() => {
    window.addEventListener("popstate", clear);
    return () => {
      window.removeEventListener("popstate", clear);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clear]);

  // A standalone sub-page (fixedSection) is never part of any `?tab=` group,
  // so every primary tap from it enters a new destination.
  const enteringNew = pendingTab !== null && (fixedSection !== undefined || destinationGroup(pendingTab) !== destinationGroup(urlTab));
  const value = useMemo<NavState>(
    () => ({ active: pendingTab !== null ? sectionForTab(pendingTab) : (fixedSection ?? sectionForTab(urlTab)), pendingTab, enteringNew, start }),
    [pendingTab, fixedSection, urlTab, enteringNew, start]
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("ManagerNav must render inside ManagerNavProvider");
  return ctx;
}

/** The content slot of the persistent shell. On a tap that enters a different
 * destination it swaps to that destination's skeleton on the very same frame
 * (the server round trip hasn't started answering yet), then the real view
 * replaces it. The shell around it — identity, switcher, navigation — never
 * changes. */
export function ManagerContentFrame({ children }: { children: ReactNode }) {
  const { enteringNew, pendingTab, start } = useNav();
  const pathname = usePathname();
  // Any link inside the content that opens another `?tab=` of this same
  // manager page (the More menu, Home's tiles and "See All", Needs Attention,
  // …) is a destination tap too, so it gets the same instant response without
  // every such link having to know about it.
  //
  // This runs in the BUBBLE phase, after Next's own <Link> handler has already
  // claimed the click (it calls preventDefault and starts the client
  // navigation). Reacting before that — in the capture phase — would swap the
  // link out from under Next and degrade the tap to a full page load.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!e.defaultPrevented || !isPlainLeftClick(e)) return;
    const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, window.location.href);
    const tab = url.searchParams.get("tab");
    if (url.origin === window.location.origin && url.pathname === pathname && tab) start(canonicalTab(tab));
  };
  return (
    <div className="min-w-0" onClick={onClick}>
      {enteringNew && pendingTab !== null ? <ManagerSkeleton tab={pendingTab} /> : children}
    </div>
  );
}

/** Modified clicks (new tab/window, download) don't navigate this tab. */
export function isPlainLeftClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export type ManagerNavItem = { section: BusinessSection; label: string; tab: string; desktopOnly?: boolean; icon: ReactNode };

/** Desktop rail. */
export function ManagerRail({ basePath, items }: { basePath: string; items: ManagerNavItem[] }) {
  const { active, start } = useNav();
  return (
    <nav aria-label="Business" className="hidden lg:sticky lg:top-[4.25rem] lg:flex lg:flex-col lg:gap-0.5">
      {items.map((item) => {
        const isActive = item.section === active;
        return (
          <Link
            key={item.section}
            href={`${basePath}?tab=${item.tab}`}
            onClick={(e) => isPlainLeftClick(e) && start(item.tab)}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
              isActive ? "bg-findmi-50 text-accent" : "text-muted hover:bg-black/[0.03] hover:text-primary"
            }`}
          >
            <span className={isActive ? "text-findmi-700" : "text-ink/40"}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom tab bar — thumb-reachable, five equal columns (never a
 * scrolling strip), safe-area aware. Persistent: it lives in the shell, so a
 * tab switch never re-mounts it. */
export function ManagerBottomBar({ basePath, items }: { basePath: string; items: ManagerNavItem[] }) {
  const { active, start } = useNav();
  return (
    <nav
      aria-label="Business"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.07] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items
          .filter((i) => !i.desktopOnly)
          .map((item) => {
            // Products and Growth have no bottom-bar slot on phones: they sit
            // under More, so More stays highlighted while inside them.
            const isActive = item.section === active || (item.section === "more" && (active === "products" || active === "growth"));
            return (
              <Link
                key={item.section}
                href={`${basePath}?tab=${item.tab}`}
                onClick={(e) => isPlainLeftClick(e) && start(item.tab)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 text-[10.5px] font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40 ${
                  isActive ? "text-accent" : "text-ink/45 hover:text-ink/70"
                }`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${isActive ? "bg-findmi-50" : ""}`}>{item.icon}</span>
                {/* Mobile nav label truncation fix — a label that doesn't
                    quite fit a 1/5-width column at 360-412px wraps onto a
                    controlled second line instead of being cut. min-h is a
                    floor, not a cap; labels are never renamed. */}
                <span className="max-w-full text-center leading-[1.15]">{item.label}</span>
              </Link>
            );
          })}
      </div>
    </nav>
  );
}
