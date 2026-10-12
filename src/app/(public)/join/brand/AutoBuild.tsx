"use client";

import { useEffect, useRef } from "react";

/** Brand onboarding auth resume — rendered INSIDE the existing Build form
 * only when /join/brand was reached back from sign-in / sign-up with the
 * build intent marker, the visitor is signed in, and the website still has
 * no match. It submits that same form (the existing server action, which
 * re-checks everything) exactly once, so the visitor never presses Build
 * My Brand Profile twice. One-shot by construction:
 *  - the marker is removed from the URL first, so a refresh or a Back to
 *    this page shows the ordinary Build button instead of building again;
 *  - a ref ignores re-renders / development double effects;
 *  - a short-lived per-tab guard covers a restored page (bfcache).
 * Never a GET with side effects, never creates a Business. */
const GUARD_MS = 10 * 60 * 1000;

export default function AutoBuild({ guardKey, param }: { guardKey: string; param: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const url = new URL(window.location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const key = `findmi:brand-build:${guardKey}`;
    try {
      const last = Number(window.sessionStorage.getItem(key));
      if (last && Date.now() - last < GUARD_MS) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage unavailable (private mode): the URL marker removal above
      // and the ref still make this one-shot for this page.
    }
    ref.current?.closest("form")?.requestSubmit();
  }, [guardKey, param]);

  return <span ref={ref} hidden />;
}
