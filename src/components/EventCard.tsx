import type { FindmiEvent } from "@/lib/types";
import { cityState, formatDateRange } from "@/lib/format";
import PostCard from "./PostCard";

export default function EventCard({ event }: { event: FindmiEvent }) {
  const location = [event.venue_name, cityState(event.city, event.state)]
    .filter(Boolean)
    .join(" · ");

  return (
    <PostCard
      href={`/event/${event.slug}`}
      image={event.cover_image_url}
      kind="event"
      badgeLabel="Event"
      title={event.name}
      metaLines={[
        { icon: "calendar", text: formatDateRange(event.start_at, event.end_at) },
        ...(location ? [{ icon: "pin" as const, text: location }] : []),
      ]}
      cta="Who's Going"
    />
  );
}
