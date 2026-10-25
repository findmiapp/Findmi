import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import type { GeoResult } from "@/lib/geo-results";

// One map result (archive Map mode, detail-page maps) — the same card
// language as MapResultCard: white card, rounded-2xl, LIVE in words.

export default function GeoResultCard({ result, compact = false }: { result: GeoResult; compact?: boolean }) {
  const img = result.image ?? result.logo;
  return (
    <article data-geo-card={result.key} className="relative flex gap-3 rounded-2xl border border-black/5 bg-white p-2.5">
      <div className={`relative shrink-0 overflow-hidden rounded-xl bg-black/5 ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
        {img ? (
          <SupabaseImage src={img} alt="" fill sizes="64px" className={result.image ? "object-cover" : "object-contain p-1.5"} />
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
        <Link href={result.href} className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink after:absolute after:inset-0 after:rounded-2xl hover:underline">
          {result.title}
        </Link>
        {result.subtitle && <p className="truncate text-xs text-ink/55">{result.subtitle}</p>}
      </div>
    </article>
  );
}
