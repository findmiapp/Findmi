import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventCard, PlaceRow, WhenText } from "@/components/jc/Cards";
import { BackButton, ShareButton } from "@/components/jc/Detail";
import JcMedia from "@/components/jc/JcMedia";
import { Module } from "@/components/jc/Layout";
import { jcHref } from "@/lib/jc/config";
import { getJcEvent, getJcEvents } from "@/lib/jc/data";
import { HIDDEN_LOCATION_COPY } from "@/lib/event-attendance";
import { longDayLabel, rowTime } from "@/lib/jc/format";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const e = await getJcEvent((await params).slug);
  return e ? { title: e.title, alternates: { canonical: `/events/${e.slug}` } } : {};
}

export default async function JcEventPage({ params }: Props) {
  const e = await getJcEvent((await params).slug);
  if (!e) notFound();
  const ended = e.dates.length === 0;
  const more = (await getJcEvents({ limit: 12 })).filter((x) => x.slug !== e.slug);
  const facts = [e.categoryLabel, e.neighborhood?.name].filter(Boolean);

  return (
    <article className="md:grid md:grid-cols-[1.1fr_1fr] md:gap-10 md:px-8 md:pt-8">
      <div className="relative px-3 pt-2 md:px-0 md:pt-0">
        <JcMedia src={e.image} alt={e.title} sizes="(min-width: 768px) 560px, 100vw" priority className="aspect-[4/3.4] md:aspect-[4/5]" rounded="rounded-[26px]" />
        <BackButton fallback="/events" />
        <ShareButton title={e.title} />
      </div>

      <div className="px-4 pt-5 md:px-0 md:pt-2">
        {facts.length > 0 && <p className="text-[13px] font-medium text-neutral-500">{facts.join(" · ")}</p>}
        <h1 className="mt-1 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[36px]">{e.title}</h1>
        <p className="mt-2 text-[15px] font-medium">
          {ended ? <span className="text-neutral-500">This event has ended</span> : <WhenText e={e} />}
        </p>
        {e.locationHidden ? (
          <p className="mt-0.5 text-[15px] text-neutral-600">{HIDDEN_LOCATION_COPY}</p>
        ) : (
          e.venue && <p className="mt-0.5 text-[15px] text-neutral-600">{e.venue}</p>
        )}

        {!ended && (e.action || e.detailsUrl) && (
          <div className="mt-5 flex gap-2">
            {e.action && (
              <a href={e.action.url} target="_blank" rel="noopener noreferrer" className="flex h-12 flex-1 items-center justify-center rounded-full bg-neutral-950 text-[15px] font-semibold text-white active:scale-[0.99] md:flex-none md:px-8">
                {e.action.label}
              </a>
            )}
            {e.detailsUrl && (
              <a href={e.detailsUrl} target="_blank" rel="noopener noreferrer" className={`flex h-12 items-center justify-center rounded-full bg-neutral-100 text-[15px] font-semibold active:scale-[0.99] md:flex-none md:px-8 ${e.action ? "px-5" : "flex-1"}`}>
                Event Details
              </a>
            )}
          </div>
        )}

        {e.description && <p className="mt-6 whitespace-pre-line text-[15.5px] leading-[1.6] text-neutral-800">{e.description}</p>}

        {e.dates.length > 1 && (
          <section className="mt-8">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Upcoming Dates</h2>
            <ul className="mt-2 divide-y divide-neutral-100">
              {e.dates.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-4 py-3 text-[14.5px]">
                  <span className={d.cancelled ? "text-neutral-400 line-through" : "font-medium"}>{longDayLabel(d.date, d.timezone)}</span>
                  <span className="shrink-0 text-neutral-500">{d.cancelled ? "Cancelled" : rowTime(d)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {e.place && (
          <section className="mt-8">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">Where</h2>
            <PlaceRow p={e.place} />
          </section>
        )}

        {e.address && <p className="mt-3 text-[14px] text-neutral-500">{e.address}</p>}
        {e.organizer && <p className="mt-6 text-[13.5px] text-neutral-500">Hosted by {e.organizer}</p>}
      </div>

      <div className="md:col-span-2">
        <Module title="More Coming Up" items={more} href={jcHref("/events")} render={(x) => <EventCard e={x} />} />
        <div className="px-4 pt-8 md:px-0">
          <Link href={jcHref("/events")} className="text-[14px] font-medium text-neutral-500">
            ← All events
          </Link>
        </div>
      </div>
    </article>
  );
}
