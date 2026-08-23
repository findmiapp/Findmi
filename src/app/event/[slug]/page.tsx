import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import BusinessCard from "@/components/BusinessCard";
import {
  getBusinessesForEvent,
  getEventBySlug,
} from "@/lib/data";
import { cityState, formatDateRange } from "@/lib/format";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Event not found" };

  return {
    title: event.name,
    description: event.description ?? `${event.name} on Findmi.`,
    openGraph: {
      title: event.name,
      description: event.description ?? undefined,
      images: event.cover_image_url ? [event.cover_image_url] : undefined,
    },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const businesses = await getBusinessesForEvent(event.id);
  const location = cityState(event.city, event.state);
  const mapQuery = encodeURIComponent(
    [event.venue_name, event.address, location].filter(Boolean).join(", ")
  );

  return (
    <div>
      <div className="relative h-56 w-full overflow-hidden bg-black/5 sm:h-72 md:h-96">
        {event.cover_image_url && (
          <Image
            src={event.cover_image_url}
            alt={event.name}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}
      </div>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {event.name}
        </h1>

        <div className="mt-4 flex flex-col gap-2 text-sm text-ink/65">
          <div className="flex items-center gap-2">
            <CalendarGlyph />
            <span>{formatDateRange(event.start_at, event.end_at)}</span>
          </div>
          {(event.venue_name || location) && (
            <div className="flex items-center gap-2">
              <PinGlyph />
              <span>
                {[event.venue_name, event.address, location].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {mapQuery && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-ink/30"
            >
              Get directions
            </a>
          )}
          {event.external_url && (
            <a
              href={event.external_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              Event details
            </a>
          )}
        </div>

        {event.description && (
          <p className="mt-6 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">
            {event.description}
          </p>
        )}

        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            Who You&rsquo;ll Find There
          </h2>
          <p className="mt-1 text-sm text-ink/55">
            {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
          </p>
          {businesses.length === 0 ? (
            <p className="mt-6 text-sm text-ink/50">
              Businesses for this event haven&rsquo;t been confirmed yet — check back soon.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {businesses.map((b) => (
                <BusinessCard key={b.id} business={b} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/40">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-ink/40">
      <path
        d="M12 21s7-6.2 7-11.5A7 7 0 105 9.5C5 14.8 12 21 12 21z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
