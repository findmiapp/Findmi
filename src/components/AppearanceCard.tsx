import Link from "next/link";
import type { Appearance } from "@/lib/types";
import { cityState, formatTimeRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";

export default function AppearanceCard({
  appearance,
  eventSlug,
}: {
  appearance: Appearance;
  eventSlug?: string | null;
}) {
  const location = cityState(appearance.city, appearance.state);
  const mapsQuery = [appearance.venue_name, appearance.address, location]
    .filter(Boolean)
    .join(", ");
  const { live } = getTemporalLabel(appearance.start_at, appearance.end_at);

  // Every card taps to something real: the shared FindMi event if this
  // appearance belongs to one, otherwise directions to the venue.
  const href = eventSlug
    ? `/event/${eventSlug}`
    : mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null;
  const external = !eventSlug && Boolean(mapsQuery);
  const ctaLabel = eventSlug ? "View →" : "Find Them →";

  const content = (
    <div
      className={`rounded-2xl border p-4 transition active:scale-[0.99] ${
        live
          ? "border-findmi/50 bg-findmi-50"
          : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      {/* Date tile + event info share the top row — the CTA no longer
          lives here on mobile, since a third column left almost no room
          for the title/venue and produced truncation like "Minthorn…". */}
      <div className="flex items-center gap-4">
        <div
          className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-2 sm:w-16 ${
            live ? "bg-findmi text-ink" : "bg-black/[0.04] text-ink"
          }`}
        >
          {live ? (
            <>
              <LiveDot className="text-ink" />
              <span className="text-[11px] font-bold uppercase tracking-wide">Now</span>
            </>
          ) : (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                {new Date(appearance.start_at).toLocaleDateString("en-US", { month: "short" })}
              </span>
              <span className="text-xl font-bold leading-none">
                {new Date(appearance.start_at).getDate()}
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink sm:truncate">
            {appearance.title}
          </p>
          {/* Time only — the date tile already covers the date, so
              formatDateRange (which repeats it) is deliberately not used
              here. */}
          <p className="mt-0.5 truncate text-xs text-ink/60">
            {formatTimeRange(appearance.start_at, appearance.end_at)}
          </p>
          {(appearance.venue_name || location) && (
            <p className="mt-0.5 truncate text-xs text-ink/50">
              {[appearance.venue_name, location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {appearance.status === "tentative" && (
          <span className="shrink-0 self-start rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink/50">
            Tentative
          </span>
        )}

        {/* Desktop keeps the original inline CTA — only mobile moves it
            below, where it has room to be a full-width tap target. */}
        {href && (
          <span className="hidden shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink sm:inline-block">
            {ctaLabel}
          </span>
        )}
      </div>

      {href && (
        <span className="mt-3 block rounded-full bg-findmi py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-ink sm:hidden">
          {ctaLabel}
        </span>
      )}
    </div>
  );

  if (!href) return content;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  return <Link href={href}>{content}</Link>;
}
