import Link from "next/link";
import type { LocationHappening } from "@/lib/data";
import { formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import PostCard from "./PostCard";

/** Location Upcoming CTA Semantics fix — "Find Them" made sense for
 * finding a business/vendor, not opening an Event happening at this
 * Location. `item.type` is set once, at the query (getUpcomingAtLocation
 * in lib/data.ts), never inferred here from title/text. Destination
 * (item.href) is unaffected either way. */
function happeningCtaLabel(type: LocationHappening["type"]): string {
  return type === "event" ? "View Event" : "View Appearance";
}

/** Photo card for a horizontal carousel of what's coming up at a location. */
export function HappeningCard({ item }: { item: LocationHappening }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <PostCard
      href={item.href}
      image={item.imageUrl}
      kind="event"
      badgeLabel={live ? "Happening Now" : when}
      badgeVariant={live ? "live" : "default"}
      title={item.title}
      metaLines={[
        ...(item.subtitle ? [{ icon: "tag" as const, text: item.subtitle }] : []),
        { icon: "calendar", text: formatAppearanceDateRange(item.start_at, item.end_at, item.description) },
      ]}
      cta={happeningCtaLabel(item.type)}
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
        live ? "border-findmi/50 bg-findmi-50" : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 ${
          live ? "animate-happening-now-glow bg-red-600 text-white" : "bg-black/[0.04] text-ink"
        }`}
      >
        {live ? (
          <>
            <LiveDot className="text-white" />
            {/* Appearance UX Cleanup pass, item 4 — same two-line
                "Happening"/"NOW" treatment as AppearanceCard's identical
                tile pattern; see that file's own note. */}
            <span className="flex flex-col items-center leading-[1.15]">
              <span className="text-[7px] font-bold uppercase tracking-normal">Happening</span>
              <span className="text-xs font-extrabold uppercase tracking-wide">Now</span>
            </span>
          </>
        ) : (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
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
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink/50">{when}</p>
        )}
        <p className="truncate font-display text-sm font-bold text-ink">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatAppearanceDateRange(item.start_at, item.end_at, item.description)}
        </p>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-xs text-ink/50">{item.subtitle}</p>
        )}
      </div>
      <span className="shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
        {happeningCtaLabel(item.type)}
      </span>
    </Link>
  );
}
