import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import LiveDot from "@/components/LiveDot";
import { formatCardWhen, isHappeningNow } from "@/lib/event-time";
import { formatCardDateRange } from "@/lib/format";
import type { DiscoveryItem } from "@/lib/discovery/engine";

// Discovery Intelligence V1 — the one result tile every discovery surface
// (search, Topic results, Area pages, homepage Lanes) renders. Same card
// language as AppearanceDiscoveryCard: square image, white card, small
// uppercase kicker, Inter display title. Server-renderable (no hooks).

const KIND_LABEL: Record<DiscoveryItem["kind"], string> = {
  event: "Event",
  appearance: "Pop-Up",
  business: "Brand",
  place: "Place",
  moment: "Moment",
};

export default function DiscoveryTile({ item, priority = false }: { item: DiscoveryItem; priority?: boolean }) {
  const live = isHappeningNow(item);
  const when = item.start_at || item.start_date ? formatCardWhen(item, formatCardDateRange) : null;
  return (
    <Link
      href={item.href}
      data-discovery-kind={item.kind}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition active:scale-[0.98] hover:border-black/10 hover:shadow"
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-black/5">
        {item.image ? (
          <SupabaseImage src={item.image} alt={item.title} fill priority={priority} sizes="(min-width: 1024px) 18vw, (min-width: 640px) 28vw, 44vw" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-findmi-700 to-ink">
            <span className="font-display text-2xl font-bold text-white/25">{item.title.slice(0, 1)}</span>
          </div>
        )}
        {(live || when) && (
          <div className="absolute left-1.5 top-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/45 text-white backdrop-blur-sm"}`}>
              {live && <LiveDot className="text-white" />}
              {live ? "Here Now" : when}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink/40">{KIND_LABEL[item.kind]}</p>
        <p className="line-clamp-2 font-display text-xs font-bold leading-snug text-ink">{item.title}</p>
        {item.subtitle && <p className="truncate text-[11px] text-ink/45">{item.subtitle}</p>}
      </div>
    </Link>
  );
}

/** Horizontal snap rail (mobile) that becomes a grid on wide screens. */
export function DiscoveryRail({ items, empty }: { items: DiscoveryItem[]; empty?: string }) {
  if (items.length === 0) return empty ? <p className="text-sm text-ink/50">{empty}</p> : null;
  return (
    <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
      {items.map((i, n) => (
        <div key={`${i.kind}:${i.id}`} className="w-[44%] shrink-0 snap-start sm:w-auto">
          <DiscoveryTile item={i} priority={n < 2} />
        </div>
      ))}
    </div>
  );
}

export function DiscoveryGrid({ items }: { items: DiscoveryItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i, n) => (
        <DiscoveryTile key={`${i.kind}:${i.id}`} item={i} priority={n < 4} />
      ))}
    </div>
  );
}

export function DiscoveryRailSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[44%] shrink-0 sm:w-auto">
          <div className="aspect-square animate-pulse rounded-2xl bg-black/5" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-black/5" />
        </div>
      ))}
    </div>
  );
}
