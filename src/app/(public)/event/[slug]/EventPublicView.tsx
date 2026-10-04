import type { Metadata } from "next";
import type { ReactElement } from "react";
import Image from "next/image";
import JournalCollection from "@/components/journal/JournalCollection";
import { getPublicJournalCollection, journalCollectionHref } from "@/lib/journal-distribution";
import BrandHeading from "@/components/BrandHeading";
import { LiveStatus, QuietStatus, WhenFact, WhereFact } from "@/components/event/KeyFacts";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import DocumentExperienceCta from "@/components/journal/DocumentExperienceCta";
import { getEventJournalCtaState } from "./journalCaptureActions";
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
import EventUtilityActions, { DirectionsGridCell, UtilityActionGrid } from "@/components/EventUtilityActions";
import EventScheduleSummary from "@/components/EventScheduleSummary";
import EventShareButton from "@/components/EventShareButton";
import PageViewTracker from "@/components/analytics/PageViewTracker";
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
import { cityState, cityStateZip, formatDateRange, formatTime, getTemporalLabel } from "@/lib/format";
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

export interface AppearanceHostBusiness {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

/** Event Page Visual Convergence pass — root-caused why the hero byline/
 * Hosted By card were coming up empty for events (illy's Cup of Love
 * included) whose real Business<->Event link lives on an `appearances`
 * row (business_id + event_id — the FindMi Here relationship a business
 * owner actually created) rather than an event_businesses roster row
 * (the separate "who's confirmed at this event" concept — see
 * getBusinessesForEvent). Both are genuine, existing relationships;
 * neither is invented here. Only returns a business when exactly ONE
 * distinct Business has a non-cancelled Appearance linked to this Event —
 * two or more stays attribution-less rather than guessing which one is
 * "the" host. */
export async function resolveAppearanceHostBusiness(eventId: string): Promise<AppearanceHostBusiness | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("appearances")
    .select("business:businesses(id, name, slug, logo_url)")
    .eq("event_id", eventId)
    .neq("status", "canceled")
    .limit(10);
  if (!data) return null;

  type JoinedBusiness = AppearanceHostBusiness;
  const byId = new Map<string, JoinedBusiness>();
  for (const row of data) {
    const b = Array.isArray(row.business) ? row.business[0] : row.business;
    if (b) byId.set(b.id, b as JoinedBusiness);
  }
  return byId.size === 1 ? Array.from(byId.values())[0] : null;
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

  const [businesses, [eventWithCategories], featuredProducts, images, hasOccurrences, matchedLocation, appearanceHostBusiness, journalCtaState, journal] =
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
      // Event Page Visual Convergence pass — see resolveAppearanceHostBusiness's
      // own comment for why this second signal is needed alongside
      // event_businesses.featured below.
      resolveAppearanceHostBusiness(event.id),
      // Event Action UX + Universal Journal CTA pass — drives the
      // Journal CTA's own copy for the current viewer (none/draft/
      // published); a signed-out visitor always resolves to "none" (see
      // getEventJournalCtaState's own comment). The CTA itself always
      // renders regardless of this value — only its copy changes.
      getEventJournalCtaState(event.id),
      // Journal Distribution V1 — public experiences connected to this
      // Event OR to any of its dates (occurrence -> Event rollup at read
      // time), de-duplicated.
      getPublicJournalCollection({ subjectType: "event", subjectId: event.id, limit: 6, withCount: true }),
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
  // Event Page Visual Correction pass — the synthesized Primary Date entry
  // (the whole event's own start_at/end_at span, shaped identically to a
  // real occurrence for the selection/roster-keying logic below) must
  // never appear as a displayed date CARD — it reads as a redundant
  // "event-range" card alongside the real per-date ones. Filtered out
  // ONLY for the rail passed to UpcomingDatesRail below; every other use
  // of upcomingOccurrences (EventOccurrenceProvider's selection context,
  // roster keying, Message's own date list) is unchanged.
  const realOccurrences = upcomingOccurrences.filter((o) => !isPrimaryDateId(o.id));
  const realOccurrenceIds = realOccurrences.map((o) => o.id);
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

