import Link from "next/link";
import type { LocationHappening } from "@/lib/data";
import { formatDateRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import PostCard from "./PostCard";

/** Photo card for a horizontal carousel of what's coming up at a location. */
export function HappeningCard({ item }: { item: LocationHappening }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <PostCard
      href={item.href}
      image={item.imageUrl}
      kind="event"
      badgeLabel={when}
      badgeVariant={live ? "live" : "default"}
      title={item.title}
      metaLines={[
        ...(item.subtitle ? [{ icon: "tag" as const, text: item.subtitle }] : []),
        { icon: "calendar", text: formatDateRange(item.start_at, item.end_at) },
      ]}
      cta="Find Them"
    />
  );
}

/** Compact list row for the same data, for a scannable full list underneath
 * the carousel. */
export function HappeningRow({ item }: { item: LocationHappening }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-4 rounded-2xl border p-4 transition active:scale-[0.99] ${
        live ? "border-findmi-300 bg-findmi-50" : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 ${
          live ? "bg-findmi-500 text-white" : "bg-findmi-50 text-findmi-600"
        }`}
      >
        {live ? (
          <>
            <LiveDot className="text-white" />
            <span className="text-[11px] font-bold uppercase tracking-wide">Now</span>
          </>
        ) : (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              {new Date(item.start_at).toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className="text-xl font-bold leading-none">
              {new Date(item.start_at).getDate()}
            </span>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!live && (
          <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-600">{when}</p>
        )}
        <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatDateRange(item.start_at, item.end_at)}
        </p>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-xs text-ink/50">{item.subtitle}</p>
        )}
      </div>
      <span className="shrink-0 text-[11px] font-semibold text-findmi-600">Find Them</span>
    </Link>
  );
}
