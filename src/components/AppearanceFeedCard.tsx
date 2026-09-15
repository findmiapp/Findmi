"use client";

import SupabaseImage from "./SupabaseImage";
import Link from "next/link";
import type { AppearanceFeedItem } from "@/lib/data";
import { cityState, getTemporalLabel } from "@/lib/format";
import LiveDot from "./LiveDot";
import { trackEvent } from "@/lib/analytics/track";
import { useViewportImpression } from "@/lib/analytics/useViewportImpression";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";

export default function AppearanceFeedCard({
  item,
  analyticsContext,
}: {
  item: AppearanceFeedItem;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const { label: when, live } = getTemporalLabel(item.start_at, item.end_at);

  const analyticsFields = buildEntityEventFields(
    "appearance",
    item.id,
    {
      appearanceId: item.id,
      businessId: item.business_id,
      eventId: item.event_id,
      eventOccurrenceId: item.event_occurrence_id,
      locationId: item.location_id,
    },
    analyticsContext
  );
  // Hook called unconditionally (rules-of-hooks) — the `!item.business`
  // early return below happens after, same as every other hook in this
  // component's render.
  const impressionRef = useViewportImpression<HTMLAnchorElement>(
    item.business ? { event_name: "entity_impression", ...analyticsFields } : null
  );

  if (!item.business) return null;

  // Public Graph Integrity Pass 1 — this whole card is already one
  // full-surface <Link> to the Business (its actual purpose here: Business
  // discovery). A first-class Location's own name is shown as quiet
  // secondary context in place of the bare city/state text whenever one
  // exists, rather than adding a second, nested clickable target inside
  // an element that's already an <a> — see AppearanceCard's own note on
  // the same constraint. Business attribution/discovery stays the card's
  // one and only click.
  const secondaryLabel = item.location?.name ?? (item.city ? cityState(item.city, item.state) : null);

  return (
    <Link
      href={`/business/${item.business.slug}`}
      ref={impressionRef}
      onClick={() => trackEvent({ event_name: "entity_click", ...analyticsFields })}
      className={`flex shrink-0 flex-col gap-2.5 rounded-2xl border p-3.5 transition active:scale-[0.99] ${
        live ? "border-findmi/50 bg-findmi-50" : "border-black/5 bg-white hover:shadow-md hover:shadow-black/5"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-black/5">
          {item.business.logo_url && (
            <SupabaseImage
              src={item.business.logo_url}
              alt={item.business.name}
              fill
              sizes="40px"
              className="object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{item.business.name}</p>
          <p
            className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${
              live ? "text-ink" : "text-ink/40"
            }`}
          >
            {live && <LiveDot className="text-red-600" />}
            {live ? "Happening Now" : when}
          </p>
        </div>
      </div>
      <p className="text-sm text-ink/70">
        {item.title}
        {secondaryLabel && <span className="text-ink/45"> · {secondaryLabel}</span>}
      </p>
    </Link>
  );
}
