"use client";

import { useId, useState } from "react";
import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import type { NeedsAttentionItem } from "@/lib/business-dashboard";

/** Home → the Inbox / Follow-Ups HEADING, carrying the Needs Attention count.
 * There is no Needs Attention row of its own any more: the Inbox rows below are
 * the attention surface and show immediately. When there are exceptions to fix
 * (lib/business-dashboard.ts), a compact amber count sits beside the title;
 * tapping it reveals those items inline, each with its existing call to action.
 * At zero there is no indicator at all — silence is the successful state. */
export default function NeedsAttentionBar({ items, titleId, title, viewAllHref }: { items: NeedsAttentionItem[]; titleId: string; title: string; viewAllHref: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = items.length;

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 id={titleId} className="font-display text-section-title font-bold leading-tight text-primary">
          {title}
        </h2>
        {count > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${count} ${count === 1 ? "item needs" : "items need"} attention`}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-amber-50 pl-1 pr-1.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
          >
            <span aria-hidden="true" className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] leading-none text-white">
              {count}
            </span>
            <span aria-hidden="true" className="hidden min-[400px]:inline">
              Needs Attention
            </span>
            <ChevronIcon direction="down" className={`h-2.5 w-2.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
        <Link href={viewAllHref} className="ml-auto flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          View All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>
      {count > 0 && open && (
        <ul id={panelId} className="mt-1.5 divide-y divide-amber-200/60 overflow-hidden rounded-xl border border-amber-200/70 bg-amber-50/50">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.actionHref} className="flex items-center gap-2.5 px-2.5 py-1.5 transition hover:bg-amber-50/70">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight text-primary">{item.title}</span>
                  <span className="block truncate text-[12px] leading-tight text-secondary">{item.message}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent">
                  {item.actionLabel}
                  <ChevronIcon direction="right" className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
