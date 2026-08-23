import Link from "next/link";
import type { LocationHappening } from "@/lib/data";
import { formatDateRange } from "@/lib/format";
import PostCard from "./PostCard";

/** Photo card for a horizontal carousel of what's coming up at a location. */
export function HappeningCard({ item }: { item: LocationHappening }) {
  return (
    <PostCard
      href={item.href}
      image={item.imageUrl}
      kind="event"
      badgeLabel="Upcoming"
      title={item.title}
      metaLines={[
        { icon: "calendar", text: formatDateRange(item.start_at, item.end_at) },
        ...(item.subtitle ? [{ icon: "tag" as const, text: item.subtitle }] : []),
      ]}
    />
  );
}

/** Compact list row for the same data, for a scannable full list underneath
 * the carousel. */
export function HappeningRow({ item }: { item: LocationHappening }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm active:scale-[0.99]"
    >
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-findmi-50 py-2 text-findmi-600">
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          {new Date(item.start_at).toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className="text-xl font-bold leading-none">
          {new Date(item.start_at).getDate()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatDateRange(item.start_at, item.end_at)}
        </p>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-xs text-ink/50">{item.subtitle}</p>
        )}
      </div>
      <span className="shrink-0 text-[11px] font-semibold text-findmi-600">View</span>
    </Link>
  );
}
