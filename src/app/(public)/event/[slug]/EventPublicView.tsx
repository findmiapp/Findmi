import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import AddToCalendarButton from "@/components/AddToCalendarButton";
import ClaimButton from "@/components/ClaimButton";
import MessageButton from "@/components/MessageButton";
import InquireButton from "@/components/InquireButton";
import { shouldShowMessageButton } from "@/lib/message-visibility";
import Bulletin from "@/components/Bulletin";
import EventBusinessRoster from "@/components/EventBusinessRoster";
import EventCoverLightbox from "@/components/EventCoverLightbox";
import EventFollowButton from "@/components/EventFollowButton";
import FeaturedEventHeroOverlay from "@/components/FeaturedEventHeroOverlay";
import { EventOccurrenceProvider } from "@/components/EventOccurrenceContext";
import EventOccurrenceBusinessRoster from "@/components/EventOccurrenceBusinessRoster";
import UpcomingDatesRail from "@/components/UpcomingDatesRail";
import EventSaveButton from "@/components/EventSaveButton";
import EventScheduleCtas from "@/components/EventScheduleCtas";
import EventUtilityActions, { UtilityActionGrid } from "@/components/EventUtilityActions";
import EventScheduleSummary from "@/components/EventScheduleSummary";
import EventShareButton from "@/components/EventShareButton";
import PageViewTracker from "@/components/analytics/PageViewTracker";
import AnalyticsLink from "@/components/analytics/AnalyticsLink";
import FormAction from "@/components/FormAction";
import ImageGalleryStrip from "@/components/ImageGalleryStrip";
import ProductCard from "@/components/ProductCard";
import ReadMoreText from "@/components/ReadMoreText";
import { HorizontalScroller } from "@/components/Section";
import {
  attachEventCategories,
  eventHasAnyOccurrences,
  findLocationByExactVenue,
  getBusinessesForEvent,
  getEffectiveEventSchedule,
  getEventBySlug,
  getEventImages,
  getEventProducts,
  getOccurrenceBusinessRosters,
  isPrimaryDateId,
} from "@/lib/data";
import { cityStateZip, formatDateRange, getTemporalLabel } from "@/lib/format";
import { resolveEventActionForm } from "@/lib/forms";
import { getPublicHandleForEntity } from "@/lib/handles";
import { getPublicOrigin } from "@/lib/site-url";
import { getSupabase } from "@/lib/supabase";

/** Vanity URL rendering pass — this is the actual render tree for an
 * Event's public page, shared verbatim by both the canonical
 * /event/[slug] route and the root /[username] vanity route (see that
 * route's own file). Neither route duplicates this logic; each is just
 * a thin wrapper resolving its own params into a `slug` and calling
 * straight into generateEventMetadata/EventPublicView below — the exact
 * same getEventBySlug fetch either way. */

// Schedule Authoring V4 — a bulk-generated Event can legitimately have
// 30+ upcoming dates (a month-long pop-up). Bounded, not unbounded: this
// still caps the query, it just raises the cap from the old default (12)
// enough to cover a realistic single-month activation. The rail below
// (UpcomingDatesRail) only ever shows its own first N cards up front,
// with a compact "View all" trigger as the final scrollable item —
// never rendering everything at once.
const EVENT_PUBLIC_OCCURRENCE_LIMIT = 40;

function isSafeExternalUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function resolveCanonicalUrl(eventId: string, slug: string): Promise<string> {
  const supabase = getSupabase();
  const handle = supabase ? await getPublicHandleForEntity(supabase, "event", eventId) : null;
  return `${getPublicOrigin()}/${handle ?? `event/${slug}`}`;
}