  // Event Page Visual Convergence pass — the host Business now checks
  // THREE existing signals, in order, before giving up:
  //   1. event_businesses.featured — an explicit founder/roster flag
  //      (already fetched above as `businesses`).
  //   2. A Business's own Appearance linked to this Event
  //      (appearances.event_id) — the FindMi Here relationship a real
  //      business owner creates, which root-caused why illy's own "by
  //      illy" byline was empty: that business never got an
  //      event_businesses roster row, only an Appearance one. See
  //      resolveAppearanceHostBusiness's own comment.
  //   3. Exactly one approved event_businesses participant with no
  //      explicit featured flag — unambiguous by elimination.
  // Never invents a relationship: each tier is a real existing FK, and an
  // ambiguous case (2+ un-featured participants, 2+ distinct Appearance
  // businesses) stays attribution-less rather than guessing. Used for
  // both the hero byline and the "Hosted By" card near the bottom of the
  // page.
  const hostBusiness =
    businesses.find((b) => b.featured) ?? appearanceHostBusiness ?? (businesses.length === 1 ? businesses[0] : null);
  // Status reuses the nearest still-scheduled occurrence's real start/end
  // when one exists (a recurring event's own start_at/end_at can be stale
  // once occurrences exist) — same getTemporalLabel() every other
  // live-status pill in this codebase (BusinessPublicView/HomeEventCard/
  // HappeningCard) already computes from, never a hardcoded/guessed status.
  const heroTemporalSource = upcomingOccurrences[0] ?? { start_at: event.start_at, end_at: event.end_at };
  const heroTemporal = getTemporalLabel(heroTemporalSource.start_at, heroTemporalSource.end_at ?? undefined);

  // Event Top Hierarchy Final Micro-pass — the hero no longer shows any
  // temporal metadata (that reverted to the white logistics card below
  // it); it now shows only the best already-resolved Location name,
  // directly beneath the title. canonicalLocation is the exact same
  // already-resolved Location every other Location reference on this
  // page uses (the nearest occurrence with a linked Location, or the
  // legacy exact-venue-match) — no new query, no new field.
  const heroVenueLabel = canonicalLocation?.name ?? null;

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
  // Public Event V2 — every organizer action (including a single-date
  // event's Apply to Vend) now lives in the one primary action row.

  const showContact = event.contact_enabled;
  const showMessageButton = await shouldShowMessageButton("event", event.id);
  const showFollow = event.follow_enabled;
  const showDirections = event.directions_enabled && Boolean(directionsHref);

  // Item 18 (Run By) — events has no organizer->Business/Person
  // relationship today (organizer_name is plain text) — see the pass
  // report. Rendered as plain text only; never a fabricated profile link.
  const hasOrganizer = Boolean(event.organizer_name?.trim());


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

  // ── Public Event V2 ────────────────────────────────────────────────────
  // ESSENTIALS FIRST (key facts, actions, Moments) · EXPERIENCE SECOND
  // (overview, dates, lineup, Findmi Moments, photos) · DEEP DETAILS LAST
  // (place, products, host, claim). Open editorial sections separated by
  // hairlines instead of stacked bordered cards; every section renders only
  // when it has real content. Section ids (overview, dates, lineup,
  // moments, media, place, products, details) are stable anchors for the
  // future entity sub-nav. Data, actions and their analytics are unchanged.

  // Single-date (no occurrence rows) Key Facts — server-resolved.
  const legacyEnded = new Date(event.end_at ?? event.start_at).getTime() < Date.now();
  const legacyWhereName = matchedLocation?.name ?? event.venue_name ?? null;
  const legacyWhereLine = matchedLocation
    ? [matchedLocation.address, cityState(matchedLocation.city, matchedLocation.state)].filter(Boolean).join(", ")
    : [event.address, location].filter(Boolean).join(", ");
  const keyFacts = hasOccurrences ? (
    <EventScheduleSummary canonicalLocation={canonicalLocation} />
  ) : (
    <div className="flex flex-col gap-3.5">
      <WhenFact
        dateLabel={formatDateRange(event.start_at, event.end_at)}
        status={
          heroTemporal.live ? (
            <LiveStatus until={event.end_at ? formatTime(event.end_at) : null} />
          ) : legacyEnded ? (
            <QuietStatus>This event has ended</QuietStatus>
          ) : null
        }
      />
      <WhereFact
        name={legacyWhereName}
        href={matchedLocation ? `/location/${matchedLocation.slug}` : null}
        line={legacyWhereLine || null}
      />
    </div>
  );

