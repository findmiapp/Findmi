import Link from "next/link";

export interface ActiveFilterChip {
  label: string;
  /** URL with just this one filter removed, every other param preserved. */
  href: string;
}

/**
 * Compact removable filter chips (Discovery/Archive V2 Part 3) — plain
 * links, no client state. Each chip's `href` is computed by the caller
 * (it already has the current URLSearchParams) so this component stays
 * generic across Businesses/Events rather than knowing what a "category"
 * or "location" filter is.
 */
export default function ActiveFilterChips({ chips, clearHref }: { chips: ActiveFilterChip[]; clearHref: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className="flex max-w-[70vw] items-center gap-1 rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-medium text-ink/75 transition hover:bg-ink/10 sm:max-w-[240px]"
        >
          <span className="truncate">{chip.label}</span>
          <span aria-hidden="true" className="shrink-0 text-ink/40">
            ×
          </span>
        </Link>
      ))}
      {chips.length > 0 && (
        <Link href={clearHref} className="px-1.5 text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink">
          Clear All
        </Link>
      )}
    </div>
  );
}
