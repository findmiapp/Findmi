"use client";

import { useId, useState } from "react";
import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import type { NeedsAttentionItem } from "@/lib/business-dashboard";

/** Needs Attention — ONE compact, collapsed-by-default row at the top of Home's
 * Inbox / Follow-Ups panel (it shares the panel, never a box of its own): a
 * small amber marker, "Needs Attention", a count badge and a chevron; tapping
 * the row opens the actual items inline, each with its existing call to
 * action. Renders NOTHING when there is nothing to act on — silence is the
 * successful state. The items and their detection live upstream
 * (lib/business-dashboard.ts); this only presents them. */
export default function NeedsAttentionBar({ items }: { items: NeedsAttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (items.length === 0) return null;

  return (
    <div id="home-attention" role="group" aria-label="Needs Attention" className="scroll-mt-[104px] bg-amber-50/50">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[40px] w-full items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
        <span className="text-metadata font-semibold text-amber-800">Needs Attention</span>
        <span
          aria-label={`${items.length} ${items.length === 1 ? "item" : "items"}`}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-none text-white"
        >
          {items.length}
        </span>
        <span aria-hidden="true" className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-ink/50 ring-1 ring-black/[0.06]">
          <ChevronIcon direction="down" className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <ul id={panelId} className="divide-y divide-amber-200/60 border-t border-amber-200/60">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.actionHref} className="flex items-start gap-3 px-3 py-2 transition hover:bg-amber-50/70">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold leading-snug text-primary">{item.title}</span>
                  <span className="block text-metadata text-secondary">{item.message}</span>
                </span>
                <span className="mt-0.5 flex shrink-0 items-center gap-1 text-metadata font-bold text-accent">
                  {item.actionLabel}
                  <ChevronIcon direction="right" className="h-3 w-3" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