  // PRIMARY ACTION row — organizer actions (Tickets/RSVP/Apply to Vend)
  // plus Follow. Multi-date events resolve them per selected date.
  const followButton = showFollow ? (
    <EventFollowButton eventId={event.id} eventSlug={event.slug} eventName={event.name} />
  ) : null;
  const primaryRow = (
    <div className="flex flex-wrap items-center gap-2.5 empty:hidden">
      {hasOccurrences ? (
        <EventScheduleCtas
          bare
          eventId={event.id}
          ticketsEnabled={event.tickets_enabled}
          ticketsUrl={event.tickets_url}
          rsvpEnabled={event.rsvp_enabled}
          rsvp={rsvpForm}
          vendorApplicationsEnabled={event.vendor_applications_enabled && !vendorDeadlinePassed}
          vendorApplication={vendorAppForm}
        />
      ) : (
        customCtas.map((action) => (
          <FormAction
            key={action.label}
            href={action.href}
            displayMode={action.displayMode}
            label={action.label}
            className={
              action.weight === "solid"
                ? "flex h-11 min-w-[8rem] flex-1 items-center justify-center rounded-full bg-findmi px-6 text-button font-bold text-white transition hover:bg-findmi-600"
                : "flex h-11 min-w-[8rem] flex-1 items-center justify-center rounded-full border border-findmi/40 bg-white px-5 text-button font-bold text-findmi-700 transition hover:bg-findmi-50"
            }
            track={{
              event_name:
                action.label === "Get Tickets" ? "click_tickets" : action.label === "Apply to Vend" ? "click_apply_to_vend" : "click_rsvp",
              subject_type: "event",
              subject_id: event.id,
              event_id: event.id,
            }}
          />
        ))
      )}
      {followButton}
    </div>
  );

