import Link from "next/link";
import type { LocationHappening } from "@/lib/data";
import { formatAppearanceDateRange, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import PostCard from "./PostCard";
import SupabaseImage from "./SupabaseImage";

/** Location Upcoming CTA Semantics fix — "Find Them" made sense for
 * finding a business/vendor, not opening an Event happening at this
 * Location. `item.type` is set once, at the query (getUpcomingAtLocation
 * in lib/data.ts), never inferred here from title/text. Destination
 * (item.href) is unaffected either way. */
function happeningCtaLabel(type: LocationHappening["type"]): string {
  return type === "event" ? "View Event" : "View Appearance";
}

/** Full-bleed photo poster — no longer used by the Location page's own
 * "Coming Up Here" (see HappeningFeatureCard below, and
 * LocationPublicView's own note on why), but kept exported since it's a
 * genuinely reusable "this is basically a discovery-feed post" primitive
 * and removing it isn't this pass's job. */
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

/** Compact featured relationship card — Public Experience V5. A single
 * upcoming happening at a Location doesn't need a full-viewport photo
 * poster (HappeningCard above) to feel worth a look; this is HappeningRow's
 * own compact geometry with a small thumbnail added, so "Coming Up Here"
 * reads as an attractive relationship module rather than either a giant
 * poster or a bare gray row. Used for every item when a Location has 3 or
 * fewer upcoming happenings, and for just the nearest one when it has
 * more (see LocationPublicView's own density rule). */
export function HappeningFeatureCard({ item }: { item: LocationHappening }) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3.5 rounded-2xl border p-3 transition active:scale-[0.99] ${
        live ? "border-findmi/50 bg-findmi-50" : "border-black/5 bg-white hover:border-black/10 hover:shadow-sm"
      }`}
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-black/[0.04] sm:h-24 sm:w-24">
        {item.imageUrl ? (
          <SupabaseImage src={item.imageUrl} alt="" fill sizes="96px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone to-ink">
            <CalendarGlyph className="h-7 w-7 text-white/25" />
          </div>
        )}
        {live && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            <LiveDot className="text-white" />
            Now
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!live && <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">{when}</p>}
        <p className="truncate font-display text-base font-bold text-ink">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink/60">
          {formatAppearanceDateRange(item.start_at, item.end_at, item.description)}
        </p>
        {item.subtitle && <p className="mt-0.5 truncate text-xs text-ink/50">{item.subtitle}</p>}
      </div>
      <span className="hidden shrink-0 rounded-full bg-findmi px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white sm:inline-block">
        {happeningCtaLabel(item.type)}
      </span>
    </Link>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
