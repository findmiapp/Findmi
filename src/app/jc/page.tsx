import { EventCard, NeighborhoodCard, PlaceCard, SpotlightCard } from "@/components/jc/Cards";
import { ChipBar, EmptyState, Module } from "@/components/jc/Layout";
import { APP_TIMEZONE } from "@/lib/format";
import { EVENT_MODULES, PLACE_MODULES, jcHref } from "@/lib/jc/config";
import { getJcEvents, getJcNeighborhoods, getJcPlaces } from "@/lib/jc/data";
import type { JcEvent } from "@/lib/jc/types";

export const revalidate = 60;

const NEW_DAYS = 30;

function without(items: JcEvent[], ...seen: JcEvent[][]): JcEvent[] {
  const ids = new Set(seen.flat().map((e) => e.slug));
  return items.filter((e) => !ids.has(e.slug));
}

export default async function JcHome() {
  const [moduleEvents, [today, weekend, week, upcoming, places, neighborhoods]] = await Promise.all([
    // Category modules resolve through the shared category hierarchy.
    Promise.all(EVENT_MODULES.map((m) => getJcEvents({ categorySlugs: m.slugs, limit: 16 }))),
    Promise.all([
      getJcEvents({ window: "today", limit: 12 }),
      getJcEvents({ window: "weekend", limit: 16 }),
      getJcEvents({ window: "week", limit: 24 }),
      getJcEvents({ limit: 60 }),
      getJcPlaces({ limit: 60 }),
      getJcNeighborhoods(),
    ]),
  ]);

  const lead = today.length >= 2 ? today : upcoming.filter((e) => e.featured).concat(upcoming.filter((e) => !e.featured)).slice(0, 6);
  const leadTitle = today.length >= 2 ? "Happening Today" : "Coming Up";
  const weekendRest = without(weekend, today);
  const weekRest = without(week, today, weekendRest);
  const withImages = places.filter((p) => p.image);
  const cutoff = Date.now() - NEW_DAYS * 86_400_000;
  const fresh = places.filter((p) => p.createdAt && Date.parse(p.createdAt) >= cutoff);

  const nothing = upcoming.length === 0 && places.length === 0;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, weekday: "long" }).format(new Date());

  return (
    <div>
      <div className="px-4 pb-2.5 pt-1 md:px-8 md:pt-8">
        <p className="text-[13px] font-medium text-neutral-500">{weekday} in Jersey City</p>
      </div>
      <ChipBar
        className="pb-1"
        chips={[{ label: "All", href: jcHref(), active: true }, ...neighborhoods.map((n) => ({ label: n.name, href: jcHref(`/n/${n.slug}`), active: false }))]}
      />

      {nothing ? (
        <EmptyState title="Jersey City is coming into focus" body="We're gathering the best of what's happening across the neighborhoods. Check back soon." />
      ) : (
        <>
          <Module title={leadTitle} items={lead} min={2} size="lg" href={jcHref(today.length >= 2 ? "/events?when=today" : "/events")} render={(e, i) => <SpotlightCard e={e} priority={i === 0} />} />
          <Module title="This Weekend" items={weekendRest} href={jcHref("/events?when=weekend")} render={(e) => <EventCard e={e} />} />
          <Module title="Places Worth Knowing" items={withImages.slice(0, 12)} href={jcHref("/places")} render={(p) => <PlaceCard p={p} wide />} />
          {PLACE_MODULES.map((m) => (
            <Module
              key={m.key}
              title={m.title}
              items={places.filter((p) => p.categorySlug && (m.slugs as readonly string[]).includes(p.categorySlug))}
              href={jcHref(`/places?type=${m.slugs[0]}`)}
              render={(p) => <PlaceCard p={p} />}
            />
          ))}
          <Module title="This Week" items={weekRest} href={jcHref("/events?when=week")} render={(e) => <EventCard e={e} />} />
          {EVENT_MODULES.map((m, i) => (
            <Module
              key={m.key}
              title={m.title}
              items={moduleEvents[i]}
              render={(e) => <EventCard e={e} />}
            />
          ))}
          <Module title="Neighborhoods" items={neighborhoods} size="sm" render={(n) => <NeighborhoodCard n={n} />} />
          <Module title="New Around Here" items={fresh} render={(p) => <PlaceCard p={p} />} />
        </>
      )}
    </div>
  );
}
