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
    <label className="flex h-10 items-center gap-1.5 rounded-full border border-black/10 px-3.5 text-sm text-ink/70">
      <span className="text-ink/40">{label}:</span>
      <select
        value={current}
        onChange={handleChange}
        className="bg-transparent font-semibold text-ink focus:outline-none"
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
