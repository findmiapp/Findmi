import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventCard, PlaceCard, SpotlightCard } from "@/components/jc/Cards";
import { ChipBar, EmptyState, Module, PageTitle } from "@/components/jc/Layout";
import { jcHref } from "@/lib/jc/config";
import { getJcEvents, getJcNeighborhood, getJcNeighborhoods, getJcPlaces } from "@/lib/jc/data";

export const revalidate = 60;

type Props = { params: Promise<{ neighborhood: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = await getJcNeighborhood((await params).neighborhood);
  return n ? { title: n.name, alternates: { canonical: `/n/${n.slug}` } } : {};
}

export default async function JcNeighborhoodPage({ params }: Props) {
  const slug = (await params).neighborhood;
  const n = await getJcNeighborhood(slug);
  if (!n) notFound();
  const [all, today, upcoming, places] = await Promise.all([
    getJcNeighborhoods(),
    getJcEvents({ neighborhood: slug, window: "today", limit: 10 }),
    getJcEvents({ neighborhood: slug, limit: 30 }),
    getJcPlaces({ neighborhood: slug, limit: 40 }),
  ]);
  const later = upcoming.filter((e) => !today.some((t) => t.slug === e.slug));

  return (
    <div>
      <ChipBar
        className="pt-3"
        chips={[{ label: "All", href: jcHref(), active: false }, ...all.map((h) => ({ label: h.name, href: jcHref(`/n/${h.slug}`), active: h.slug === slug }))]}
      />
      <PageTitle title={n.name} sub="Jersey City" />
      {upcoming.length + places.length === 0 ? (
        <EmptyState title={`${n.name} is coming soon`} body="We're still gathering what's worth knowing here." cta={{ label: "Explore all of Jersey City", href: jcHref() }} />
      ) : (
        <>
          <Module title="Happening Today" items={today} min={1} size="lg" render={(e, i) => <SpotlightCard e={e} priority={i === 0} />} />
          <Module title="Coming Up" items={later} min={1} href={jcHref(`/events?n=${slug}`)} render={(e) => <EventCard e={e} />} />
          <Module title="Places" items={places} min={1} href={jcHref(`/places?n=${slug}`)} render={(p) => <PlaceCard p={p} />} />
        </>
      )}
    </div>
  );
}
