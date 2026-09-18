"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Small, generic URL-param select control — a native <select> that
 * navigates on change (updates its own URL param, preserving every other
 * param). URL-driven like everything else in Discovery/Archive V2, so the
 * resulting view is still a shareable/back-button-safe link, not
 * client-only state. Originally built for `sort` on /businesses; Homepage
 * Market Filtering V1 reuses it as-is (via the `label`/`paramName` props)
 * for the homepage's "Market" selector — same exact URL-param behavior,
 * no new component needed.
 */
export default function SortSelect({
  options,
  paramName = "sort",
  label = "Sort",
}: {
  options: { value: string; label: string }[];
  paramName?: string;
  label?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramName) ?? options[0]?.value ?? "";

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value === options[0]?.value) params.delete(paramName);
    else params.set(paramName, e.target.value);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    // Businesses Discovery V4 — shrunk from h-10/px-3.5/text-sm to
    // h-9/px-2.5/text-xs, and the text "Sort:" prefix replaced with a
    // small sort-arrows icon (aria-hidden — the current value plus
    // native <select> semantics already say "sort" without it), to fit
    // the consolidated Area/Filters/Sort toolbar on one row down to
    // 360px. Sole remaining caller is /businesses' own sort control (see
    // this file's own doc comment — the historical homepage reuse no
    // longer exists, so this doesn't risk resizing/relabeling anything
    // else). `label` still reaches the select itself via aria-label, so
    // this stays exactly as accessible as the text version was.
    <label className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-black/10 px-2 text-xs text-ink/70">
      <SortGlyph className="h-3.5 w-3.5 shrink-0 text-ink/40" />
      <select
        value={current}
        onChange={handleChange}
        aria-label={label}
        className="bg-transparent text-xs font-bold text-ink focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M7 5v14M7 19l-3-3M7 19l3-3M17 19V5M17 5l-3 3M17 5l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
