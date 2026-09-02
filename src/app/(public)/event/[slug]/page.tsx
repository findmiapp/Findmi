import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import AddToCalendarButton from "@/components/AddToCalendarButton";
import { CategoryPill } from "@/components/Badge";
import ClaimButton from "@/components/ClaimButton";
import Bulletin from "@/components/Bulletin";
import EventBusinessRoster from "@/components/EventBusinessRoster";
import EventCoverLightbox from "@/components/EventCoverLightbox";
import EventFollowForm from "@/components/EventFollowForm";
import { EventOccurrenceProvider } from "@/components/EventOccurrenceContext";
import EventOccurrenceCard from "@/components/EventOccurrenceCard";
import EventSaveButton from "@/components/EventSaveButton";
import EventScheduleActions from "@/components/EventScheduleActions";
import EventScheduleCtas from "@/components/EventScheduleCtas";
import EventScheduleSummary from "@/components/EventScheduleSummary";
import EventShareButton from "@/components/EventShareButton";
import FormAction from "@/components/FormAction";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import ProductCard from "@/components/ProductCard";
import { HorizontalScroller } from "@/components/Section";
import {
  attachEventCategories,
  eventHasAnyOccurrences,
  getBusinessesForEvent,
  getEventBySlug,
  getEventImages,
  getEventProducts,
  getUpcomingOccurrencesForEvent,
} from "@/lib/data";
import { cityState, formatDateRange } from "@/lib/format";
import { resolveEventActionForm } from "@/lib/forms";
import { getPublicOrigin } from "@/lib/site-url";

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
    description: event.description ?? `${event.name} on FindMi.`,
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

  const [businesses, [eventWithCategories], featuredProducts, images, upcomingOccurrences, hasOccurrences] =
    await Promise.all([
      getBusinessesForEvent(event.id),
      attachEventCategories([event]),
      getEventProducts(event.id),
      getEventImages(event.id),
      getUpcomingOccurrencesForEvent(event.id),
      eventHasAnyOccurrences(event.id),
    ]);
  const category = eventWithCategories.categories[0] ?? null;
  const location = cityState(event.city, event.state);
  const venueLine = [event.venue_name, event.address, location].filter(Boolean).join(" · ");
  const mapQuery = [event.venue_name, event.address, location].filter(Boolean).join(", ");
  const directionsHref = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;
  const canonicalUrl = `${getPublicOrigin()}/event/${event.slug}`;

  // Item 9 — cover first (when it exists), then the real gallery images.
  // With no gallery, this is just [cover] and EventCoverLightbox behaves
  // exactly like the previous single-image version; with no cover either,
  // it's empty and the branded fallback below renders instead.
  const coverAndGallery = [event.cover_image_url, ...images.gallery].filter((v): v is string => Boolean(v));

  const vendorDeadlinePassed = event.vendor_application_deadline
    ? new Date(event.vendor_application_deadline) < new Date()
    : false;

  // Form Manager resolution — an assigned Form Manager form for this event
  // outranks the event's own direct URL field; the direct URL (existing
  // architecture) outranks the purpose's global default. Only when NONE of
  // those exist does the action disappear. Tickets/Directions aren't
  // form-driven purposes and keep their existing direct-URL-only behavior.
  const [rsvpForm, vendorAppForm, contactForm] = await Promise.all([
    event.rsvp_enabled ? resolveEventActionForm("rsvp", event, event.rsvp_url) : Promise.resolve(null),
    event.vendor_applications_enabled && !vendorDeadlinePassed
      ? resolveEventActionForm("vendor_application", event, event.vendor_application_url)
      : Promise.resolve(null),
    event.contact_enabled
      ? resolveEventActionForm(
          "contact_organizer",
          event,
          event.contact_url || (event.organizer_email ? `mailto:${event.organizer_email}` : null)
        )
      : Promise.resolve(null),
  ]);

  // Two tiers: Tier A (customCtas) reuses the event's existing
  // Tickets/RSVP/Apply to Vend fields — up to three organizer CTAs —
  // rather than a second, parallel "custom CTA" system. Tier B is the
  // supporting utility row. Only an action with BOTH its toggle on AND a
  // real destination ever renders.
  const customCtas: { label: string; href: string; displayMode: "embed" | "external"; weight: "solid" | "outline" }[] = [];
  if (event.tickets_enabled && event.tickets_url) {
    customCtas.push({ label: "Get Tickets", href: event.tickets_url, displayMode: "external", weight: "solid" });
  }
  if (rsvpForm) {
    customCtas.push({ label: "RSVP", href: rsvpForm.url, displayMode: rsvpForm.displayMode, weight: "solid" });
  }
  if (vendorAppForm) {
    customCtas.push({ label: "Apply to Vend", href: vendorAppForm.url, displayMode: vendorAppForm.displayMode, weight: "outline" });
  }

  const showContact = Boolean(contactForm);
  const showFollow = event.follow_enabled;
  const showDirections = event.directions_enabled && Boolean(directionsHref);

  // Item 18 (Run By) — events has no organizer->Business/Person
  // relationship today (organizer_name is plain text) — see the pass
  // report. Rendered as plain text only; never a fabricated profile link.
  const hasOrganizer = Boolean(event.organizer_name?.trim());

  // Item 17 (Venue) — events has no location_id/FindMi Location
  // relationship today either — every event currently falls in the
  // "not linked" case, so this only ever shows the real stored venue
  // fields (+ the event-specific venue gallery), never a fabricated
  // Location link (see the pass report).
  const hasVenueDetails = Boolean(event.venue_name || event.address || location);

  // Recurring Events V2 — for an event WITH occurrence rows, occurrence
  // scheduling becomes public scheduling truth: the details card's date/
  // time/location and the Directions/Add to Calendar actions read the
  // shared selectedOccurrence (EventScheduleSummary/EventScheduleActions)
  // instead of the parent event's own start_at/end_at/venue fields, which
  // stop being authoritative the moment occurrences exist. A legacy event
  // with zero occurrence rows (hasOccurrences false, upcomingOccurrences
  // always []) renders this exact same JSX block, but with the original
  // static date/venue line and Directions/Add to Calendar untouched — see
  // the two `hasOccurrences ? … : …` branches below. Built once as a
  // variable (not duplicated per branch) so Tier A CTAs, the rest of the
  // utility row, and Bulletin are never repeated in source.
  const scheduleAndDetails = (
    <>
      {/* Item 7 — one coherent details module (title, date/time, venue,
          address) instead of floating loosely in open whitespace below
          the cover. Light containment only: subtle border, restrained
          radius, no heavy card styling. */}
      <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-6">
        {category && (
          <div className="mb-2">
            <CategoryPill>{category.name}</CategoryPill>
          </div>
        )}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{event.name}</h1>

        {hasOccurrences ? (
          <EventScheduleSummary />
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-sm text-ink/65">
            <div className="flex items-center gap-2">
              <CalendarGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              <span className="font-medium text-ink/80">{formatDateRange(event.start_at, event.end_at)}</span>
            </div>
            {venueLine && (
              <div className="flex items-center gap-2">
                <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
                <span>{venueLine}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tier A — the strongest, organizer-configured actions. For a
          recurring event, the selected occurrence's own RSVP/ticket/
          vendor-apply override (if any) wins over the parent's resolved
          action — see EventScheduleCtas; a legacy event keeps the exact
          original server-resolved customCtas rendering below. */}
      {hasOccurrences ? (
        <EventScheduleCtas
          ticketsEnabled={event.tickets_enabled}
          ticketsUrl={event.tickets_url}
          rsvpEnabled={event.rsvp_enabled}
          rsvp={rsvpForm}
          vendorApplicationsEnabled={event.vendor_applications_enabled && !vendorDeadlinePassed}
          vendorApplication={vendorAppForm}
        />
      ) : (
        customCtas.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {customCtas.map((action) => (
              <FormAction
                key={action.label}
                href={action.href}
                displayMode={action.displayMode}
                label={action.label}
                className={
                  action.weight === "solid"
                    ? "flex h-12 items-center justify-center rounded-full bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                    : "flex h-11 items-center justify-center rounded-full border border-findmi/40 px-5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                }
              />
            ))}
          </div>
        )
      )}

      {/* Tier B — supporting utility actions, visually quiet, grouped
          together and separate from Tier A above. Mobile layout pass: a
          single non-wrapping, horizontally scrollable row (Save →
          Directions → Add to Calendar → Share → Contact Organizer, then
          Follow/Event Details when present) instead of flex-wrap — every
          action/icon/link/behavior is unchanged, only the row's own
          layout. -mx-4/px-4 (sm:-mx-6/sm:px-6) bleeds the scroll track to
          the same edges as the padded content around it, and
          overflow-x-auto contains all overflow within this one element —
          it can't cause page-level horizontal scroll. */}
      <div className="mt-2 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-2">
          <div className="shrink-0">
            <EventSaveButton slug={event.slug} />
          </div>
          {hasOccurrences ? (
            <EventScheduleActions
              eventName={event.name}
              description={event.description}
              directionsEnabled={event.directions_enabled}
            />
          ) : (
            <>
              {showDirections && (
                <a
                  href={directionsHref!}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
                >
                  Directions
                </a>
              )}
              <div className="shrink-0">
                <AddToCalendarButton
                  title={event.name}
                  description={event.description}
                  location={venueLine || null}
                  startAt={event.start_at}
                  endAt={event.end_at}
                />
              </div>
            </>
          )}
          <div className="shrink-0">
            <EventShareButton title={event.name} url={canonicalUrl} />
          </div>
          {showContact && contactForm && (
            contactForm.url.startsWith("mailto:") ? (
              <a
                href={contactForm.url}
                className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
              >
                Contact Organizer
              </a>
            ) : (
              <FormAction
                href={contactForm.url}
                displayMode={contactForm.displayMode}
                label="Contact Organizer"
                className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
              />
            )
          )}
          {showFollow && (
            <a
              href="#follow"
              className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
            >
              Follow
            </a>
          )}
          {event.external_url && (
            <a
              href={event.external_url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
            >
              Event Details
            </a>
          )}
        </div>
      </div>

      {/* Item 8 — optional Bulletin, same shared component as Business
          Profile, right after the utility row and before About. */}
      <div className="mt-3">
        <Bulletin heading={event.bulletin_heading} body={event.bulletin_enabled ? event.bulletin_body : null} />
      </div>

      {/* Event Occurrences foundation — "Upcoming Dates" carousel, now the
          occurrence SELECTOR (Recurring Events V2) rather than merely
          informational, shown only when this event has real
          event_occurrences rows still to come (including
          cancelled-but-not-yet-past ones, badged accordingly and still
          selectable for transparency). A legacy event with none simply
          has an empty list here and this section renders nothing — its
          single date keeps showing exactly as it always has, above. */}
      {upcomingOccurrences.length > 0 && (
        <div className="mt-5 -mx-4 sm:mx-0">
          <p className="mb-3 px-4 font-display text-lg font-bold tracking-tight text-ink sm:px-0">
            Upcoming Dates
          </p>
          <HorizontalScroller>
            {upcomingOccurrences.map((occ) => (
              <EventOccurrenceCard key={occ.id} occurrence={occ} />
            ))}
          </HorizontalScroller>
        </div>
      )}
    </>
  );

  return (
    <div>
      {/* Item 9: the cover becomes a lightbox/slider trigger through every
          real image (cover + gallery) when at least one exists — see
          EventCoverLightbox's own note. */}
      <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border border-black/5 bg-mist shadow-sm sm:aspect-[21/9]">
          {coverAndGallery.length > 0 ? (
            <EventCoverLightbox images={coverAndGallery} alt={event.name} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink">
              <CalendarGlyph className="h-12 w-12 text-white/15" />
            </div>
          )}
          <AdminEditButton href={`/admin/events/${event.id}`} className="absolute right-3 top-3 z-10" />
        </div>

        {/* Item 9 — compact gallery preview strip. Only renders with real
            gallery images beyond the cover (ImageGalleryStrip's own
            length<2 guard), never a placeholder wall of tiles. */}
        {images.gallery.length > 0 && (
          <div className="mt-2.5">
            <ImageGalleryStrip images={coverAndGallery} alt={event.name} />
          </div>
        )}
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        {hasOccurrences ? (
          <EventOccurrenceProvider occurrences={upcomingOccurrences}>{scheduleAndDetails}</EventOccurrenceProvider>
        ) : (
          scheduleAndDetails
        )}

        {/* Events only have one description field today (no separate
            short/long), so this is the single "About This Event" section
            rather than duplicating the same text twice. */}
        {event.description && (
          <section className="mt-5">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About This Event</h2>
            <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-ink/70">
              {event.description}
            </p>
          </section>
        )}

        {/* Item 7 (content order) — Who You'll Find Here now comes right
            after About, BEFORE Featured Products and About the Venue, per
            this pass's explicit ordering requirement. Preserves the
            existing participating-business logic/taxonomy untouched. */}
        <section className="mt-5">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            Who You&rsquo;ll Find Here
          </h2>
          <p className="mt-1 text-sm text-ink/55">
            {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
          </p>
          <EventBusinessRoster businesses={businesses} />
        </section>

        {/* Item 11 — a founder-picked small set of real, existing products
            (event_products), moved to right after Who You'll Find Here.
            Omitted entirely when none are assigned, never automatic
            merchandising. Real purchasable/view-only behavior via
            ProductCard, unchanged. */}
        {featuredProducts.length > 0 && (
          <div className="mt-8 -mx-4 sm:mx-0">
            <p className="mb-3 px-4 font-display text-lg font-bold tracking-tight text-ink sm:px-0">
              {event.featured_products_heading?.trim() || "Featured at This Event"}
            </p>
            <HorizontalScroller>
              {featuredProducts.map((p) => (
                <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                  <ProductCard product={p} />
                </div>
              ))}
            </HorizontalScroller>
          </div>
        )}

        {/* Item 10 — Venue, now with its own optional compact gallery.
            events has no FindMi Location relationship today (see the pass
            report), so this always renders the real stored venue fields
            as plain text plus this event's own venue_image gallery rows,
            never a fabricated Location link. */}
        {hasVenueDetails && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About the Venue</h2>
            <div className="mt-3 flex flex-col gap-1 text-sm text-ink/70">
              {event.venue_name && <p className="font-semibold text-ink">{event.venue_name}</p>}
              {(event.address || location) && <p>{[event.address, location].filter(Boolean).join(", ")}</p>}
            </div>
            {images.venue.length > 0 && (
              <div className="mt-3">
                <ImageGalleryStrip images={images.venue} alt={event.venue_name ?? "Venue"} />
              </div>
            )}
          </section>
        )}

        {/* Run By — no organizer->Business/Person relationship exists on
            events today, so this stays plain text — never a fabricated
            profile link (see the pass report). */}
        {hasOrganizer && (
          <section className="mt-8">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Run By</p>
            <p className="mt-1 text-base font-semibold text-ink">{event.organizer_name}</p>
          </section>
        )}

        {showFollow && (
          <section id="follow" className="mt-12 scroll-mt-20">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              Follow This Event
            </h2>
            <p className="mt-2 max-w-md text-sm text-ink/60">
              We&rsquo;ll keep you posted on updates to {event.name}.
            </p>
            <div className="mt-4 max-w-md">
              <EventFollowForm eventId={event.id} eventName={event.name} />
            </div>
          </section>
        )}

        {/* Claim foundation pass — deliberately last, small, and muted. */}
        <div className="mt-8">
          <ClaimButton type="event" slug={event.slug} entityName={event.name} />
        </div>
      </div>
    </div>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? "h-4 w-4 shrink-0 text-ink/40"}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? "h-4 w-4 shrink-0 text-ink/40"}>
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
