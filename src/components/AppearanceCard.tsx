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

  const content = (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 transition active:scale-[0.99] ${
        live
          ? "border-findmi/50 bg-findmi-50"
          : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div
        className={`flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 ${
          live ? "bg-findmi text-ink" : "bg-black/[0.04] text-ink"
        }`}
      >
        {live ? (
          <>
            <LiveDot className="text-ink" />
            <span className="text-[10px] font-bold uppercase tracking-wide">Now</span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">
              {new Date(appearance.start_at).toLocaleDateString("en-US", { month: "short" })}
            </span>
            <span className="text-lg font-bold leading-none">
              {new Date(appearance.start_at).getDate()}
            </span>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-sm font-semibold leading-snug text-ink sm:truncate">
          {appearance.title}
        </p>
        {/* Time only — the date tile already covers the date, so
            formatDateRange (which repeats it) is deliberately not used
            here. */}
        <p className="mt-0.5 truncate text-xs text-ink/55">
          {formatTimeRange(appearance.start_at, appearance.end_at)}
        </p>
        {(appearance.venue_name || location) && (
          <p className="mt-0.5 truncate text-xs text-ink/45">
            {[appearance.venue_name, location].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {appearance.status === "tentative" && (
        <span className="shrink-0 self-start rounded-full bg-black/[0.04] px-2 py-1 text-[10px] font-medium text-ink/50">
          Tentative
        </span>
      )}

      {/* A compact action, not a full-width bar — Aqua stays a small,
          intentional touch target rather than flooding the row. */}
      {href && (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-findmi text-ink transition group-hover:bg-findmi-600"
        >
          <ArrowGlyph className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );

  if (!href) return content;

  // The action is icon-only now (a compact circle, not a text pill), so the
  // link still needs a real accessible name beyond the appearance title.
  const ctaLabel = eventSlug ? "View event" : "Get directions";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="group block" aria-label={`${appearance.title} — ${ctaLabel}`}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className="group block" aria-label={`${appearance.title} — ${ctaLabel}`}>
      {content}
    </Link>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M4 10h12M10.5 4.5L16 10l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
