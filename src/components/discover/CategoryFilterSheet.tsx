"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ChevronIcon from "@/components/ChevronIcon";

export interface CategoryFilterOption {
  id: string;
  slug: string;
  name: string;
}

/** Mobile Discover Composition pass — collapses the always-visible
 * category-pill wall into a compact "Filters" toolbar trigger (same
 * "button now, sheet on demand" shape as AreaPicker's own Area control),
 * so the full category list stops permanently occupying vertical space
 * above the first real content row. Same ?category= URL semantics the
 * old inline pills used (a re-selected category clears the filter,
 * exactly like the old "click again to clear" pill behavior), and the
 * same "All Categories" hand-off to /businesses' own full sheet — this is
 * a presentation change only, not a new filtering system. */
export default function CategoryFilterSheet({
  categories,
  allCategoriesHref,
  paramName = "category",
}: {
  categories: CategoryFilterOption[];
  allCategoriesHref: string;
  paramName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSlug = searchParams.get(paramName) ?? "";
  const currentLabel = categories.find((c) => c.slug === currentSlug)?.name ?? null;

  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function select(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!slug || slug === currentSlug) params.delete(paramName);
    else params.set(paramName, slug);
    router.push(`?${params.toString()}`, { scroll: false });
    setOpen(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={currentLabel ? `Filters: ${currentLabel}` : "Filters"}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 px-3 text-sm text-ink/70 transition hover:border-black/20"
      >
        <FilterGlyph className="h-3.5 w-3.5 shrink-0 text-ink/40" />
        <span className="truncate font-semibold text-ink">{currentLabel ?? "Filters"}</span>
        <ChevronDownGlyph className="h-3 w-3 shrink-0 text-ink/40" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filter by category">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-20 sm:bottom-auto sm:w-96 sm:-translate-x-1/2 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-black/5 p-4">
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Filter by category</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink/60 transition hover:bg-black/5"
              >
                <CloseGlyph className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => select("")}
                className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  currentSlug === "" ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.slug)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    currentSlug === c.slug ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
                  }`}
                >
                  {c.name}
                </button>
              ))}
              <Link
                href={allCategoriesHref}
                onClick={() => setOpen(false)}
                className="mt-3 flex w-full items-center justify-center gap-1 px-3 py-1.5 text-center text-xs font-semibold text-findmi-700 hover:underline"
              >
                All Categories
                <ChevronIcon direction="right" className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FilterGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
