import type { Metadata } from "next";
import EventCard from "@/components/EventCard";
import { getUpcomingEvents } from "@/lib/data";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming markets, pop-ups, and events on Findmi.",
};
export const revalidate = 60;

export default async function EventsPage() {
  const events = await getUpcomingEvents(50);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Events</h1>
      <p className="mt-2 text-ink/60">
        Markets, pop-ups, and festivals — and who you&rsquo;ll find there.
      </p>

      {events.length === 0 ? (
        <p className="mt-10 text-sm text-ink/50">No upcoming events yet — check back soon.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
