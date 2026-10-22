"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { OVERVIEW_ANCHOR_ID, type SectionAnchorItem } from "@/lib/section-anchors";

/** Contextual navigation for long public entity pages — a horizontally
 * swipeable row of anchors to the sections that actually exist on THIS page
 * (see lib/section-anchors.ts). Navigation, not filtering: every chip is a
 * real `#id` link (it works without JS); with JS it scrolls smoothly and
 * lands the section just below whatever is stuck at the top.
 *
 * Mobile: sticks directly under the fixed 56px site header (+ safe area and
 * the admin bar when present). Desktop: stays in the flow — the sticky site
 * header and the sticky right rails already own the top of the viewport, so
 * a second sticky layer would collide with them.
 *
 * Active chip: one rAF-throttled scroll listener — the last section whose
 * top has passed the line under the stuck chrome (the first chip, "Overview",
 * above it; the last chip at the very bottom). A tapped chip stays active
 * until its smooth scroll settles. The active chip is kept in view inside the
 * row's own horizontal scroll, never the page's. Arrow keys / Home / End move
 * between chips. No layout work outside the row itself: no negative margins,
 * so it can't add horizontal page overflow. */

const DESKTOP_HEADER_FALLBACK = 65;

export default function SectionAnchorNav({
  items,
  label = "On this page",
  containerClassName = "mx-auto max-w-6xl px-4 sm:px-6",
}: {
  items: SectionAnchorItem[];
  label?: string;
  /** Aligns the row with the page's own content column. */
  containerClassName?: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef<{ timer: number } | null>(null);
  const [active, setActive] = useState<string>(items[0]?.id ?? OVERVIEW_ANCHOR_ID);
  // Chips whose section is not in the DOM right now are hidden: a section can
  // come and go on the client (e.g. an Event's lineup follows the selected
  // date), and a chip must never point at nothing.
  const [missing, setMissing] = useState<string>("");
  const ids = items.map((i) => i.id).join(",");

  /** Bottom edge of everything stuck at the top (px from viewport top). */
  const stuckBottom = () => {
    const nav = navRef.current;
    // Where the sticky row WILL rest (its `top` offset + its own height) — not
    // where it happens to be right now, which before the first stick is its
    // natural spot far down the page.
    if (nav && getComputedStyle(nav).position === "sticky") return (parseFloat(getComputedStyle(nav).top) || 0) + nav.offsetHeight;
    const header = document.querySelector("header");
    const rect = header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect() : null;
    return rect && rect.bottom > 0 ? rect.bottom : DESKTOP_HEADER_FALLBACK;
  };

  useEffect(() => {
    const targets = ids.split(",").filter((id) => id !== OVERVIEW_ANCHOR_ID);
    let frame = 0;
    const update = () => {
      frame = 0;
      const gone = targets.filter((id) => !document.getElementById(id)).join(",");
      setMissing((prev) => (prev === gone ? prev : gone));
      const line = stuckBottom() + 24;
      let current = OVERVIEW_ANCHOR_ID;
      for (const id of targets) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && targets.length) {
        const last = targets.filter((id) => document.getElementById(id)).pop();
        if (last) current = last;
      }
      setActive(current);
    };
    const onScroll = () => {
      const lock = lockRef.current;
      if (lock) {
        window.clearTimeout(lock.timer);
        lock.timer = window.setTimeout(() => (lockRef.current = null), 150);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Keep the active chip inside the row's own horizontal scroll.
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>(`[data-anchor="${active}"]`);
    if (!rail || !chip) return;
    const left = chip.offsetLeft - (rail.clientWidth - chip.offsetWidth) / 2;
    if (chip.offsetLeft < rail.scrollLeft || chip.offsetLeft + chip.offsetWidth > rail.scrollLeft + rail.clientWidth) {
      rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    }
  }, [active]);

  function go(e: MouseEvent<HTMLAnchorElement>, id: string) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = smooth ? "smooth" : "auto";
    if (lockRef.current) window.clearTimeout(lockRef.current.timer);
    lockRef.current = { timer: window.setTimeout(() => (lockRef.current = null), 700) };
    setActive(id);
    if (id === OVERVIEW_ANCHOR_ID) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const el = document.getElementById(id);
    if (!el) return; // let the browser's own #hash jump handle it
    e.preventDefault();
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stuckBottom() - 12, behavior });
    // Keep the URL shareable without adding history entries.
    history.replaceState(null, "", `#${id}`);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-anchor]"));
    const at = chips.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    chips[(next + chips.length) % chips.length]?.focus();
  }

  if (items.length === 0) return null;
  return (
    <nav
      ref={navRef}
      aria-label={label}
      data-section-anchor-nav
      className="sticky top-[calc(3.5rem+env(safe-area-inset-top,0px)+var(--admin-bar-h,0px))] z-30 border-b border-black/[0.06] bg-paper/95 backdrop-blur lg:static lg:z-auto lg:bg-transparent lg:backdrop-blur-none"
    >
      <div className={containerClassName}>
      <div
        ref={railRef}
        onKeyDown={onKeyDown}
        className="relative flex h-11 snap-x scroll-px-1 items-center gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.filter((item) => !missing.split(",").includes(item.id)).map((item) => {
          const isActive = item.id === active;
          return (
            <a
              key={item.id}
              href={item.id === OVERVIEW_ANCHOR_ID ? "#" : `#${item.id}`}
              data-anchor={item.id}
              aria-current={isActive ? "location" : undefined}
              onClick={(e) => go(e, item.id)}
              className={`flex h-8 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-3 text-metadata font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40 ${
                isActive ? "bg-findmi-50 text-findmi-700" : "text-muted hover:text-primary"
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </div>
      </div>
    </nav>
  );
}