  // UTILITIES — one quiet segmented bar (Message/Save/Calendar/Share/Get
  // Here), each action exactly once.
  const utilityBar = hasOccurrences ? (
    <EventUtilityActions
      variant="bar"
      eventId={event.id}
      eventName={event.name}
      description={event.description}
      message={messageAction}
      save={saveAction}
      share={shareAction}
      directionsEnabled={event.directions_enabled}
      canonicalLocation={canonicalLocation}
    />
  ) : (
    <UtilityActionGrid
      variant="bar"
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
        showDirections ? (
          <DirectionsGridCell
            key="directions"
            href={directionsHref!}
            trackPayload={{ event_name: "click_directions", subject_type: "event", subject_id: event.id, event_id: event.id }}
          />
        ) : null,
      ].filter((item): item is ReactElement => Boolean(item))}
    />
  );

  // Lower-frequency links folded into one quiet line (never their own rows).
  const quietLinkClass = "inline-flex items-center gap-1.5 text-metadata font-semibold text-secondary transition hover:text-findmi-700";
  const secondaryLinks =
    canonicalWebsite || canonicalPhone || showContact || event.external_url ? (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {canonicalWebsite && (
          <a href={canonicalWebsite} target="_blank" rel="noreferrer" className={quietLinkClass}>
            <GlobeGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            Website
          </a>
        )}
        {canonicalPhone && (
          <a href={`tel:${canonicalPhone}`} className={quietLinkClass}>
            <PhoneGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            Call
          </a>
        )}
        {showContact && (
          <InquireButton
            targetType="event"
            targetId={event.id}
            targetName={event.name}
            label="Contact organizer"
            className={quietLinkClass}
            track={{ event_name: "click_contact_organizer", subject_type: "event", subject_id: event.id, event_id: event.id }}
          />
        )}
        {event.external_url && (
          <a href={event.external_url} target="_blank" rel="noreferrer" className={quietLinkClass}>
            <ExternalGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            Event details
          </a>
        )}
      </div>
    ) : null;

  const essentials = (
    <div className="flex flex-col gap-5">
      {keyFacts}
      <div className="flex flex-col gap-3">
        {primaryRow}
        {utilityBar}
        {secondaryLinks}
      </div>
      <DocumentExperienceCta eventSlug={event.slug} state={journalCtaState} />
    </div>
  );

  // ── Editorial sections ────────────────────────────────────────────────
  const overviewSection =
    event.description || (event.bulletin_enabled && event.bulletin_body) ? (
      <section id="overview" className="scroll-mt-24">
        {event.description && (
          <>
            <SectionHeading>What&rsquo;s happening</SectionHeading>
            <div className="mt-2 max-w-2xl text-body-lg leading-relaxed text-secondary">
              <ReadMoreText text={event.description} />
            </div>
          </>
        )}
        {event.bulletin_enabled && event.bulletin_body && (
          <div className={event.description ? "mt-4" : ""}>
            <Bulletin heading={event.bulletin_heading} body={event.bulletin_body} />
          </div>
        )}
      </section>
    ) : null;

  const datesSection =
    realOccurrences.length > 0 ? (
      <section id="dates" className="scroll-mt-24">
        <SectionHeading>Upcoming dates</SectionHeading>
        <p className="mt-0.5 text-metadata text-muted">
          {realOccurrences.length} upcoming date{realOccurrences.length === 1 ? "" : "s"} · tap one to see its details
        </p>
        <div className="-mx-4 mt-1 sm:mx-0">
          <UpcomingDatesRail
            occurrences={realOccurrences}
            eventName={event.name}
            eventId={event.id}
            canonicalLocation={canonicalLocation}
            coverImageUrl={coverAndGallery[0] ?? null}
            galleryImages={images.gallery}
            ticketsEnabled={event.tickets_enabled}
            ticketsUrl={event.tickets_url}
            rsvpEnabled={event.rsvp_enabled}
            rsvp={rsvpForm}
            vendorApplicationsEnabled={event.vendor_applications_enabled && !vendorDeadlinePassed}
            vendorApplication={vendorAppForm}
            rostersByOccurrence={rostersByOccurrence}
          />
        </div>
      </section>
    ) : null;

  // Lineup — per selected date for multi-date events (renders nothing when
  // that date has no confirmed lineup), the confirmed roster otherwise.
  const lineupSection = hasOccurrences ? (
    <EventOccurrenceBusinessRoster rostersByOccurrence={rostersByOccurrence} eventName={event.name} />
  ) : businesses.length > 0 ? (
    <section id="lineup" className="scroll-mt-24">
      <SectionHeading>Who You&rsquo;ll Find Here</SectionHeading>
      <p className="mt-0.5 text-metadata text-muted">
        {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
      </p>
      <EventBusinessRoster businesses={businesses} eventName={event.name} />
    </section>
  ) : null;

  const momentsSection =
    journal.entries.length > 0 ? (
      <section id="moments" className="scroll-mt-24">
        <BrandHeading
          accent="Moments"
          className="mb-3"
          trailing={
            journal.total != null && journal.total > journal.entries.length ? (
              <Link href={journalCollectionHref("event", event.slug)} className="text-metadata font-semibold text-findmi-700 hover:underline">
                See all {journal.total}
              </Link>
            ) : null
          }
        />
        <JournalCollection entries={journal.entries} total={journal.total} />
      </section>
    ) : null;

  // Photos — the event's own gallery (the cover lives in the hero, whose
  // lightbox also reaches every gallery image). A future MediaMosaic can
  // replace this block in place.
  const mediaSection =
    images.gallery.length > 0 ? (
      <section id="media" className="scroll-mt-24">
        <SectionHeading>Photos</SectionHeading>
        <div className="mt-3">
          <ImageGalleryStrip images={images.gallery} alt={event.name} unoptimized minCount={1} />
        </div>
      </section>
    ) : null;

  // Place — only when it adds something beyond Key Facts (the event's own
  // venue photos); never a second copy of the same Location card.
  const placeName = canonicalLocation?.name ?? event.venue_name ?? null;
  const placeSection =
    images.venue.length > 0 ? (
      <section id="place" className="scroll-mt-24">
        <SectionHeading>The place</SectionHeading>
        {placeName &&
          (canonicalLocation ? (
            <Link href={`/location/${canonicalLocation.slug}`} className="mt-0.5 inline-block text-metadata font-semibold text-findmi-700 hover:underline">
              {placeName} ›
            </Link>
          ) : (
            <p className="mt-0.5 text-metadata text-muted">{placeName}</p>
          ))}
        <div className="mt-3">
          <ImageGalleryStrip images={images.venue} alt={placeName ?? "Venue"} />
        </div>
      </section>
    ) : null;

  const productsSection =
    featuredProducts.length > 0 ? (
      <section id="products" className="scroll-mt-24">
        <SectionHeading>{event.featured_products_heading?.trim() || "Featured at This Event"}</SectionHeading>
        <div className="-mx-4 mt-3 sm:mx-0">
          <HorizontalScroller>
            {featuredProducts.map((p) => (
              <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                <ProductCard product={p} />
              </div>
            ))}
          </HorizontalScroller>
        </div>
      </section>
    ) : null;

  const detailsSection = (
    <section id="details" className="scroll-mt-24">
      {hostBusiness ? (
        <>
          <p className="text-label font-bold uppercase text-subtle">Hosted by</p>
          <Link href={`/business/${hostBusiness.slug}`} className="group mt-2 flex items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-black/5 ring-1 ring-black/[0.06]">
              {hostBusiness.logo_url ? (
                <Image src={hostBusiness.logo_url} alt="" fill unoptimized sizes="48px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold uppercase text-ink/30">
                  {hostBusiness.name.charAt(0)}
                </div>
              )}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-card-title-lg font-bold text-primary group-hover:text-findmi-700">{hostBusiness.name}</span>
              <span className="text-metadata font-semibold text-findmi-700">View brand ›</span>
            </span>
          </Link>
        </>
      ) : (
        hasOrganizer && (
          <>
            <p className="text-label font-bold uppercase text-subtle">Run by</p>
            <p className="mt-1 text-card-title-lg font-bold text-primary">{event.organizer_name}</p>
          </>
        )
      )}
      {/* Claim foundation pass — deliberately last, small, and muted. */}
      <div className={hostBusiness || hasOrganizer ? "mt-6" : ""}>
        <ClaimButton type="event" slug={event.slug} entityName={event.name} />
      </div>
    </section>
  );

  const body = (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 sm:pt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-14 lg:pt-10">
      {/* Essentials — first on phones; a sticky right rail on desktop. */}
      <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start">{essentials}</aside>
      {/* Experience + details. divide-y only separates sections that
          actually render (client sections that resolve to nothing leave no
          stray separator). */}
      <div className="mt-8 border-t border-black/[0.07] lg:col-start-1 lg:row-start-1 lg:mt-0 lg:border-t-0">
        <div className="divide-y divide-black/[0.07] [&>*]:py-7 lg:[&>*:first-child]:pt-0">
          {overviewSection}
          {datesSection}
          {lineupSection}
          {momentsSection}
          {mediaSection}
          {placeSection}
          {productsSection}
          {detailsSection}
        </div>
      </div>
    </div>
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
      {/* Hero — full-bleed photography with restrained scroll depth
          (EventCoverLightbox parallax; static with reduced motion or
          without browser support). Title, place and host attribution; a
          live pill only when genuinely live. */}
      <div
        className={`relative w-full overflow-hidden bg-ink sm:rounded-b-3xl ${
          coverAndGallery.length > 0
            ? "h-[40vh] max-h-[380px] min-h-[240px] sm:h-auto sm:max-h-[520px] sm:aspect-[21/9]"
            : "h-[200px] sm:h-[260px]"
        }`}
      >
        {coverAndGallery.length > 0 ? (
          <EventCoverLightbox images={coverAndGallery} alt={event.name} parallax />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink to-findmi-900">
            <CalendarGlyph className="h-12 w-12 text-white/15" />
          </div>
        )}
        <FeaturedEventHeroOverlay
          category={category?.name ?? null}
          title={event.name}
          attribution={hostBusiness?.name ?? null}
          attributionHref={hostBusiness ? `/business/${hostBusiness.slug}` : undefined}
          venueLabel={heroVenueLabel}
          statusLabel={heroTemporal.live ? "Happening now" : null}
          isLive={heroTemporal.live}
          showStatusOnFull
          titleTag="h1"
        />
        <AdminEditButton href={`/admin/events/${event.id}`} className="absolute right-3 top-3 z-30" />
      </div>

      {/* The selected-date context wraps essentials AND sections, so Key
          Facts, actions, the dates rail and the lineup stay in sync. Only
          genuine occurrence rows are selectable (never the synthesized
          whole-event range — see the Final Event Experience Polish note in
          git history). */}
      {hasOccurrences ? <EventOccurrenceProvider occurrences={realOccurrences}>{body}</EventOccurrenceProvider> : body}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-section-title-lg font-bold text-primary">{children}</h2>;
}

function ExternalGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M14 5h5v5M19 5l-8 8M17 14v4.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
