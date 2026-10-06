"use client";

import { useEffect, useState } from "react";

/** True once `target` comes within `rootMargin` of `root` (the viewport by
 * default, or a scroll container such as a carousel) — and stays true, so
 * a Moment that started loading is never unloaded. `waitForRoot` holds off
 * until a scroll-container root has mounted. Without IntersectionObserver
 * it is simply true (load normally). */
export function useNearViewport(
  target: Element | null,
  { root = null, rootMargin = "0px", waitForRoot = false }: { root?: Element | null; rootMargin?: string; waitForRoot?: boolean } = {}
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !target || (waitForRoot && !root)) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { root, rootMargin }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [near, target, root, rootMargin, waitForRoot]);
  return near;
}
