import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import type { GeoResult } from "@/lib/geo-results";

// One map result (archive Map mode, detail-page maps) — the same card
// language as MapResultCard: white card, rounded-2xl, LIVE in words.
//
// Selection model (Map Discovery Batch 1):
//   - without `onSelect`            the whole card is the link
//   - with `onSelect`, not selected a tap selects its place on the map
//   - with `onSelect`, `selected`   the whole card opens the public page
// A separate "View" link is only kept where a surface still asks for it
// (`viewLink`, detail-page maps whose tap opens an in-page view instead).

export default function GeoResultCard({
  result,
  compact = false,
  selected = false,
  highlighted = false,
  onSelect,
  viewLink = true,
}: {
  result: GeoResult;
  compact?: boolean;
  /** The result's place is the selected one: the card is the link. */
  selected?: boolean;
  /** Visual emphasis only (browsing the Peek strip) — taps still select. */
  highlighted?: boolean;
  onSelect?: (result: GeoResult) => void;
  /** Keep the separate "View" link next to a selecting card. */
  viewLink?: boolean;
}) {
  const img = result.image ?? result.logo;
  const linked = !onSelect || selected;
  const emphasis = selected || highlighted;
  // Selected cards are a step larger: a bigger thumbnail and title, so the
  // thing the marker points at reads first.
  const media = selected ? (compact ? "h-16 w-16" : "h-[4.5rem] w-[4.5rem]") : compact ? "h-14 w-14" : "h-16 w-16";
  return (
    <article
      data-geo-card={result.key}
      aria-current={selected ? "true" : undefined}
      className={`relative flex h-full gap-3 rounded-2xl border bg-white transition ${selected ? "p-3" : "p-2.5"} ${emphasis ? "border-findmi shadow-[0_0_0_3px_rgba(20,176,188,0.18)]" : "border-black/5"} ${linked ? "hover:border-findmi/60" : ""}`}
    >
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-black/5 ${media}`}>
        {img ? (
          <SupabaseImage src={img} alt="" fill sizes="72px" className={result.image ? "object-cover" : "object-contain p-1.5"} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <span className="font-display text-lg font-bold text-white/30">{result.title.slice(0, 1)}</span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        {result.live ? (
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
            Live
          </span>
        ) : result.status ? (
          <span className="truncate text-[11px] font-bold text-ink/55">{result.status}</span>
        ) : null}
        {linked ? (
          <Link href={result.href} className={`line-clamp-2 break-words font-display font-bold leading-snug text-ink after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-findmi ${selected ? "text-[15px]" : "text-sm"}`}>
            {result.title}
          </Link>
        ) : (
          <button type="button" onClick={() => onSelect?.(result)} aria-pressed={false} className="min-w-0 text-left after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-findmi">
            <span className="line-clamp-2 break-words font-display text-sm font-bold leading-snug text-ink">{result.title}</span>
          </button>
        )}
        {result.subtitle && <p className="truncate text-xs text-ink/55">{result.subtitle}</p>}
      </div>
      {!linked && viewLink && (
        <Link href={result.href} aria-label={`View ${result.title}`} className="relative z-10 flex shrink-0 items-center self-center rounded-full px-2 py-2 text-xs font-bold text-findmi-700 hover:underline">
          View
        </Link>
      )}
    </article>
  );
}
