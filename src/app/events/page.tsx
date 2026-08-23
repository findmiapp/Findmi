import type { Metadata } from "next";
import Link from "next/link";
import EventCard from "@/components/EventCard";
import { getUpcomingEvents } from "@/lib/data";
import type { DiscoveryWindow } from "@/lib/format";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse upcoming markets, pop-ups, and events on FindMi.",
};

const WINDOWS: { value: DiscoveryWindow; label: string }[] = [
  { value: "now", label: "Now" },
  { value: "next", label: "Next" },
  { value: "weekend", label: "This Weekend" },
  { value: "anytime", label: "Anytime" },
];

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ when?: string }>;
}) {
  const { when: whenParam } = await searchParams;
  const when: DiscoveryWindow = WINDOWS.some((w) => w.value === whenParam)
    ? (whenParam as DiscoveryWindow)
    : "anytime";

  const events = await getUpcomingEvents(50, when);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Events</h1>
      <p className="mt-2 text-ink/60">
        Markets, pop-ups, and festivals — and who you&rsquo;ll find here.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {WINDOWS.map((w) => (
          <Link
            key={w.value}
            href={w.value === "anytime" ? "/events" : `/events?when=${w.value}`}
            className={`rounded-full px-4 py-2 text-sm font-bold uppercase tracking-wide transition ${
              when === w.value
                ? "bg-findmi text-ink"
                : "border border-black/10 text-ink/70 hover:border-ink/30"
            }`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="mt-10 text-sm text-ink/50">
          {when === "anytime"
            ? "No upcoming events yet — check back soon."
            : "Nothing in this window yet — try Anytime."}
        </p>
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
