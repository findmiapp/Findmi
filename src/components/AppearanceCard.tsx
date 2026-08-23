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

  const content = (
    <div className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm">
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
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/30">
        <path
          d="M9 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );

  if (eventSlug) {
    return <Link href={`/event/${eventSlug}`}>{content}</Link>;
  }
  return content;
}
