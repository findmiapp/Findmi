"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DISCOVERY_TIME_TABS, type DiscoveryTimeKey } from "@/lib/format";

/** QA Correction pass — root cause of the reported tap lag: the pills were
 * plain server-rendered <Link>s, and "active" was derived purely from the
 * server's own resolved `timeKey` (from the request's searchParams). A tap
 * navigates (even client-side, App Router still waits on the new RSC
 * payload — which itself waits on getUpcomingEvents — before it can
 * re-render), so the pill's own highlight never changed until that whole
 * round trip finished, which reads as "nothing happened" for a beat on
 * mobile. This is the smallest fix that gives real immediate feedback
 * without a new state architecture: the exact same real <Link> navigation
 * as before (real URL, real ?when=, no client-side fetch, no duplicate
 * filtering system), wrapped in one small client component that flips its
 * own local "which pill looks active" state the instant a pill is tapped
 * — before navigation/data resolves — and re-syncs from the server's real
 * value once the navigation actually lands (covers back/forward, a
 * shared/bookmarked link, etc.). Select Area, the carousel, and the
 * underlying filtering semantics are completely untouched — this only
 * wraps the pill row itself. */
export default function HomeTimeFilterRail({
  activeKey,
  marketSlug,
  areaSlug,
}: {
  activeKey: DiscoveryTimeKey;
  marketSlug?: string;
  areaSlug?: string;
}) {
  const [optimisticKey, setOptimisticKey] = useState<DiscoveryTimeKey>(activeKey);

  // Re-sync once the server's own value actually changes (navigation
  // landed, or the visitor arrived via back/forward/a direct link) — never
  // fights the optimistic tap in between.
  useEffect(() => {
    setOptimisticKey(activeKey);
  }, [activeKey]);

  return (
    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {DISCOVERY_TIME_TABS.map((t) => {
        const params = new URLSearchParams();
        if (t.key !== "next") params.set("when", t.key);
        if (marketSlug) params.set("market", marketSlug);
        if (marketSlug && areaSlug) params.set("area", areaSlug);
        const href = `/${params.toString() ? `?${params.toString()}` : ""}`;
        const active = optimisticKey === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            scroll={false}
            onClick={() => setOptimisticKey(t.key)}
            aria-current={active ? "true" : undefined}
            className={`flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border px-3.5 text-sm transition ${
              active ? "border-findmi bg-findmi text-white" : "border-black/10 text-ink/70 hover:border-black/20"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
