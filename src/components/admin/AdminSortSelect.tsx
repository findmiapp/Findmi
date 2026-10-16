"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminListHref, type AdminListParams } from "@/lib/admin/list-page";

/** Shared Admin "Sort By" control. Each collection passes its own truthful
 * options (lib/admin/list-sort.ts). Changing the sort keeps search,
 * filters and the current view, resets to page 1, and navigates with the
 * Next router inside a transition (no full document reload). The URL is
 * the only sort state — `value` always comes from the server's parse. */
export default function AdminSortSelect({
  pathname,
  params,
  value,
  defaultValue,
  options,
}: {
  pathname: string;
  params: AdminListParams;
  value: string;
  /** Left out of the URL when chosen, so default URLs stay unchanged. */
  defaultValue: string;
  options: readonly { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink/60">
      <span className="shrink-0">Sort By</span>
      <select
        value={value}
        aria-label="Sort By"
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            router.replace(adminListHref(pathname, params, { sort: next === defaultValue ? null : next }), { scroll: false });
          });
        }}
        className="min-h-10 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-sm font-medium text-ink focus:border-ink/30 focus:outline-none sm:flex-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {pending && <span className="shrink-0 text-ink/40">Updating…</span>}
    </label>
  );
}
