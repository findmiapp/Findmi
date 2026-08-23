import Link from "next/link";
import type { Appearance } from "@/lib/types";
import { cityState, formatDateRange } from "@/lib/format";

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

  // Every card taps to something real: the shared Findmi event if this
  // appearance belongs to one, otherwise directions to the venue.
  const href = eventSlug
    ? `/event/${eventSlug}`
    : mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null;
  const external = !eventSlug && Boolean(mapsQuery);

  const content = (
    <div className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm active:scale-[0.99]">
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-findmi-50 py-2 text-findmi-600">
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          {new Date(appearance.start_at).toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className="text-xl font-bold leading-none">
          {new Date(appearance.start_at).getDate()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{appearance.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatDateRange(appearance.start_at, appearance.end_at)}
        </p>
        {(appearance.venue_name || location) && (
          <p className="mt-0.5 truncate text-xs text-ink/50">
            {[appearance.venue_name, location].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {appearance.status === "tentative" && (
        <span className="shrink-0 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-medium text-ink/50">
          Tentative
        </span>
      )}
      {href && (
        <span className="shrink-0 text-[11px] font-semibold text-findmi-600">
          {eventSlug ? "View" : "Directions"}
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