export async function generateEventMetadata(slug: string): Promise<Metadata> {
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Event not found" };

  const canonicalUrl = await resolveCanonicalUrl(event.id, event.slug);

  return {
    title: event.name,
    description: event.description ?? `${event.name} on Findmi.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: event.name,
      description: event.description ?? undefined,
      images: event.cover_image_url ? [event.cover_image_url] : undefined,
      url: canonicalUrl,
    },
  };
}

export async function EventPublicView({ slug }: { slug: string }) {
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const [businesses, [eventWithCategories], featuredProducts, images, hasOccurrences, matchedLocation] =
    await Promise.all([
      getBusinessesForEvent(event.id),
      attachEventCategories([event]),
      getEventProducts(event.id),
      getEventImages(event.id),
      eventHasAnyOccurrences(event.id),
      // Event Manager Location UX pass — events has no location_id column
      // of its own (only event_occurrences does), so a legacy (no-
      // occurrence) event can't carry a real FK to a Location. Best-effort
      // reconstruction only, same exact-match philosophy
      // getUpcomingAtLocation's own venue_name fallback already uses: if
      // this event's stored venue fields exactly match a real, public
      // Location, render it as a clickable Location relationship instead
      // of plain text — any mismatch (a manually-typed venue) just
      // renders as plain text, exactly as before. Event <-> Venue/
      // Location Relational Workflow pass — this stays only as the
      // fallback now; see canonicalLocation below, which prefers the real
      // occurrence-linked relationship whenever one exists.
      event.venue_name ? findLocationByExactVenue(event.venue_name, event.address) : Promise.resolve(null),
    ]);
  // Multi-Date Business Participation Pass 2B — Primary Date Integrity.
  // Only ever synthesizes/includes the Primary Date entry when this Event
  // already has real Additional Dates (hasOccurrences) — a genuinely
  // single-date event keeps its exact original legacy rendering (no
  // pointless one-card "Upcoming Dates" carousel). Schedule Authoring V4 —
  // bumped from the default 12 to a still-bounded 40 (never "hundreds") so
  // a realistic month-long pop-up's full schedule is actually reachable
  // here, not silently truncated. See the "Show all dates" disclosure
  // below for how this stays readable rather than just rendering more
  // cards up front.
  const upcomingOccurrences = hasOccurrences ? await getEffectiveEventSchedule(event, EVENT_PUBLIC_OCCURRENCE_LIMIT) : [];
  // Event <-> Venue/Location Relational Workflow pass — upcomingOccurrences
  // is already sorted nearest-first and already carries each occurrence's
  // REAL resolved Location (see getUpcomingOccurrencesForEvent), so the
  // nearest upcoming occurrence with a real Location relationship is the
  // authoritative "About the Venue" link whenever one exists — the exact
  // relationship this event was actually built with, not a best-effort
  // text reconstruction. Only an event with zero occurrences, or whose
  // occurrence(s) have no linked Location, falls back to matchedLocation
  // (unchanged legacy behavior — never broken for existing events).
  const canonicalLocation = upcomingOccurrences.find((o) => o.location)?.location ?? matchedLocation;
  // Depends on upcomingOccurrences' own ids, so this can't join the
  // Promise.all above — one extra query, only for a recurring event, for
  // every one of its upcoming occurrences' rosters at once (never one
  // query per occurrence — see getOccurrenceBusinessRosters). The
  // synthetic Primary Date id is deliberately excluded from this query
  // (it's not a real occurrence_id — see getEffectiveEventSchedule) and
  // keyed in separately below from the already-fetched `businesses`
  // (getBusinessesForEvent's approved event_businesses roster), which is
  // exactly the Primary Date's own correct roster: an approved
  // event_businesses row means "this Business participates in the Primary
  // Date" for every scope (all_dates, a selected_dates Business that
  // explicitly included the Primary Date, and legacy NULL-scope rows) —
  // see updateParticipatingBusinessStatus/resolveEventApplicationDecision
  // for how that status is derived.
  const realOccurrenceIds = upcomingOccurrences.filter((o) => !isPrimaryDateId(o.id)).map((o) => o.id);
  const rostersByOccurrence = hasOccurrences ? await getOccurrenceBusinessRosters(realOccurrenceIds) : {};
  const primaryEntry = upcomingOccurrences.find((o) => isPrimaryDateId(o.id));
  if (primaryEntry) {
    rostersByOccurrence[primaryEntry.id] = businesses;
  }
  const category = eventWithCategories.categories[0] ?? null;
  const location = cityStateZip(event.city, event.state, event.postal_code);
  const venueLine = [event.venue_name, event.address, location].filter(Boolean).join(" · ");
  const mapQuery = [event.venue_name, event.address, location].filter(Boolean).join(", ");
  const directionsHref = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;
  // Action Row Consistency pass — Website/Call use the Event's already-
  // resolved canonicalLocation (computed above from the real occurrence-
  // linked Location, or the legacy exact-venue-match fallback — see that
  // variable's own note). No new query: canonicalLocation already carries
  // the Location's full row (same `select("*")` LocationPublicView's own
  // getLocationBySlug uses), just not read for these two fields until
  // now. Renders nothing when the Event has no resolvable Location, or
  // when that Location has no website/phone on file.
  const canonicalWebsite = isSafeExternalUrl(canonicalLocation?.website_url) ? canonicalLocation.website_url : null;
  const canonicalPhone = canonicalLocation?.phone ?? null;
  const canonicalUrl = await resolveCanonicalUrl(event.id, event.slug);

  // Item 9 — cover first (when it exists), then the real gallery images.
  // With no gallery, this is just [cover] and EventCoverLightbox behaves
  // exactly like the previous single-image version; with no cover either,
  // it's empty and the branded fallback below renders instead.
  const coverAndGallery = [event.cover_image_url, ...images.gallery].filter((v): v is string => Boolean(v));

  // Premium Featured Event Hero pass — attribution reuses the Event's own
  // existing event_businesses.featured flag (already fetched above as
  // `businesses`, already used to sub-order "Who You'll Find Here") rather
  // than inventing a new organizer->Business relationship. Status reuses
  // the nearest still-scheduled occurrence's real start/end when one
  // exists (a recurring event's own start_at/end_at can be stale once
  // occurrences exist) — same getTemporalLabel() every other live-status
  // pill in this codebase (BusinessPublicView/HomeEventCard/HappeningCard)
  // already computes from, never a hardcoded/guessed status.
  const heroAttribution = businesses.find((b) => b.featured)?.name ?? null;
  const heroTemporalSource = upcomingOccurrences[0] ?? { start_at: event.start_at, end_at: event.end_at };
  const heroTemporal = getTemporalLabel(heroTemporalSource.start_at, heroTemporalSource.end_at ?? undefined);

  const vendorDeadlinePassed = event.vendor_application_deadline
    ? new Date(event.vendor_application_deadline) < new Date()
    : false;

  // Form Manager resolution — an assigned Form Manager form for this event
  // outranks the event's own direct URL field; the direct URL (existing
  // architecture) outranks the purpose's global default. Only when NONE of
  // those exist does the action disappear. Tickets/Directions aren't
  // form-driven purposes and keep their existing direct-URL-only behavior.
  // Unify Site-Wide Communications pass — Contact Organizer no longer
  // resolves through Form Manager/a direct URL/organizer_email mailto
  // (event.contact_url/event.organizer_email stay in the schema, simply
  // unread here now); it's always the native InquireButton below, which
  // creates a real Conversation (subject_type='event_inquiry'). The
  // founder's own contact_enabled toggle is still authoritative for
  // whether it shows at all — see showContact below.
  const [rsvpForm, vendorAppForm] = await Promise.all([
    event.rsvp_enabled ? resolveEventActionForm("rsvp", event, event.rsvp_url) : Promise.resolve(null),
    event.vendor_applications_enabled && !vendorDeadlinePassed
      ? resolveEventActionForm("vendor_application", event, event.vendor_application_url)
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
  // Public Message Action + Event CTA Cohesion pass — for a legacy
  // (non-recurring) event, the organizer's own external "Apply to Vend"
  // CTA is deterministically known here, server-side, so it's pulled out
  // of the Tier A array and paired with MESSAGE in the new fixed primary
  // row below instead (same href/displayMode, same underlying
  // vendorAppForm resolution — only its POSITION and RADIUS change, never
  // its behavior). Tickets/RSVP stay in Tier A exactly as before. A
  // recurring event's own occurrence-dependent Apply to Vend (rendered by
  // EventScheduleCtas, client-side, per the SELECTED occurrence — not
  // knowable here at server-render time) is intentionally left
  // untouched; see the primary-row comment below for why.
  const legacyVendorApplyCta = !hasOccurrences ? customCtas.find((c) => c.label === "Apply to Vend") ?? null : null;
  const legacyTierACtas = legacyVendorApplyCta ? customCtas.filter((c) => c.label !== "Apply to Vend") : customCtas;

  const showContact = event.contact_enabled;
  const showMessageButton = await shouldShowMessageButton("event", event.id);
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

  // Event Detail Action Bar Correction pass — Message/Save/Share don't
  // depend on the selected occurrence (client-only, unknowable here at
  // SSR time), so they're built ONCE here and reused as-is by both the
  // legacy path (rendered directly into UtilityActionGrid below) and the
  // recurring path (passed through to EventUtilityActions, which only
  // adds its own occurrence-dependent Add to Calendar decision on top).
  // Never duplicated, never re-resolved per branch.
  const messageAction = showMessageButton ? (
    <MessageButton
      layout="grid"
      targetType="event"
      targetId={event.id}
      targetName={event.name}
      eventOccurrences={hasOccurrences ? upcomingOccurrences.map((o) => ({ id: o.id, startAt: o.start_at })) : undefined}
    />
  ) : null;
  const saveAction = <EventSaveButton slug={event.slug} id={event.id} layout="grid" />;
  const shareAction = (
    <EventShareButton
      title={event.name}
      url={canonicalUrl}
      track={{ subject_type: "event", subject_id: event.id, event_id: event.id }}
      layout="grid"
    />
  );

  // Recurring Events V2 — for an event WITH occurrence rows, occurrence
  // scheduling becomes public scheduling truth: the details card's date/
  // time/location and the Directions/Add to Calendar actions read the
  // shared selectedOccurrence (EventScheduleSummary/EventUtilityActions)
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
      <div className="rounded-2xl border border-black/[0.06] bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-5">
        {/* Restore Event Follow pass — Follow lives here now: the top of
            the details card, visually distinct from both the Tier A
            booking actions (RSVP/Tickets/Vendor Apply) below and the
            Tier B utility row (Save/Directions/Share) — never confused
            with either. event.follow_enabled is the same existing
            founder-configurable gate it always respected.
            Premium Featured Event Hero pass — category pill and the
            event's h1 title moved into the new full-bleed hero above
            (FeaturedEventHeroOverlay); showing them a second time here
            would just duplicate the hero. Follow keeps its own row so
            this card doesn't open with dead whitespace when Follow is
            off. */}
        {showFollow && (
          <div className="flex justify-end">
            <EventFollowButton eventId={event.id} eventSlug={event.slug} eventName={event.name} size="compact" />
          </div>
        )}

        {hasOccurrences ? (
          <EventScheduleSummary />
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-sm text-ink/65">
            <div className="flex items-center gap-2">
              <CalendarGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              <span className="font-medium text-ink/80">{formatDateRange(event.start_at, event.end_at)}</span>
            </div>
            {matchedLocation ? (
              <Link
                href={`/location/${matchedLocation.slug}`}
                className="flex items-start gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 transition hover:border-findmi/40 hover:bg-findmi-50"
              >
                <PinGlyph className="mt-0.5 h-4 w-4 shrink-0 text-findmi-700" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-wide text-ink/40">Location</span>
                  <span className="block break-words font-semibold text-findmi-700">{matchedLocation.name}</span>
                  {venueLine && <span className="block break-words text-xs text-ink/55">{venueLine}</span>}
                </span>
              </Link>
            ) : (
              venueLine && (
                <div className="flex items-center gap-2">
                  <PinGlyph className="h-4 w-4 shrink-0 text-ink/40" />
                  <span>{venueLine}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Tier A — the strongest, organizer-configured actions, PRIMARY
          EVENT ACTION per the public composition hierarchy (Public
          Experience V5: identity -> when -> where -> primary action ->
          relationship content). Moved ahead of the Message/Directions/
          Apply-to-Vend row below — Tickets/RSVP is what most visitors
          actually came to do, so it belongs first, not after a row of
          secondary actions. For a recurring event, the selected
          occurrence's own RSVP/ticket/vendor-apply override (if any) wins
          over the parent's resolved action — see EventScheduleCtas; a
          legacy event keeps the exact original server-resolved customCtas
          rendering below (minus Apply to Vend, in the secondary row below
          instead — see legacyTierACtas). */}
      {/* Event CTA Layout pass — RSVP/Get Tickets/Apply to Vend (Tier A)
          and Directions now share ONE flex row (`[ RSVP ] [ DIRECTIONS ]`
          on mobile) instead of stacking on separate lines: Directions
          used to render in its own row down in the secondary/contextual
          block below. Each button is flex-1, so 2 buttons split the row
          evenly and 1 or 3 still degrade sensibly. flex-wrap keeps every
          action reachable at 360px by wrapping instead of a horizontal
          scroll or squeeze.
          Recurring events: EventScheduleCtas owns its own wrapping div
          and self-guards on emptiness (Tier A + Directions both depend on
          client-only selected-occurrence state — see its own doc comment
          for why that decision can't live here). Legacy events: this
          Server Component already knows legacyTierACtas/showDirections
          synchronously, so the wrapping div is gated inline instead. */}
      {hasOccurrences ? (
        <EventScheduleCtas
          eventId={event.id}
          ticketsEnabled={event.tickets_enabled}
          ticketsUrl={event.tickets_url}
          rsvpEnabled={event.rsvp_enabled}
          rsvp={rsvpForm}
          vendorApplicationsEnabled={event.vendor_applications_enabled && !vendorDeadlinePassed}
          vendorApplication={vendorAppForm}
          directionsEnabled={event.directions_enabled}
        />
      ) : (
        (legacyTierACtas.length > 0 || showDirections) && (
          <div className="mt-4 flex flex-wrap items-stretch gap-2.5">
            {legacyTierACtas.map((action) => (
              <FormAction
                key={action.label}
                href={action.href}
                displayMode={action.displayMode}
                label={action.label}
                className={
                  action.weight === "solid"
                    ? "flex h-12 flex-1 items-center justify-center rounded-2xl bg-findmi px-6 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                    : "flex h-12 flex-1 items-center justify-center rounded-2xl border border-findmi/40 px-5 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                }
                track={{
                  event_name: action.label === "Get Tickets" ? "click_tickets" : "click_rsvp",
                  subject_type: "event",
                  subject_id: event.id,
                  event_id: event.id,
                }}
              />
            ))}
            {showDirections && (
              <AnalyticsLink
                href={directionsHref!}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl border border-findmi/40 px-4 text-sm font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
                trackPayload={{ event_name: "click_directions", subject_type: "event", subject_id: event.id, event_id: event.id }}
              >
                <DirectionsGlyph className="h-3.5 w-3.5 shrink-0" />
                Directions
              </AnalyticsLink>
            )}
          </div>
        )
      )}

      {/* Contextual actions (Event + Location Action Row Consistency pass)
          — Website/Call use the same compact h-9/rounded-xl/px-3/text-xs
          button geometry as the Location page's own secondary actions,
          and render only when the Event's already-resolved
          canonicalLocation actually has them on file (see
          canonicalWebsite/canonicalPhone above). A legacy event's own
          Apply to Vend joins the same row at the same size. Event Detail
          Action Bar Correction pass — this wrapper is now self-guarded
          (only rendered when at least one of these three actually
          exists), since MESSAGE — the one action that used to make this
          row non-empty for nearly every event — moved into the unified
          utility grid below. Without that guard this div would otherwise
          render as an empty, orphaned row for the common case (no linked
          Location website/phone, not a legacy vendor-apply event). */}
      {(canonicalWebsite || canonicalPhone || legacyVendorApplyCta) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canonicalWebsite && (
            <a
              href={canonicalWebsite}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              <GlobeGlyph className="h-3.5 w-3.5 shrink-0" />
              Website
            </a>
          )}
          {canonicalPhone && (
            <a
              href={`tel:${canonicalPhone}`}
              className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-black/10 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition hover:border-ink/30 hover:text-ink"
            >
              <PhoneGlyph className="h-3.5 w-3.5 shrink-0" />
              Call
            </a>
          )}
          {legacyVendorApplyCta && (
            <FormAction
              href={legacyVendorApplyCta.href}
              displayMode={legacyVendorApplyCta.displayMode}
              label="Apply to Vend"
              className="flex h-9 items-center justify-center rounded-xl border border-findmi/40 px-3 text-xs font-bold uppercase tracking-wide text-findmi-700 transition hover:bg-findmi-50"
              track={{ event_name: "click_apply_to_vend", subject_type: "event", subject_id: event.id, event_id: event.id }}
            />
          )}
        </div>
      )}

      {/* Tier B — Event Detail Action Bar Correction pass. Message/Save/
          Add to Calendar/Share are now ONE deliberate utility module
          (UtilityActionGrid/EventUtilityActions) instead of Message
          living alone in the row above and Save/Calendar/Share living in
          a separately-styled horizontal scroller below: same rounded-2xl
          icon-over-label treatment, equal width, and the column count is
          derived from however many of the four are actually present, so
          a missing one (no Message configured, no selected occurrence
          for Add to Calendar) reflows the rest instead of leaving an
          empty cell. Recurring events: EventUtilityActions owns the one
          piece that depends on client-only selected-occurrence state
          (Add to Calendar); Message/Save/Share don't depend on it and
          are built once below, then passed straight through. Legacy
          events: every action's presence is already known here
          server-side, so the grid renders directly. */}
      {hasOccurrences ? (
        <EventUtilityActions
          eventName={event.name}
          description={event.description}
          message={messageAction}
          save={saveAction}
          share={shareAction}
        />
      ) : (
        <UtilityActionGrid
          items={[
            messageAction,
            saveAction,
            <AddToCalendarButton
              key="calendar"
              title={event.name}
              description={event.description}
              location={venueLine || null}
              startAt={event.start_at}
              endAt={event.end_at}
              layout="grid"
            />,
            shareAction,
          ].filter((item): item is ReactElement => Boolean(item))}
        />
      )}

      {/* Overflow utilities — Contact Organizer / Event Details are
          separate, lower-frequency actions that don't belong in the
          strict 4-slot Message/Save/Calendar/Share module above. Kept as
          their own self-guarded, horizontally scrollable row (only
          rendered when at least one exists) rather than stretching the
          module to 5-6 uneven columns. */}
      {(showContact || event.external_url) && (
        <div className="mt-2 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-2">
            {showContact && (
              <InquireButton
                targetType="event"
                targetId={event.id}
                targetName={event.name}
                label="Contact Organizer"
                className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
                track={{ event_name: "click_contact_organizer", subject_type: "event", subject_id: event.id, event_id: event.id }}
              />
            )}
            {event.external_url && (
              <a
                href={event.external_url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition hover:border-ink/30 hover:text-ink"
              >
                Event Details
              </a>
            )}
          </div>
        </div>
      )}

      {/* Item 8 — optional Bulletin, same shared component as Business
          Profile, right after the utility row and before About. */}
      <div className="mt-3">
        <Bulletin heading={event.bulletin_heading} body={event.bulletin_enabled ? event.bulletin_body : null} />
      </div>

      {/* Premium Featured Event Hero pass — Description moved up here
          (right after actions/logistics), collapsed by default via
          ReadMoreText, same single description field events have always
          had (no separate short/long) — never duplicated elsewhere. */}
      {event.description && (
        <section className="mt-5">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">About This Event</h2>
          <div className="mt-3 max-w-2xl">
            <ReadMoreText text={event.description} />
          </div>
        </section>
      )}

      {/* Premium Featured Event Hero pass — supporting gallery images now
          live here, below the core event info/description, rather than as
          a thumbnail strip between the cover and the event identity (that
          strip is gone — the hero above is the primary image, tap-to-zoom
          reaches every one of these same images too via its own
          lightbox). Same real images.gallery, same ImageGalleryStrip,
          unchanged minCount={1}/compact — only the position moved. */}
      {images.gallery.length > 0 && (
        <div className="mt-5 -mx-4 sm:mx-0">
          <div className="px-4 sm:px-0">
            <ImageGalleryStrip images={images.gallery} alt={event.name} unoptimized minCount={1} compact />
          </div>
        </div>
      )}

      {/* Event Occurrences foundation — "Upcoming Dates" carousel, now the
          occurrence SELECTOR (Recurring Events V2) rather than merely
          informational, shown only when this event has real
          event_occurrences rows still to come (including
          cancelled-but-not-yet-past ones, badged accordingly and still
          selectable for transparency). A legacy event with none simply
          has an empty list here and this section renders nothing — its
          single date keeps showing exactly as it always has, above. */}
      {upcomingOccurrences.length > 0 && (
        <div className="mt-4 -mx-4 sm:mx-0">
          <p className="mb-3 px-4 font-display text-lg font-bold tracking-tight text-ink sm:px-0">
            Upcoming Dates
          </p>
          {/* Public Upcoming Dates Mobile UX pass — ONE horizontal rail:
              "View all N" (UpcomingDatesRail's own compact trigger) is the
              final scrollable item in the SAME rail, never a second
              line/section beneath the carousel. Bounded initial render is
              preserved (see that component's own doc comment); every
              occurrence is still passed to EventOccurrenceProvider above
              regardless of how many cards are currently visible, so the
              date SELECTOR context (Tier A CTAs/Location/roster switching)
              is unaffected either way. */}
          <UpcomingDatesRail occurrences={upcomingOccurrences} eventName={event.name} />
        </div>
      )}

      {/* Premium Featured Event Hero pass — "About This Event" moved up
          to right after the actions/utility row (see the Description
          block above, before Upcoming Dates), so this roster no longer
          needs to sit immediately before it. Recurring Events V2: for an
          event WITH occurrence rows, the SELECTED occurrence's own
          event_occurrence_businesses roster is authoritative
          (EventOccurrenceBusinessRoster reads it via the shared context)
          — never event_businesses, never a fallback to it. A legacy
          event keeps the exact original event_businesses roster below,
          untouched. */}
      {hasOccurrences ? (
        <EventOccurrenceBusinessRoster rostersByOccurrence={rostersByOccurrence} eventName={event.name} />
      ) : (
        <section className="mt-5">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            Who You&rsquo;ll Find Here
          </h2>
          <p className="mt-1 text-sm text-ink/55">
            {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
          </p>
          <EventBusinessRoster businesses={businesses} eventName={event.name} />
        </section>
      )}
    </>
  );

  return (
    <div>
      <PageViewTracker
        subject_type="event"
        subject_id={event.id}
        event_id={event.id}
        page_type="event"
        page_path={`/event/${event.slug}`}
      />
      {/* Premium Featured Event Hero pass — one immersive full-bleed
          composition (image + cinematic bottom gradient + overlaid
          category/title/attribution/status/short description) replaces
          the old cover-image-plus-thumbnail-strip-plus-separate-white-card
          top section. The thumbnail strip that used to live directly
          below the cover is gone — those same images.gallery images now
          render further down the page (see the Gallery section below,
          after Description), so the hero reads as ONE photographic
          moment, not a database record with a filmstrip under it.
          EventCoverLightbox is reused completely unchanged for the actual
          image + tap-to-zoom-through-everything behavior; the overlay is
          `pointer-events-none` so that tap target still spans the whole
          hero, including the text. Taller/more immersive on mobile
          (4:5) than the old 16:9 strip, widening back out on larger
          viewports where more horizontal room is available. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-black/5 bg-ink sm:aspect-[21/9] sm:rounded-b-3xl">
        {coverAndGallery.length > 0 ? (
          <EventCoverLightbox images={coverAndGallery} alt={event.name} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-ink">
            <CalendarGlyph className="h-12 w-12 text-white/15" />
          </div>
        )}
        <FeaturedEventHeroOverlay
          category={category?.name ?? null}
          title={event.name}
          attribution={heroAttribution}
          statusLabel={heroTemporal.live ? "Happening Now" : null}
          isLive={heroTemporal.live}
          description={event.description}
          titleTag="h1"
        />
        <AdminEditButton href={`/admin/events/${event.id}`} className="absolute right-3 top-3 z-30" />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-7">
        {hasOccurrences ? (
          <EventOccurrenceProvider occurrences={upcomingOccurrences}>{scheduleAndDetails}</EventOccurrenceProvider>
        ) : (
          scheduleAndDetails
        )}

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
            Always renders the real stored venue fields as plain text
            (address/city/state — useful human-readable info regardless)
            plus this event's own venue_image gallery rows. The "View
            Location" link below is clickable and goes to a real Findmi
            Location profile whenever canonicalLocation resolved one
            (occurrence relationship preferred, exact-text-match fallback
            for legacy events) — never a fabricated link. */}
        {hasVenueDetails && (
          <section className="mt-8">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">About the Venue</h2>
            <div className="mt-3 flex flex-col gap-1 text-sm text-ink/70">
              {event.venue_name && <p className="font-semibold text-ink">{event.venue_name}</p>}
              {(event.address || location) && <p>{[event.address, location].filter(Boolean).join(", ")}</p>}
              {canonicalLocation && (
                <Link
                  href={`/location/${canonicalLocation.slug}`}
                  className="mt-1 inline-block w-fit text-xs font-semibold text-findmi-700 underline underline-offset-2"
                >
                  View Location ↗
                </Link>
              )}
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

// Action-row UX pass — small navigation/directions arrow for the
// Directions pill, matching the Save/Add to Calendar icons in this same
// row exactly (h-3.5 w-3.5, strokeWidth 1.8, currentColor so it inherits
// the pill's muted text-ink/60 / hover:text-ink treatment).
function DirectionsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2L4.5 20.5l.9.9L12 18l6.6 3.4.9-.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

// Same glyphs/sizing as the Location page's own Website/Call pills (Event
// + Location Action Row Consistency pass).
function GlobeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.4" ry="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6.5 4h3l1.5 4-2 1.5a11 11 0 005.5 5.5L16 13l4 1.5v3a2 2 0 01-2.2 2A16 16 0 014.5 6.2 2 2 0 016.5 4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
