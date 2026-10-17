"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The one scroll-depth primitive (extracted from EventCoverLightbox): a
 * wrapper 48px taller than its clipping parent that drifts 48px over the
 * first 320px of page scroll. CSS scroll-driven animation where supported
 * (.findmi-hero-parallax in globals.css); otherwise the same transform
 * from a passive, rAF-throttled scroll listener. Reduced motion → static,
 * on both paths. The parent must be `relative overflow-hidden`. */
export default function ParallaxMedia({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof CSS === "undefined") return;
    if (CSS.supports("animation-timeline: scroll()")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const y = Math.min(48, Math.max(0, window.scrollY) * 0.15);
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  if (!enabled) return <>{children}</>;
  return (
    <div ref={ref} className="findmi-hero-parallax absolute inset-x-0 -top-12 bottom-0">
      {children}
    </div>
  );
}
