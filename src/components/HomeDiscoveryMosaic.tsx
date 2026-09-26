import type { EventWithCategories } from "@/lib/types";
import HomeEventCard from "./HomeEventCard";

// Discovery Home Composition Reset — the homepage's first real content
// composition, replacing the old single 66vw-wide event-card rail (which
// the live mobile review found insufficient to communicate abundance —
// one enormous card is not "look at all this stuff happening"). This is
// homepage-specific presentation only: HomeEventCard itself is untouched
// in its default form (see its own doc comment on the additive `size`
// prop), so every other caller of it keeps rendering exactly as before.
//
// Composition: one larger "lead" tile (the soonest real upcoming event)
// plus up to two smaller "supporting" tiles beside/below it on mobile,
// side by side on wider screens — three real discoveries visible with a
// single glance, not one. All three come from the SAME already-fetched,
// already-real, already-chronological `getUpcomingEvents("anytime", ...)`
// query the homepage already ran (see page.tsx) — zero new query,
// deterministic (soonest three, in order), never randomized, never a
// fabricated "featured" flag. Renders nothing at all when there are no
// real upcoming events — never a placeholder.
export default function HomeDiscoveryMosaic({ events }: { events: EventWithCategories[] }) {
  if (events.length === 0) return null;
  const [lead, ...rest] = events;
  const supporting = rest.slice(0, 2);

  return (
    // Fixed 2-column grid at every breakpoint (not sm:grid-cols-2 only) —
    // the "[ smaller ][ smaller ]" pairing the task illustrates is
    // exactly as valuable on a 390px phone as on desktop; the lead tile
    // spans both columns regardless of viewport width via col-span-2.
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <HomeEventCard
          event={lead}
          size="large"
          analyticsContext={{ pageType: "home", placement: "homepage_discovery_lead" }}
        />
      </div>
      {supporting.map((event) => (
        <HomeEventCard
          key={event.id}
          event={event}
          analyticsContext={{ pageType: "home", placement: "homepage_discovery_supporting" }}
        />
      ))}
    </div>
  );
}
