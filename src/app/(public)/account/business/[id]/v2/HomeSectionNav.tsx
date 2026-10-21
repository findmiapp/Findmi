"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Business Home's thin sticky section rail — moves WITHIN the Home page
 * only (anchored smooth scroll), never between routes. That job belongs
 * to the Business bottom navigation (Home · Findmi Here · Moments ·
 * Performance · More); identity/status belongs to the header above.
 *
 * Sticks directly under the 48px OwnerHeader (3px Aqua strip + 44px bar +
 * 1px border). Each target section carries the matching scroll-margin
 * (HOME_SECTION_SCROLL_MARGIN) so a heading is never hidden under the
 * header + this rail. "Overview" returns to the top of Home.
 *
 * Active state follows natural scrolling with one rAF-throttled scroll
 * listener: the last section whose top has passed the sticky chrome is
 * active; above the first one, Overview; at the very end of the page, the
 * last section. A tapped section stays active until its scroll settles.
 * The active chip is kept visible inside the rail's own horizontal scroll
 * (never the page's). */

export const HOME_SECTION_STICKY_TOP = 48;
const RAIL_HEIGHT = 44;
const ACTIVE_LINE = HOME_SECTION_STICKY_TOP + RAIL_HEIGHT + 16;

export interface HomeSectionNavItem {
  id: string;
  label: string;
  count?: number;
}

export default function HomeSectionNav({ items }: { items: HomeSectionNavItem[] }) {
  const [active, setActive] = useState<string>("overview");
  const railRef = useRef<HTMLDivElement>(null);
  // After a tap, the tapped section stays active until that smooth scroll
  // settles — on a short page the last sections can't reach the sticky
  // line, and the scroll-position rule would otherwise relabel them.
  const lockRef = useRef<{ id: string; timer: number } | null>(null);
  const ids = items.map((i) => i.id).join(",");

  useEffect(() => {
    const targets = ids.split(",").filter((id) => id !== "overview");
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = "overview";
      for (const id of targets) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= ACTIVE_LINE) current = id;
      }
      // At the very bottom the last short section can never reach the
      // line — treat reaching the end of the page as that section.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && targets.length) {
        const last = targets.filter((id) => document.getElementById(id)).pop();
        if (last) current = last;
      }
      setActive(current);
    };
    const onScroll = () => {
      const lock = lockRef.current;
      if (lock) {
        // Still settling from a tap: extend the lock, keep the tapped id.
        window.clearTimeout(lock.timer);
        lock.timer = window.setTimeout(() => {
          lockRef.current = null;
        }, 150);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);

  // The rail's end stop must also be a chip boundary: a trailing spacer
  // sized so the furthest scroll position is the first snap point at which
  // the last chip is fully visible — never a position that leaves part of
  // a label clipped at the left edge. Re-measured on resize.
  const spacerRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const rail = railRef.current;
    const spacer = spacerRef.current;
    if (!rail || !spacer) return;
    const measure = () => {
      const style = getComputedStyle(rail);
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const padRight = parseFloat(style.paddingRight) || 0;
      const gap = parseFloat(style.columnGap) || 0;
      const railLeft = rail.getBoundingClientRect().left;
      const chips = Array.from(rail.querySelectorAll<HTMLElement>("[data-section]"));
      const last = chips[chips.length - 1];
      if (!last) return;
      const startOf = (el: HTMLElement) => el.getBoundingClientRect().left - railLeft + rail.scrollLeft;
      const lastEnd = startOf(last) + last.offsetWidth;
      const stop = chips.map((c) => Math.max(0, startOf(c) - padLeft)).find((p) => lastEnd + padRight <= p + rail.clientWidth) ?? 0;
      spacer.style.width = `${Math.max(0, stop + rail.clientWidth - lastEnd - padRight - gap)}px`;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ids]);

  // Keep the active chip fully in view within the rail itself, always
  // resting on a chip boundary (the rail is snap-mandatory, every chip
  // snap-start against the rail's own gutter) so no clipped fragment of a
  // label is left at the edge.
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!rail || !chip) return;
    const style = getComputedStyle(rail);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const max = rail.scrollWidth - rail.clientWidth;
    const railLeft = rail.getBoundingClientRect().left;
    const chips = Array.from(rail.querySelectorAll<HTMLElement>("[data-section]"));
    const startOf = (el: HTMLElement) => el.getBoundingClientRect().left - railLeft + rail.scrollLeft;
    const snapPoints = chips.map((c) => Math.min(max, Math.max(0, startOf(c) - padLeft)));
    const chipStart = startOf(chip);
    const chipEnd = chipStart + chip.offsetWidth;
    let target: number | null = null;
    if (chipStart - padLeft < rail.scrollLeft) target = snapPoints[chips.indexOf(chip)];
    else if (chipEnd + padRight > rail.scrollLeft + rail.clientWidth) {
      target = snapPoints.find((p) => chipEnd + padRight <= p + rail.clientWidth) ?? max;
    }
    if (target !== null && Math.abs(target - rail.scrollLeft) > 1) rail.scrollTo({ left: target, behavior: "smooth" });
  }, [active]);

  function go(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (lockRef.current) window.clearTimeout(lockRef.current.timer);
    lockRef.current = { id, timer: window.setTimeout(() => (lockRef.current = null), 600) };
    if (id === "overview") {
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
    setActive(id);
  }

  return (
    <nav
      aria-label="On this page"
      className="sticky top-12 z-30 -mx-4 border-b border-black/[0.06] bg-paper/95 backdrop-blur sm:-mx-6 lg:mx-0"
    >
      <div
        ref={railRef}
        className="flex h-11 snap-x snap-mandatory scroll-px-3 items-center gap-1 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:scroll-px-5 sm:px-5 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-section={item.id}
              aria-current={isActive ? "location" : undefined}
              onClick={(e) => go(e, item.id)}
              className={`flex h-8 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-metadata font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
                isActive ? "bg-findmi-50 text-findmi-700" : "text-muted hover:text-primary"
              }`}
            >
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span
                  className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-[18px] ${
                    isActive ? "bg-findmi text-white" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {item.count}
                </span>
              )}
            </a>
          );
        })}
        <span ref={spacerRef} aria-hidden="true" className="h-px shrink-0" />
      </div>
    </nav>
  );
}
