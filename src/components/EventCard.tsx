import type { FindmiEvent } from "@/lib/types";
import { cityState, formatDateRange, getTemporalLabel } from "@/lib/format";
import PostCard from "./PostCard";

export default function EventCard({ event }: { event: FindmiEvent }) {
  const location = [event.venue_name, cityState(event.city, event.state)]
    .filter(Boolean)
    .join(" · ");
  const { label: when, live } = getTemporalLabel(event.start_at, event.end_at);

  return (
    <PostCard
      href={`/event/${event.slug}`}
      image={event.cover_image_url}
      kind="event"
      badgeLabel={when}
      badgeVariant={live ? "live" : "default"}
      title={event.name}
      metaLines={[
        ...(location ? [{ icon: "pin" as const, text: location }] : []),
        { icon: "calendar", text: formatDateRange(event.start_at, event.end_at) },
      ]}
      cta="Who's Going"
    />
  );
}
