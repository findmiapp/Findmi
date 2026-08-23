"use client";

import { useState } from "react";
import type { AppearanceFeedItem } from "@/lib/data";
import AppearanceFeedCard from "./AppearanceFeedCard";

// Homepage-only: compact temporal discovery directly under the signature
// card, so the first viewport shows more than one discovery without a full
// page navigation. All three lists are fetched server-side up front (same
// getFindMiHereFeed already used elsewhere) — this just swaps which
// pre-fetched list is visible, entirely client-side.
const TABS = [
  { key: "today", label: "Today" },
  { key: "weekend", label: "Weekend" },
  { key: "anytime", label: "Anytime" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function HomeDiscoveryTabs({
  today,
  weekend,
  anytime,
}: {
  today: AppearanceFeedItem[];
  weekend: AppearanceFeedItem[];
  anytime: AppearanceFeedItem[];
}) {
  const lists: Record<TabKey, AppearanceFeedItem[]> = { today, weekend, anytime };
  const firstNonEmpty = TABS.find((t) => lists[t.key].length > 0)?.key ?? "today";
  const [active, setActive] = useState<TabKey>(firstNonEmpty);
  const items = lists[active];

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/40">Find them when?</p>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              active === t.key
                ? "bg-findmi text-white"
                : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink/45">Nothing in this window yet.</p>
      ) : (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.slice(0, 8).map((item) => (
            <div key={item.id} className="w-60 shrink-0">
              <AppearanceFeedCard item={item} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
