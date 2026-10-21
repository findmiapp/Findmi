"use client";

import { useId, useState } from "react";
import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import type { NeedsAttentionItem } from "@/lib/business-dashboard";

/** Needs Attention — a compact, collapsed-by-default status bar on Business
 * Home. One quiet row ("Needs Attention", a small count badge, a circular
 * chevron on the far right); tapping the row opens the actual items inline,
 * each with its existing call to action. Renders NOTHING when there is
 * nothing to act on — silence is the successful state. The items and their
 * detection live upstream (lib/business-dashboard.ts); this only presents
 * them. */
export default function NeedsAttentionBar({ items }: { items: NeedsAttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (items.length === 0) return null;

  return (
    <section id="home-attention" aria-label="Needs Attention" className="scroll-mt-[104px] overflow-hidden rounded-2xl border border-amber-200/70 bg-amber-50/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[48px] w-full items-center gap-2.5 px-3.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40"
      >
        <span className="font-display text-card-title font-bold text-primary">Needs Attention</span>
        <span
          aria-label={`${items.length} ${items.length === 1 ? "item" : "items"}`}
          className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-none text-white"
        >
          {items.length}
        </span>
        <span aria-hidden="true" className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-ink/50 shadow-sm ring-1 ring-black/[0.06]">
          <ChevronIcon direction="down" className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <ul id={panelId} className="divide-y divide-amber-200/60 border-t border-amber-200/60">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.actionHref} className="flex items-start gap-3 px-3.5 py-2.5 transition hover:bg-amber-50/70">
                <span className="min-w-0 flex-1">
                  <span className="block text-card-title font-semibold text-primary">{item.title}</span>
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
    </section>
  );
}
