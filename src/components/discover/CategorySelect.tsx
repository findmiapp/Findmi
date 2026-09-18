"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Locations Discovery V4 — a small, generic URL-param `<select>` that
 * navigates on change (updates its own URL param, preserving every other
 * param), the exact same idiom SortSelect already established for
 * /businesses' sort control. A separate, small component rather than a
 * reused/generalized SortSelect: that component's own sort-arrows icon
 * would misread as a sort control here, and Locations only ever has this
 * one meaningful filter beyond Area — exposed directly (this control)
 * rather than behind a Filter Sheet, per this pass's own guidance not to
 * build a sheet for a single filter. SortSelect itself is left
 * completely untouched.
 */
export default function CategorySelect({
  options,
  paramName = "category",
  label = "Category",
  allLabel = "All Categories",
}: {
  options: { value: string; label: string }[];
  paramName?: string;
  label?: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (!e.target.value) params.delete(paramName);
    else params.set(paramName, e.target.value);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <label className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-black/10 px-3 text-xs text-ink/70">
      <TagGlyph className="h-3.5 w-3.5 shrink-0 text-ink/40" />
      <select
        value={current}
        onChange={handleChange}
        aria-label={label}
        className="bg-transparent text-xs font-bold text-ink focus:outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TagGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M11.5 4H6a2 2 0 00-2 2v5.5a2 2 0 00.6 1.4l8 8a2 2 0 002.8 0l5.5-5.5a2 2 0 000-2.8l-8-8A2 2 0 0011.5 4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="9" r="1.3" fill="currentColor" />
    </svg>
  );
}
