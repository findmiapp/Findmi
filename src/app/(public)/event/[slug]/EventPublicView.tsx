import type { Metadata } from "next";
import type { ReactElement } from "react";
import Image from "next/image";
import { getPublicJournalCollection, journalCollectionHref } from "@/lib/journal-distribution";
import BrandHeading from "@/components/BrandHeading";
import SectionHeading from "@/components/SectionHeading";
import { EndedStatus, FactsBand, WhenFact, WhereFact } from "@/components/event/KeyFacts";
import DirectionsIconLink from "@/components/event/DirectionsIconLink";
import EventMomentsGrid from "@/components/event/EventMomentsGrid";
import EventGalleryMosaic from "@/components/event/EventGalleryMosaic";
import EventLocationFeature from "@/components/event/EventLocationFeature";
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
import EventActionRow from "@/components/event/EventActionRow";
import { EVENT_PRIMARY_CTA_CLASS, EVENT_SECONDARY_CTA_CLASS, secondaryCtaContent } from "@/lib/event-actions";
import EventScheduleSummary, { type HistoricalSchedule } from "@/components/EventScheduleSummary";
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
  getAllOccurrencesForEvent,
  getBusinessesForEvent,
  getEffectiveEventSchedule,
  getEventBySlug,
  getEventImages,
  getEventProducts,
  getLocationPlaceContext,
  getOccurrenceBusinessRosters,
  isPrimaryDateId,
} from "@/lib/data";
import {
  APP_TIMEZONE,
  cityState,
  cityStateZip,
  formatDateShort,
  formatTime,
  formatTimeInZone,
  formatTimeRange,
  getTemporalLabel,
} from "@/lib/format";
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
    .select("business:businesses!appearances_business_id_fkey(id, name, slug, logo_url)")
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

  const [businesses, [eventWithCategories], featuredProducts, images, hasOccurrences, matchedLocation, appearanceHostBusiness, journal] =
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
      // Journal Distribution V1 — public experiences connected to this
      // Event OR to any of its dates (occurrence -> Event rollup at read
      // time), de-duplicated. Public Event V2 Next Body pass — raised from
      // 6 to a still-bounded 12 so Findmi Moments' incremental "show 3
      // more" reveal has real local batches to expand through before
      // falling back to "View all Moments" (see EventMomentsGrid).
      getPublicJournalCollection({ subjectType: "event", subjectId: event.id, limit: 12, withCount: true }),
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
  // Public Event V2 Next Body pass — the Location feature strip's own
  // physical-context line ("Inside X"), same RPC LocationPublicView already
  // uses. Zero-cost (no query at all) for a Location with no parent place,
  // and null entirely when the Event has no linked Location.
  const locationPlaceContext = canonicalLocation ? await getLocationPlaceContext(canonicalLocation) : null;
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


  // Save/Share don't depend on the selected occurrence, so they're built
  // ONCE here and reused by both the single-date action row and the
  // multi-date EventActionRow (which adds its own
  // occurrence-dependent Add to Calendar on top).
  const saveAction = <EventSaveButton slug={event.slug} id={event.id} layout="icon" />;
  const shareAction = (
    <EventShareButton
      title={event.name}
      url={canonicalUrl}
      track={{ subject_type: "event", subject_id: event.id, event_id: event.id }}
      layout="icon"
    />
  );

  // ── Public Event V2.1 — storytelling hierarchy ─────────────────────────
  // Phones read top to bottom:
  //   Hero → WHEN | WHERE band → What's happening (+ bulletin) → actions
  //   → Upcoming dates (Cards/List) → lineup → Findmi
  //   Moments (+ Add yours) → Photos → place / products / host & details.
  // Desktop keeps the facts + actions in the sticky right rail. Open
  // editorial sections separated by hairlines; every section renders only
  // when it has real content. Section ids (overview, dates, lineup,
  // moments, media, place, products, details) are stable anchors. Data,
  // actions and their analytics are unchanged.

  // Ended — no date left to attend. Multi-date: nothing upcoming in the
  // effective schedule; single-date: its own end has passed.
  const legacyEnded = new Date(event.end_at ?? event.start_at).getTime() < Date.now();
  const eventEnded = hasOccurrences ? upcomingOccurrences.length === 0 : legacyEnded;

  // Multi-date with no upcoming date: the real historical schedule (one
  // extra read, only in that case) stays the headline instead of a
  // "no upcoming dates" message.
  let historical: HistoricalSchedule | null = null;
  if (hasOccurrences && realOccurrences.length === 0) {
    const past = (await getAllOccurrencesForEvent(event.id)).filter((o) => o.status !== "cancelled");
    if (past.length > 0) {
      const first = past[0];
      const last = past[past.length - 1];
      const tz = first.timezone;
      const firstLabel = formatDateWithYearInZone(first.start_at, tz);
      const lastLabel = formatDateWithYearInZone(last.end_at, tz);
      const startTime = formatTimeInZone(first.start_at, tz);
      const endTime = formatTimeInZone(first.end_at, tz);
      const uniformTime = past.every(
        (o) => formatTimeInZone(o.start_at, o.timezone) === startTime && formatTimeInZone(o.end_at, o.timezone) === endTime
      );
      const lastLocation = last.location ?? canonicalLocation;
      historical = {
        dateLabel: formatHistoricalRange(first.start_at, last.end_at, tz, firstLabel, lastLabel),
        detail: uniformTime ? `${startTime} – ${endTime}` : null,
        count: past.length > 1 ? `${past.length} dates` : null,
        where: lastLocation
          ? {
              name: lastLocation.name,
              href: `/location/${lastLocation.slug}`,
              line: [lastLocation.address, cityState(lastLocation.city, lastLocation.state)].filter(Boolean).join(", ") || null,
            }
          : last.venue_name || last.address
            ? {
                name: last.venue_name,
                href: null,
                line: [last.address, cityStateZip(last.city, last.state, last.postal_code)].filter(Boolean).join(", ") || null,
              }
            : null,
      };
    }
  }

  // Single-date (no occurrence rows) facts — server-resolved.
  const legacyWhereName = matchedLocation?.name ?? event.venue_name ?? null;
  // Address as deliberate lines (street / City, ST ZIP) so wrapping never
  // splits a city from its state.
  const legacyWhereLines = matchedLocation
    ? [matchedLocation.address, cityStateZip(matchedLocation.city, matchedLocation.state, matchedLocation.postal_code ?? null)]
    : [event.address, location];
  const legacyHasWhereLines = legacyWhereLines.some(Boolean);
  const legacySameDay = !event.end_at || formatDateShort(event.start_at) === formatDateShort(event.end_at);
  const legacyDateLabel = legacyEnded
    ? legacySameDay
      ? formatDateWithYear(event.start_at)
      : formatHistoricalRange(event.start_at, event.end_at!, APP_TIMEZONE, formatDateWithYear(event.start_at), formatDateWithYear(event.end_at!))
    : legacySameDay
      ? formatDateShort(event.start_at)
      : `${formatDateShort(event.start_at)} – ${formatDateShort(event.end_at!)}`;
  const legacyTime = legacySameDay ? formatTimeRange(event.start_at, event.end_at) : formatTime(event.start_at);
  const keyFacts = hasOccurrences ? (
    <EventScheduleSummary
      canonicalLocation={canonicalLocation}
      historical={historical}
      eventId={event.id}
      directionsEnabled={event.directions_enabled}
    />
  ) : (
    <FactsBand
      when={
        <WhenFact
          dateLabel={legacyDateLabel}
          detail={legacyTime}
          // No live line here — the hero's glass indicator is the
          // page-level "Happening now".
          status={legacyEnded ? <EndedStatus /> : null}
        />
      }
      where={
        legacyWhereName || legacyHasWhereLines ? (
          <WhereFact
            name={legacyWhereName}
            href={matchedLocation ? `/location/${matchedLocation.slug}` : null}
            lines={legacyWhereLines}
          />
        ) : null
      }
    />
  );

  // ACTIONS — a compact three-level hierarchy:
  //   A. ONE primary transactional action (Get Tickets, else RSVP) filling
  //      the row; with none (or an ended event), Follow takes that slot.
  //   B. Secondary actions (Apply to Vend, a second transactional action)
  //      as small outlined buttons on one line beneath, with Follow.
  //   C. Save / Calendar / Share as square icon controls beside the primary.
  // Message / Contact organizer stay in the host & details section. An ended
  // event keeps only Follow / Save / Share. Handlers and analytics unchanged.
  const followBlock = showFollow ? (
    <EventFollowButton eventId={event.id} eventSlug={event.slug} eventName={event.name} shape="block" />
  ) : null;
  const followCompact = showFollow ? (
    <EventFollowButton eventId={event.id} eventSlug={event.slug} eventName={event.name} size="compact" />
  ) : null;
  const ctaConfig = {
    ticketsEnabled: event.tickets_enabled,
    ticketsUrl: event.tickets_url,
    rsvpEnabled: event.rsvp_enabled,
    rsvp: rsvpForm,
    vendorApplicationsEnabled: event.vendor_applications_enabled && !vendorDeadlinePassed,
    vendorApplication: vendorAppForm,
  };
  const legacyTrack = (label: string) => ({
    event_name: (label === "Get Tickets" ? "click_tickets" : label === "Apply to Vend" ? "click_apply_to_vend" : "click_rsvp") as
      | "click_tickets"
      | "click_apply_to_vend"
      | "click_rsvp",
    subject_type: "event",
    subject_id: event.id,
    event_id: event.id,
  });

  // Multi-date: EventActionRow resolves everything per selected date.
  // Single-date: the same layout, server-side —
  //   [ primary ] [Directions] [Save] [Calendar] [Share]   (primary exists)
  //   [ DIRECTIONS ] [Save] [Calendar] [Share]              (no ticket/RSVP)
  //   [ FOLLOW ] [Save] [Calendar] [Share]                  (neither)
  const legacyPrimary = eventEnded ? null : (customCtas.find((c) => c.weight === "solid") ?? null);
  const legacySecondary = eventEnded ? [] : customCtas.filter((c) => c !== legacyPrimary);
  const legacyDirections = showDirections && !legacyEnded && directionsHref ? directionsHref : null;
  const legacyDirectionsTrack = { event_name: "click_directions" as const, subject_type: "event", subject_id: event.id, event_id: event.id };
  const legacyFollowInSecondary = Boolean(legacyPrimary || legacyDirections);

  const actions = hasOccurrences ? (
    <EventActionRow
      cta={ctaConfig}
      eventId={event.id}
      eventName={event.name}
      description={event.description}
      directionsEnabled={event.directions_enabled}
      canonicalLocation={canonicalLocation}
      save={saveAction}
      share={shareAction}
      followBlock={followBlock}
      followCompact={followCompact}
    />
  ) : (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="flex min-w-0 flex-1 empty:hidden">
          {legacyPrimary ? (
            <FormAction
              href={legacyPrimary.href}
              displayMode={legacyPrimary.displayMode}
              label={legacyPrimary.label}
              className={EVENT_PRIMARY_CTA_CLASS}
              track={legacyTrack(legacyPrimary.label)}
            />
          ) : legacyDirections ? (
            <DirectionsIconLink variant="expanded" href={legacyDirections} placeName={legacyWhereName} trackPayload={legacyDirectionsTrack} />
          ) : (
            followBlock
          )}
        </div>
        {legacyPrimary && legacyDirections && (
          <DirectionsIconLink href={legacyDirections} placeName={legacyWhereName} trackPayload={legacyDirectionsTrack} />
        )}
        {saveAction}
        {legacyEnded ? null : (
          <AddToCalendarButton
            title={event.name}
            description={event.description}
            location={venueLine || null}
            startAt={event.start_at}
            endAt={event.end_at}
            layout="icon"
          />
        )}
        {shareAction}
      </div>
      {(legacyFollowInSecondary && followCompact) || legacySecondary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {legacyFollowInSecondary ? followCompact : null}
          {legacySecondary.map((c) => {
            const content = secondaryCtaContent(c.label);
            return (
              <span key={c.label} className="inline-flex items-center gap-1.5">
                {content.prompt && <span className="text-metadata text-muted">{content.prompt}</span>}
                <FormAction
                  href={c.href}
                  displayMode={c.displayMode}
                  label={content.text}
                  className={EVENT_SECONDARY_CTA_CLASS}
                  track={legacyTrack(c.label)}
                />
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  // ── Editorial sections ────────────────────────────────────────────────
  // Bulletin — a compact collapsible announcement strip directly after the
  // actions (never between WHEN/WHERE and the primary action).
  const hasBulletin = Boolean(event.bulletin_enabled && event.bulletin_body);
  const bulletinStrip = hasBulletin ? (
    <Bulletin variant="compact" heading={event.bulletin_heading} body={event.bulletin_body!} />
  ) : null;
  // What's happening — the description preview.
  const overviewSection =
    event.description ? (
      <section id="overview" className="scroll-mt-24">
        {event.description && (
          <>
            <SectionHeading>What&rsquo;s Happening</SectionHeading>
            <div className="mt-1.5 max-w-2xl">
              <ReadMoreText
                text={event.description}
                clampClassName="line-clamp-3 sm:line-clamp-4"
                className="text-body-lg leading-relaxed text-secondary"
              />
            </div>
          </>
        )}
      </section>
    ) : null;

  const datesSection =
    realOccurrences.length > 0 ? (
      <section id="dates" className="scroll-mt-24">
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
      </section>
    ) : null;

  // Lineup — per selected date for multi-date events (renders nothing when
  // that date has no confirmed lineup), the confirmed roster otherwise.
  const lineupSection = hasOccurrences ? (
    <EventOccurrenceBusinessRoster rostersByOccurrence={rostersByOccurrence} eventName={event.name} />
  ) : businesses.length > 0 ? (
    <section id="lineup" className="scroll-mt-24">
      <BrandHeading accent="Here" />
      <p className="mt-1.5 max-w-xl text-metadata text-muted">Discover the brands, people and organizations featured at this event.</p>
      {businesses.length > 1 && <p className="mt-2 text-metadata text-muted">{businesses.length} businesses confirmed</p>}
      <EventBusinessRoster businesses={businesses} eventName={event.name} />
    </section>
  ) : null;

  // Findmi Moments — heading + compact "+ Add Moment" pill at its right,
  // the dynamic host-attribution line, an incrementally-revealed grid
  // (EventMomentsGrid — never more than two visual rows up front), and a
  // quiet "View your Journal" link. The section always renders (heading +
  // pill + copy), so the capability never disappears when there are no
  // public Moments yet — only the grid itself is conditional.
  const journalHostCopy = hostBusiness
    ? `${hostBusiness.name} may feature your moments here or on their page.`
    : "Your moments may be featured here.";
  const momentsSection = (
    <section id="moments" className="scroll-mt-24">
      <BrandHeading
        accent="Moments"
        trailing={
          <Link
            href={`/event/${event.slug}/journal`}
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-findmi/40 bg-white px-3.5 text-metadata font-bold text-findmi-700 transition hover:border-findmi/60 hover:bg-findmi-50"
          >
            + Add Moment
          </Link>
        }
      />
      <p className="mt-1.5 max-w-xl text-metadata text-muted">Share moments from your experience that will appear in your Journal.</p>
      <p className="mt-0.5 max-w-xl text-metadata italic text-subtle">{journalHostCopy}</p>
      {journal.entries.length > 0 && (
        <div className="mt-4">
          <EventMomentsGrid entries={journal.entries} total={journal.total} viewAllHref={journalCollectionHref("event", event.slug)} />
        </div>
      )}
      <div className="mt-4">
        <Link href="/my-world/journal" className="inline-flex items-center gap-1 text-metadata font-semibold text-muted transition hover:text-primary">
          View your Journal →
        </Link>
      </div>
    </section>
  );

  // Gallery / Photos — the event's own editorial gallery (event_images,
  // kind='event'), distinct from Findmi Moments (community Journal
  // content). A curated mosaic (EventGalleryMosaic), never a full dump.
  const mediaSection =
    images.gallery.length > 0 ? (
      <section id="media" className="scroll-mt-24">
        <SectionHeading>Gallery</SectionHeading>
        <div className="mt-3">
          <EventGalleryMosaic images={images.gallery} alt={event.name} />
        </div>
      </section>
    ) : null;

  // Location feature — a compact destination strip for the Event's real
  // linked Location, between Gallery/Photos and Hosted By. Only when a
  // genuine Location relationship exists (see canonicalLocation above) —
  // never fabricated from plain venue text.
  const locationFeatureSection = canonicalLocation ? (
    <EventLocationFeature location={canonicalLocation} placeContext={locationPlaceContext} />
  ) : null;

  // Hosted By — organizer identity, extracted from the old details block
  // so it sits in its own place in the storytelling order (after Location,
  // before the remaining secondary/details content). Never conflated with
  // Findmi Here (participants) or Location (physical place) — see each
  // section's own note.
  const hostedBySection =
    hostBusiness || hasOrganizer ? (
      <section id="hosted-by" className="scroll-mt-24">
        {hostBusiness ? (
          <>
            <p className="text-label font-bold uppercase text-subtle">Hosted By</p>
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
          <>
            <p className="text-label font-bold uppercase text-subtle">Run By</p>
            <p className="mt-1 text-card-title-lg font-bold text-primary">{event.organizer_name}</p>
          </>
        )}
      </section>
    ) : null;

  // Place — only when it adds something beyond the facts band (the event's
  // own venue photos); never a second copy of the same Location card.
  const placeName = canonicalLocation?.name ?? event.venue_name ?? null;
  const placeSection =
    images.venue.length > 0 ? (
      <section id="place" className="scroll-mt-24">
        <SectionHeading>The Place</SectionHeading>
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
        <div className="-mx-4 mt-3 sm:-mx-6 lg:mx-0">
          <HorizontalScroller className="lg:px-0">
            {featuredProducts.map((p) => (
              <div key={p.id} className="w-[42%] min-w-[150px] max-w-[176px] shrink-0 sm:w-44">
                <ProductCard product={p} />
              </div>
            ))}
          </HorizontalScroller>
        </div>
      </section>
    ) : null;

  // Host & details — attribution, then the lower-frequency ways to reach
  // out (Message, Contact organizer, Website, Call, external details) as
  // one quiet line, then Claim.
  const quietLinkClass = "inline-flex items-center gap-1.5 text-metadata font-semibold text-secondary transition hover:text-findmi-700";
  const contactLinks =
    showMessageButton || canonicalWebsite || canonicalPhone || showContact || event.external_url ? (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {showMessageButton && (
          <MessageButton
            size="compact"
            targetType="event"
            targetId={event.id}
            targetName={event.name}
            eventOccurrences={hasOccurrences ? upcomingOccurrences.map((o) => ({ id: o.id, startAt: o.start_at })) : undefined}
          />
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
        {event.external_url && (
          <a href={event.external_url} target="_blank" rel="noreferrer" className={quietLinkClass}>
            <ExternalGlyph className="h-4 w-4 shrink-0 text-ink/40" />
            Event details
          </a>
        )}
      </div>
    ) : null;

  // Public Event V2 Next Body pass — Hosted By moved to its own section
  // (hostedBySection, above); this is just the remaining quiet contact
  // links + Claim, now the last stop in "remaining secondary content".
  const detailsSection = (
    <section id="details" className="scroll-mt-24">
      {contactLinks}
      {/* Claim foundation pass — deliberately last, small, and muted. */}
      <div className={contactLinks ? "mt-6" : ""}>
        <ClaimButton type="event" slug={event.slug} entityName={event.name} />
      </div>
    </section>
  );

  // Layout. Phones: one flex column whose order is the storytelling order
  // above (the two desktop wrappers are display:contents there, so their
  // children interleave via `order`). Desktop (lg): a two-column grid —
  // story on the left, facts + actions in a sticky right rail.
  // Bottom spacing: the shared Footer already reserves mt-16 (64px) above
  // itself, so the page adds no bottom padding of its own and the last
  // section drops its bottom padding — 64px of breathing room after the
  // final content, not page padding + section padding + footer margin
  // stacked (≈156px before V2.1 Live Polish).
  // Top sequence (phones): Hero → Essentials (WHEN | WHERE) → Actions →
  // Bulletin → Upcoming Dates → What's Happening → … Spacing, not rules.
  // Desktop keeps Essentials + Actions in the sticky right rail.
  const body = (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-4 sm:px-6 sm:pt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-14 lg:pt-10">
      <div className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:block lg:self-start">
        <div className="order-1">{keyFacts}</div>
        <div className="order-2 mt-4 lg:mt-5">{actions}</div>
      </div>
      <div className="contents lg:col-start-1 lg:row-start-1 lg:block">
        {bulletinStrip && <div className="order-3 mt-3 lg:mt-0">{bulletinStrip}</div>}
        {/* Sections are separated by spacing and typography, not a rule
            after every block. Public Event V2 Next Body pass — target
            order: Upcoming Dates → Findmi Moments → Findmi Here →
            Gallery/Photos → Location feature → Hosted By → remaining
            secondary content (What's Happening → The Place → Products →
            contact/Claim). */}
        <div className={`order-4 mt-8 flex flex-col gap-9 ${bulletinStrip ? "lg:mt-8" : "lg:mt-0"}`}>
          {datesSection}
          {momentsSection}
          {lineupSection}
          {mediaSection}
          {locationFeatureSection}
          {hostedBySection}
          {overviewSection}
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
          attributionLogoUrl={hostBusiness?.logo_url ?? null}
          venueLabel={heroVenueLabel}
          statusLabel={heroTemporal.live ? "Happening now" : null}
          isLive={heroTemporal.live}
          showStatusOnFull
          titleTag="h1"
        />
        <AdminEditButton href={`/admin/events/${event.id}`} className="absolute right-3 top-3 z-30" />
      </div>

      {/* The selected-date context wraps facts, actions AND sections, so the
          facts band, actions, the dates rail and the lineup stay in sync. Only
          genuine occurrence rows are selectable (never the synthesized
          whole-event range — see the Final Event Experience Polish note in
          git history). */}
      {hasOccurrences ? <EventOccurrenceProvider occurrences={realOccurrences}>{body}</EventOccurrenceProvider> : body}
    </div>
  );
}

/** Past dates carry their year ("Feb 14, 2026") — an ended event's
 * historical timing should never read as an upcoming weekday. */
function formatDateWithYearInZone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });
}

/** "Feb 12 – 14, 2026" style when both ends share a year (fits the
 * half-width band); full dates otherwise. */
function formatHistoricalRange(startIso: string, endIso: string, timezone: string, startLabel: string, endLabel: string): string {
  if (startLabel === endLabel) return startLabel;
  const part = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, ...o });
  const sy = part(startIso, { year: "numeric" });
  if (sy !== part(endIso, { year: "numeric" })) return `${startLabel} – ${endLabel}`;
  const sm = part(startIso, { month: "short" });
  const em = part(endIso, { month: "short" });
  const endPart = sm === em ? part(endIso, { day: "numeric" }) : `${em} ${part(endIso, { day: "numeric" })}`;
  return `${sm} ${part(startIso, { day: "numeric" })} – ${endPart}, ${sy}`;
}

function formatDateWithYear(iso: string): string {
  return formatDateWithYearInZone(iso, APP_TIMEZONE);
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
