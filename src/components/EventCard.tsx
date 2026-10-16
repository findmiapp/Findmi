import type { FindmiEvent } from "@/lib/types";
import { cityState } from "@/lib/format";
import PostCard from "./PostCard";
import { buildEntityEventFields, type AnalyticsPlacementContext } from "@/lib/analytics/context";
import { formatWhen, temporalLabelFor } from "@/lib/event-time";

export default function EventCard({
  event,
  analyticsContext,
}: {
  event: FindmiEvent;
  analyticsContext?: AnalyticsPlacementContext;
}) {
  const location = [event.venue_name, cityState(event.city, event.state)]
    .filter(Boolean)
    .join(" · ");
  const { label: when, live } = temporalLabelFor(event);

  return (
    <PostCard
      href={`/event/${event.slug}`}
      image={event.cover_image_url}
      kind="event"
      badgeLabel={live ? "Happening Now" : when}
      badgeVariant={live ? "live" : "default"}
      title={event.name}
      metaLines={[
        ...(location ? [{ icon: "pin" as const, text: location }] : []),
        { icon: "calendar", text: formatWhen(event) },
      ]}
      cta="Who's Going"
      analyticsFields={buildEntityEventFields("event", event.id, { eventId: event.id }, analyticsContext)}
    />
  );
}
