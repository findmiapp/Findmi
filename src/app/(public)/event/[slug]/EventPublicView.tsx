import type { Metadata } from "next";
import type { ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminEditButton from "@/components/AdminEditButton";
import DocumentExperienceButton from "@/components/journal/DocumentExperienceButton";
import { isAdminSession } from "@/lib/admin/auth";
import AddToCalendarButton from "@/components/AddToCalendarButton";
import ClaimButton from "@/components/ClaimButton";
import MessageButton from "@/components/MessageButton";
import InquireButton from "@/components/InquireButton";
import { shouldShowMessageButton } from "@/lib/message-visibility";
import Bulletin from "@/components/Bulletin";
import EventBusinessRoster from "@/components/EventBusinessRoster";
import EventCoverLightbox from "@/components/EventCoverLightbox";
import EventFollowButton from "@/components/EventFollowButton";
import EventLocationCard from "@/components/EventLocationCard";
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

  const [businesses, [eventWithCategories], featuredProducts, images, hasOccurrences, matchedLocation, appearanceHostBusiness, isAdmin] =
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
      // Journal Live Capture pass — server-verified once here, reused for
      // both the "Document this experience" entry point's visibility and
      // nothing else; the actual mutation it triggers re-verifies this
      // independently server-side (see journalCaptureActions.ts).
      isAdminSession(),
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

  // Event Page Final Compression pass — the occurrence date rail and
  // "Who You'll Find Here" are built once as their own variables (not
  // duplicated in source) because this pass renders them in ONE of TWO
  // different positions depending on whether the event actually has real
  // occurrences to show — see showOccurrenceCluster/scheduleAndDetails
  // below. Both blocks are exactly what already existed before this
  // pass, just extracted so they can be placed conditionally. The rail
  // itself is still self-guarded (renders nothing with zero real
  // occurrences), and the roster ternary is still the exact original
  // hasOccurrences branch — only each block's POSITION on the page
  // changes, never its own internal logic.
  const showOccurrenceCluster = realOccurrences.length > 0;
  const datesAndLineupSection = realOccurrences.length > 0 && (
    <div className="mt-3 -mx-4 sm:mx-0">
      <p className="mb-2 px-4 font-display text-lg font-bold tracking-tight text-ink sm:px-0">
        Upcoming Dates &amp; Lineup
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
  );
  const whoYoullFindHere = hasOccurrences ? (
    <EventOccurrenceBusinessRoster rostersByOccurrence={rostersByOccurrence} eventName={event.name} />
  ) : (
    <section className="mt-5">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink">Who You&rsquo;ll Find Here</h2>
      <p className="mt-1 text-sm text-ink/55">
        {businesses.length} business{businesses.length === 1 ? "" : "es"} confirmed
      </p>
      <EventBusinessRoster businesses={businesses} eventName={event.name} />
    </section>
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
          <EventScheduleSummary canonicalLocation={canonicalLocation} />
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-sm text-ink/65">
            <div className="flex items-center gap-2">
              <CalendarGlyph className="h-4 w-4 shrink-0 text-ink/40" />
              <span className="font-medium text-ink/80">{formatDateRange(event.start_at, event.end_at)}</span>
            </div>
            {matchedLocation ? (
              <EventLocationCard location={matchedLocation} />
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
          relationship content). For a recurring event, the selected
          occurrence's own RSVP/ticket/vendor-apply override (if any) wins
          over the parent's resolved action — see EventScheduleCtas; a
          legacy event keeps the exact original server-resolved customCtas
          rendering below (minus Apply to Vend, in the secondary row below
          instead — see legacyTierACtas).
          Event Page Visual Convergence pass — Directions moved OUT of
          this row into the compact Tier B grid below (alongside Save/
          Calendar/Share), matching the approved reference: RSVP/Tickets
          alone here (the visually LARGEST action), not sharing a row with
          a same-size Directions button. Each button is flex-1, so 1 or 2
          Tier A actions still degrade sensibly; flex-wrap keeps every
          action reachable at 360px. */}
      {hasOccurrences ? (
        <EventScheduleCtas
          eventId={event.id}
          ticketsEnabled={event.tickets_enabled}
          ticketsUrl={event.tickets_url}
          rsvpEnabled={event.rsvp_enabled}
          rsvp={rsvpForm}
          vendorApplicationsEnabled={event.vendor_applications_enabled && !vendorDeadlinePassed}
          vendorApplication={vendorAppForm}
        />
      ) : (
        legacyTierACtas.length > 0 && (
          <div className="mt-3 flex flex-wrap items-stretch gap-2.5">
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
      )}

      {/* Overflow utilities — Contact Organizer / Event Details are
          separate, lower-frequency actions that don't belong in the
          strict 4-slot Message/Save/Calendar/Share module above. Kept as
          their own self-guarded, horizontally scrollable row (only
          rendered when at least one exists) rather than stretching the
          module to 5-6 uneven columns.
          Journal Live Capture pass — "Document this experience" joins this
          same row rather than a new one: it's exactly this row's own
          "lower-frequency, doesn't belong in the strict 4-slot grid"
          category, just admin-only instead of visitor-facing. Gate reuses
          isAdminSession() (same check AdminEditButton/the Journal pencil
          already use) computed once above; an ordinary visitor never sees
          this row at all unless Contact/Event Details already would have
          shown it anyway. */}
      {(showContact || event.external_url || isAdmin) && (
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
            {isAdmin && <DocumentExperienceButton eventSlug={event.slug} />}
          </div>
        </div>
      )}

      {/* Item 8 — optional Bulletin, same shared component as Business
          Profile, right after the utility row and before About. */}
      <div className="mt-2">
        <Bulletin heading={event.bulletin_heading} body={event.bulletin_enabled ? event.bulletin_body : null} />
      </div>

      {/* Event Page Final Compression pass — when the event has real
          occurrences to show, Upcoming Dates & Lineup and Who You'll Find
          Here move up to sit directly beneath the actions (the occurrence
          experience is more actionable than the description/gallery and
          should be reachable sooner) — both are the exact same blocks
          built once above (datesAndLineupSection/whoYoullFindHere), just
          rendered in this earlier position instead of after the gallery.
          An event with no real occurrences renders nothing here
          (datesAndLineupSection is self-guarded; the roster is rendered
          in its original later position below instead) — never an empty
          "Upcoming Dates & Lineup" section. */}
      {showOccurrenceCluster && (
        <>
          {datesAndLineupSection}
          {whoYoullFindHere}
        </>
      )}

      {/* Event Page Visual Convergence pass — the approved reference runs
          the description directly after logistics/actions with no large
          section heading at all on mobile (a big "ABOUT THIS EVENT" label
          + generous margins was exactly the kind of vertical cost Dates &
          Lineup was buried under). Heading now hidden below sm: — desktop
          keeps it, where there's width/height to spare. Same single
          description field, same collapsed-by-default ReadMoreText. */}
      {event.description && (
        <section className="mt-3">
          <h2 className="hidden font-display text-lg font-bold tracking-tight text-ink sm:block">About This Event</h2>
          <div className="mt-0 max-w-2xl sm:mt-3">
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
        <div className="mt-3 -mx-4 sm:mx-0">
          <div className="px-4 sm:px-0">
            <ImageGalleryStrip images={images.gallery} alt={event.name} unoptimized minCount={1} compact />
          </div>
        </div>
      )}

      {/* Event Page Final Compression pass — an event with NO real
          occurrences (a legacy one-time event, or a recurring event with
          none currently upcoming) keeps the original ordering: Who You'll
          Find Here stays here, after the description/gallery, exactly as
          before this pass. showOccurrenceCluster's own block above
          already rendered it earlier for every event that actually has
          something to show in Upcoming Dates & Lineup. */}
      {!showOccurrenceCluster && whoYoullFindHere}
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
      {/* Event Page Visual Convergence pass — tightened further (42vh/400px
          -> 36vh/340px) against the approved reference: the hero stays
          immersive (full-bleed image + gradient + overlay) but must leave
          RSVP/actions reachable within/near the first mobile viewport,
          not just "not the whole screen." A viewport-relative height (not
          an aspect ratio) with min/max clamps keeps the hero's mobile
          height proportional to the device rather than to its own width.
          Desktop keeps the original cinematic 21/9 strip — this
          correction is mobile-only. EventCoverLightbox/gradient/category/
          title/status/analytics are otherwise unchanged. */}
      <div className="relative h-[36vh] max-h-[340px] min-h-[220px] w-full overflow-hidden border-b border-black/5 bg-ink sm:h-auto sm:aspect-[21/9] sm:rounded-b-3xl">
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
          attribution={hostBusiness?.name ?? null}
          attributionHref={hostBusiness ? `/business/${hostBusiness.slug}` : undefined}
          venueLabel={heroVenueLabel}
          statusLabel={heroTemporal.live ? "Happening Now" : null}
          isLive={heroTemporal.live}
          titleTag="h1"
        />
        <AdminEditButton href={`/admin/events/${event.id}`} className="absolute right-3 top-3 z-30" />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 sm:py-7">
        {/* Final Event Experience Polish pass — root-caused why the
            default occurrence selection (and therefore the top logistics
            module, the Dates & Lineup rail's selected card, and Who
            You'll Find Here) could silently resolve to the SYNTHESIZED
            whole-event-range entry (see getEffectiveEventSchedule's own
            "Primary Date Integrity" comment) instead of a real per-day
            occurrence: the synthetic entry's own start_at/end_at spans
            the entire event, so it trivially satisfies resolveDefault()'s
            "currently happening" check and got selected ahead of the real
            Sep 30 occurrence whenever the event's overall window
            (Sep 29 - Oct 1) was still open. The rail itself already
            excludes the synthetic entry (realOccurrences), but the
            PROVIDER still considered it a selectable candidate — the
            mismatch this pass fixes. The provider now receives
            realOccurrences only, so only a genuine event_occurrences row
            can ever be selected — current -> next -> none, never the
            synthesized range. */}
        {hasOccurrences ? (
          <EventOccurrenceProvider occurrences={realOccurrences}>{scheduleAndDetails}</EventOccurrenceProvider>
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
            {/* Final Mobile Visual Convergence pass — a real linked
                Location now renders as the same compact, visual
                EventLocationCard the top logistics module uses (thumbnail/
                logo, name, address, chevron, link to the real Location
                page) instead of duplicating a plain-text name/address block
                plus a separate "View Location" link. Reuses the shared
                component rather than building parallel Location UI. No
                canonicalLocation (a founder-typed venue with no matching
                FindMi Location) keeps the original plain-text fallback
                exactly as before. */}
            {canonicalLocation ? (
              <div className="mt-3">
                <EventLocationCard location={canonicalLocation} />
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-1 text-sm text-ink/70">
                {event.venue_name && <p className="font-semibold text-ink">{event.venue_name}</p>}
                {(event.address || location) && <p>{[event.address, location].filter(Boolean).join(", ")}</p>}
              </div>
            )}
            {images.venue.length > 0 && (
              <div className="mt-3">
                <ImageGalleryStrip images={images.venue} alt={event.venue_name ?? "Venue"} />
              </div>
            )}
          </section>
        )}

        {/* Event Page Visual Correction pass — "Hosted By" is now a real
            linked Business object card whenever hostBusiness resolved
            (same event_businesses.featured/sole-participant reasoning as
            the hero byline — see that variable's own comment). A plain-
            text organizer_name with no matching Business (e.g. a named
            individual, not a FindMi Business) keeps the original Run By
            text exactly as before — never dropped, never a fabricated
            link. */}
        {hostBusiness ? (
          <section className="mt-8">
            <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Hosted By</p>
            <Link
              href={`/business/${hostBusiness.slug}`}
              className="mt-2 flex items-center gap-3 rounded-xl border border-black/10 bg-white p-3 transition hover:border-findmi/40 hover:bg-findmi-50"
            >
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-black/5">
                {hostBusiness.logo_url ? (
                  <Image src={hostBusiness.logo_url} alt="" fill unoptimized sizes="44px" className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-bold uppercase text-ink/30">
                    {hostBusiness.name.charAt(0)}
                  </div>
                )}
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{hostBusiness.name}</span>
                <span className="text-xs font-semibold text-findmi-700">View Brand ›</span>
              </span>
            </Link>
          </section>
        ) : (
          hasOrganizer && (
            <section className="mt-8">
              <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Run By</p>
              <p className="mt-1 text-base font-semibold text-ink">{event.organizer_name}</p>
            </section>
          )
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
