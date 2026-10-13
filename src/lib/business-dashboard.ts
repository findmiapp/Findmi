// FindMi Command Center V1 — shared read helpers/view-model for the
// managed-business dashboard (Overview tab of
// src/app/(public)/account/business/[id]/page.tsx). Same authorize-then-
// elevate shape as lib/business-followers.ts/lib/business-orders.ts: every
// export here takes an already-service-role `admin` client, called only
// AFTER that page's own requireBusinessMember(businessId) check.
//
// Core idea: an owner shouldn't have to know whether an upcoming item is a
// standalone Appearance or one linked to a FindMi Event — this file
// resolves both into one flat DashboardAppearance view-model. It does NOT
// change the underlying Event/Appearance relationship (event_id/
// event_occurrence_id stay exactly as they are) — it only reads and
// presents it coherently. Reuses the exact appearance rows the existing
// FindMi Here tab already fetches (see page.tsx) rather than issuing a
// second, parallel appearances query.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventParticipationStatus } from "./types";
import { dedupeAppearances, getMarketAreaLabel, withoutSupersededEventProjections, type DedupableAppearance } from "./data";
import { getTemporalLabel, type TemporalLabel } from "./format";
import { resolveAppearanceDisplayImage } from "./appearance-image";
import { groupAppearancesForPreview } from "./findmi-here";

// A small, deliberate duplicate of page.tsx's own PARTICIPATION_LABEL —
// kept separate rather than importing from that page file (Next.js page
// modules aren't meant to be import sources for other modules) and left
// unmerged into a single source of truth to avoid touching the already-
// working FindMi Here tab in this pass. Values must stay identical.
export const EVENT_PARTICIPATION_LABEL: Record<EventParticipationStatus, string> = {
  invited: "Invited",
  applied: "Pending",
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

/** The shape page.tsx's existing FindMi Here appearances query already
 * produces (id/title/start_at/end_at/venue/event link/participation
 * status) — this file resolves that into a DashboardAppearance, it never
 * re-fetches the base appearance rows itself. */
export interface DashboardAppearanceSource {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  flyer_image_url: string | null;
  event_id: string | null;
  event_occurrence_id: string | null;
  /** The appearance's authoritative linked Location (occurrence-level
   * projections copy event_occurrences.location_id). Preferred over the
   * venue text and any Market/Area fallback for the place label. */
  location?: { name: string } | null;
  participationStatus: EventParticipationStatus | null;
}

// Canonical Activity Normalization pass — withoutSupersededEventProjections
// moved to lib/data.ts (imported above) so the public Findmi Here feed
// (getBusinessFindmiHereActivity) applies the exact same suppression rule
// as this file's own canonicalOwnerAppearances, rather than two
// independently-maintained copies. Re-exported here unchanged so every
// existing caller of THIS module keeps working without an import-path
// change.
export { withoutSupersededEventProjections };

/** The canonical owner-facing appearance list: superseded Event-level
 * projections dropped, then the same per-date dedupe the public pages use
 * (one row per real-world date — an official row beats a manual or
 * self-added one for the same occurrence). Display only; records untouched. */
export function canonicalOwnerAppearances<T extends DedupableAppearance>(
  rows: T[],
  eventIdsWithOccurrenceProjections: Set<string>
): T[] {
  return dedupeAppearances(withoutSupersededEventProjections(rows, eventIdsWithOccurrenceProjections));
}

export interface DashboardAppearance {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  venueName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  flyerImageUrl: string | null;
  isEventLinked: boolean;
  eventId: string | null;
  eventName: string | null;
  /** /event/[slug] — null for a standalone appearance, or a demo event
   * (never linked to a real public page). */
  eventHref: string | null;
  participationStatus: EventParticipationStatus | null;
  /** Owner-facing status label — the event roster's own participation
   * status (Invited/Pending/Approved/Declined) when linked, else
   * "Confirmed" (the only status an owner-created Appearance can carry —
   * see AppearanceFieldsForm, which has no status field of its own). */
  statusLabel: string;
  /** "Area · Market", "Market" alone, a plain "City, State" fallback, or
   * null when nothing at all is known — never a raw "null"/"not
   * assigned" string. */
  geographyLabel: string | null;
  temporal: TemporalLabel;
  /** True when this belongs in "Today" — either genuinely live right now
   * (temporal.live) or simply starting today (covers an appearance later
   * today that hasn't started yet). */
  isToday: boolean;
  /** Owner appearance management lives entirely inside the FindMi Here
   * tab (there is no standalone per-appearance route) — every dashboard
   * card and Quick Action links back here. */
  managementHref: string;
  /** Deep-links straight into this one appearance's inline edit form via
   * the existing `editing=<id>` query param the FindMi Here tab already
   * reads (see page.tsx). */
  editHref: string;
  /** The activity has an image of its OWN — its flyer, or its linked
   * Event's cover (what the public Findmi Here card shows first). A flyer
   * is never separately required: public surfaces fall back flyer → Event
   * cover → Business gallery → Business cover, so an Event-linked activity
   * with a cover is fully illustrated without one. */
  hasImage: boolean;
  /** The image every public Appearance surface would show for this
   * activity (resolveAppearanceDisplayImage), then the Business logo;
   * null only when the Business has no imagery at all. */
  displayImageUrl: string | null;
  hasVenue: boolean;
}

/** The Business's own imagery, for the canonical display-image fallback. */
export interface DashboardBusinessImages {
  galleryImages: string[];
  coverUrl: string | null;
  logoUrl: string | null;
}

export interface DashboardBusinessGeo {
  primaryMarketId: string | null;
  marketAreaId: string | null;
}

type EventGeoRow = {
  id: string;
  name: string;
  slug: string;
  is_demo: boolean;
  cover_image_url: string | null;
  market_id: string | null;
  market_area_id: string | null;
};
type LabelRow = { id: string; name: string; display_name: string | null };

export interface ResolvedDashboardAppearances {
  appearances: DashboardAppearance[];
  /** This business's OWN "Area · Market" label (its primary Market +
   * market_area_id) — used by the dashboard header regardless of whether
   * there are any appearances at all. */
  businessGeographyLabel: string | null;
}

/** Resolves standalone-vs-Event-linked appearances into one flat view-
 * model, and separately resolves the business's own geography label for
 * the header. An event-linked appearance's Market/Area comes from its
 * PARENT event's own market_id/market_area_id directly — this does not
 * walk the fuller occurrence-override precedence chain
 * (resolveEffectiveEventMarket in lib/event-markets.ts), a deliberate,
 * disclosed simplification for this dashboard-only display (consistent
 * with market_area_id itself having no per-occurrence override — see
 * Market -> Area/Submarket Hierarchy V2). A standalone appearance, or an
 * event-linked one whose own event has no Market/Area set, falls back to
 * the business's own Market/Area, then to the appearance's own city/state
 * text, before finally showing nothing rather than an ugly placeholder. */
export async function resolveDashboardAppearances(
  admin: SupabaseClient,
  businessId: string,
  appearances: DashboardAppearanceSource[],
  businessGeo: DashboardBusinessGeo,
  businessImages: DashboardBusinessImages = { galleryImages: [], coverUrl: null, logoUrl: null }
): Promise<ResolvedDashboardAppearances> {
  const managementHref = `/account/business/${businessId}?tab=findmi-here`;

  const eventIds = Array.from(
    new Set(appearances.map((a) => a.event_id).filter((v): v is string => Boolean(v)))
  );
  const { data: eventRows } = eventIds.length
    ? await admin.from("events").select("id, name, slug, is_demo, cover_image_url, market_id, market_area_id").in("id", eventIds)
    : { data: [] as EventGeoRow[] };
  const eventById = new Map(((eventRows ?? []) as EventGeoRow[]).map((e) => [e.id, e]));

  const marketIds = new Set<string>();
  const areaIds = new Set<string>();
  if (businessGeo.primaryMarketId) marketIds.add(businessGeo.primaryMarketId);
  if (businessGeo.marketAreaId) areaIds.add(businessGeo.marketAreaId);
  for (const e of eventById.values()) {
    if (e.market_id) marketIds.add(e.market_id);
    if (e.market_area_id) areaIds.add(e.market_area_id);
  }

  const [{ data: marketRows }, { data: areaRows }] = await Promise.all([
    marketIds.size
      ? admin.from("markets").select("id, name, display_name").in("id", Array.from(marketIds))
      : Promise.resolve({ data: [] as LabelRow[] }),
    areaIds.size
      ? admin.from("market_areas").select("id, name, display_name").in("id", Array.from(areaIds))
      : Promise.resolve({ data: [] as LabelRow[] }),
  ]);
  const marketLabelById = new Map(((marketRows ?? []) as LabelRow[]).map((m) => [m.id, getMarketAreaLabel(m)]));
  const areaLabelById = new Map(((areaRows ?? []) as LabelRow[]).map((a) => [a.id, a.display_name || a.name]));

  function geoLabelFor(marketId: string | null, areaId: string | null): string | null {
    const marketLabel = marketId ? (marketLabelById.get(marketId) ?? null) : null;
    const areaLabel = areaId ? (areaLabelById.get(areaId) ?? null) : null;
    if (areaLabel && marketLabel) return `${areaLabel} · ${marketLabel}`;
    return marketLabel;
  }

  const businessGeographyLabel = geoLabelFor(businessGeo.primaryMarketId, businessGeo.marketAreaId);

  const resolved: DashboardAppearance[] = appearances.map((a) => {
    const event = a.event_id ? (eventById.get(a.event_id) ?? null) : null;
    const eventGeoLabel = event ? geoLabelFor(event.market_id, event.market_area_id) : null;
    const cityStateLabel = [a.city, a.state].filter(Boolean).join(", ") || null;
    const geographyLabel = eventGeoLabel ?? businessGeographyLabel ?? cityStateLabel;
    const temporal = getTemporalLabel(a.start_at, a.end_at);
    const specificImageUrl = a.flyer_image_url ?? (event && !event.is_demo ? event.cover_image_url : null);
    return {
      id: a.id,
      title: a.title,
      startAt: a.start_at,
      endAt: a.end_at,
      venueName: a.location?.name ?? a.venue_name,
      address: a.address,
      city: a.city,
      state: a.state,
      flyerImageUrl: a.flyer_image_url,
      isEventLinked: Boolean(a.event_id),
      eventId: a.event_id,
      eventName: event?.name ?? null,
      eventHref: event && !event.is_demo ? `/event/${event.slug}` : null,
      participationStatus: a.participationStatus,
      statusLabel: a.participationStatus ? EVENT_PARTICIPATION_LABEL[a.participationStatus] : "Confirmed",
      geographyLabel,
      temporal,
      isToday: temporal.live || temporal.label === "TODAY",
      managementHref,
      editHref: `${managementHref}&editing=${a.id}`,
      hasImage: Boolean(specificImageUrl),
      displayImageUrl:
        resolveAppearanceDisplayImage({
          appearanceId: a.id,
          specificImageUrl,
          galleryImages: businessImages.galleryImages,
          businessCoverUrl: businessImages.coverUrl,
        }) ?? businessImages.logoUrl,
      hasVenue: Boolean(a.venue_name || a.address),
    };
  });

  return { appearances: resolved, businessGeographyLabel };
}

/** Account Home — an operational SUMMARY, not a date dump. PRESENTATION
 * grouping only (lib/findmi-here.ts groupAppearancesForPreview): a
 * multi-date Event's dated Appearances render as ONE row (its next date +
 * "+ N More Dates"); standalone Appearances stay separate. Every date is
 * still its own Appearance — nothing here changes what is counted. */
export interface HomeActivityItem {
  appearance: DashboardAppearance;
  /** Further upcoming dated Appearances of the same Event after `appearance`. */
  moreDates: number;
}

function groupDashboard(appearances: DashboardAppearance[]) {
  return groupAppearancesForPreview(
    appearances.map((a) => ({ id: a.id, event_id: a.eventId, start_at: a.startAt, end_at: a.endAt, a }))
  );
}

/** Splits the canonical, start-ordered dashboard list into Happening Now
 * (one live card per Event / standalone Appearance) and Coming Up (one row
 * per Event / standalone Appearance, at its next not-yet-live date).
 * `upcomingDateCounts` — from countUpcomingDatesPerPreviewGroup over the
 * Business's FULL schedule —
 * keeps "N more dates" truthful when the loaded list is paged; without it
 * the loaded rows are counted. */
export function buildHomeActivities(
  appearances: DashboardAppearance[],
  upcomingDateCounts?: Map<string, number>
): { live: DashboardAppearance[]; comingUp: HomeActivityItem[] } {
  const live = groupDashboard(appearances.filter((a) => a.temporal.live)).map((g) => g.representative.a);
  const comingUp = groupDashboard(appearances.filter((a) => !a.temporal.live)).map((g) => ({
    appearance: g.dates[0].a,
    moreDates: Math.max(0, (upcomingDateCounts?.get(g.key) ?? g.dates.length) - 1),
  }));
  return { live, comingUp };
}

/** B2 — an upcoming Event this Business HOSTS (events.host_business_id),
 * summarized at its next not-yet-ended date (an Occurrence when the Event
 * has dates, else the Event's own window). Read-side only. */
export interface HostedEventSummary {
  eventId: string;
  name: string;
  /** Every not-yet-ended, non-cancelled date (its Occurrences, else the
   * Event's own window), soonest first. */
  dates: { startAt: string; endAt: string | null }[];
  where: string | null;
  /** "In Review" / "Needs Changes" for a not-yet-public Event, else null. */
  statusLabel: string | null;
  imageUrl: string | null;
  /** The one Event Manager, with this Business as context. */
  href: string;
}

/** One Coming Up / Happening Now item on Business Home — either the
 * Business's own Appearance (one per Event / standalone Appearance, from
 * buildHomeActivities) or an Event it hosts. Presentation only: no
 * Appearance is ever created for a hosted Event. */
export interface HomeActivity {
  /** "event:<eventId>" whenever the activity belongs to an Event (both
   * kinds), "appearance:<id>" for a standalone Appearance. */
  key: string;
  kind: "appearance" | "hosted_event";
  title: string;
  startAt: string;
  endAt: string | null;
  place: string | null;
  href: string;
  imageUrl: string | null;
  temporal: TemporalLabel;
  moreDates: number;
  /** Amber chip: a not-yet-approved participation or a not-yet-public hosted Event. */
  pendingLabel: string | null;
}

function appearanceActivity(a: DashboardAppearance, moreDates: number): HomeActivity {
  return {
    key: a.eventId ? `event:${a.eventId}` : `appearance:${a.id}`,
    kind: "appearance",
    title: a.title,
    startAt: a.startAt,
    endAt: a.endAt,
    place: a.venueName ?? a.geographyLabel ?? ([a.city, a.state].filter(Boolean).join(", ") || null),
    href: a.managementHref,
    imageUrl: a.displayImageUrl,
    temporal: a.temporal,
    moreDates,
    pendingLabel: a.participationStatus && a.participationStatus !== "approved" ? a.statusLabel : null,
  };
}

/** B2 — Business Home's Coming Up: the Business's actual upcoming Findmi
 * activity, Appearances AND hosted Events.
 *
 * Deduplication is by canonical Event id, never by title: an Event this
 * Business hosts is ONE item (the hosted Event, at its next date with
 * "+ N More Dates"), so any Appearance of this Business linked to that same
 * Event (event-level or per-Occurrence, official or manual) is folded into
 * it rather than listed beside it. Appearances of other Events and
 * standalone Appearances are untouched (one row per Event / standalone, via
 * buildHomeActivities).
 *
 * Happening Now: every live item (live = now within start..end), first.
 * Coming Up: everything not live, chronological, capped at `limit` — a
 * hosted Event that is live now still lists its NEXT date here, exactly as
 * a live Appearance group does. */
export function buildHomeComingUp(
  appearances: DashboardAppearance[],
  hosted: HostedEventSummary[],
  upcomingDateCounts?: Map<string, number>,
  limit = 4
): { live: HomeActivity[]; comingUp: HomeActivity[]; total: number } {
  const hostedIds = new Set(hosted.map((h) => h.eventId));
  const own = buildHomeActivities(
    appearances.filter((a) => !(a.eventId && hostedIds.has(a.eventId))),
    upcomingDateCounts
  );
  const live: HomeActivity[] = own.live.map((a) => appearanceActivity(a, 0));
  const upcoming: HomeActivity[] = own.comingUp.map((i) => appearanceActivity(i.appearance, i.moreDates));
  for (const h of hosted) {
    const item = (date: { startAt: string; endAt: string | null }, moreDates: number): HomeActivity => ({
      key: `event:${h.eventId}`,
      kind: "hosted_event",
      title: h.name,
      startAt: date.startAt,
      endAt: date.endAt,
      place: h.where,
      href: h.href,
      imageUrl: h.imageUrl,
      temporal: getTemporalLabel(date.startAt, date.endAt),
      moreDates,
      pendingLabel: h.statusLabel,
    });
    const liveDate = h.dates.find((d) => getTemporalLabel(d.startAt, d.endAt).live);
    if (liveDate) live.push(item(liveDate, 0));
    const later = h.dates.filter((d) => d !== liveDate && Date.parse(d.startAt) > Date.now());
    if (later.length > 0) upcoming.push(item(later[0], later.length - 1));
  }
  const byStart = (a: HomeActivity, b: HomeActivity) => Date.parse(a.startAt) - Date.parse(b.startAt);
  live.sort(byStart);
  upcoming.sort(byStart);
  return { live, comingUp: upcoming.slice(0, limit), total: upcoming.length };
}

/** Not-yet-live upcoming dated Appearances per presentation group (Event
 * or standalone), over the Business's complete (unpaged) row set, after the
 * same canonical normalization the dashboard list gets
 * (canonicalOwnerAppearances). Feeds only the "+ N More Dates" label. */
export function countUpcomingDatesPerPreviewGroup<
  T extends DedupableAppearance & { end_at: string | null; event_occurrence_id: string | null; source: string | null },
>(rows: T[], eventIdsWithOccurrenceProjections: Set<string>, now: number = Date.now()): Map<string, number> {
  const pending = rows
    .filter((r) => new Date(r.start_at).getTime() > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const counts = new Map<string, number>();
  for (const g of groupAppearancesForPreview(canonicalOwnerAppearances(pending, eventIdsWithOccurrenceProjections), now)) {
    counts.set(g.key, g.dates.length);
  }
  return counts;
}

/** Appearances that ended earlier THIS calendar month (server-local time —
 * matches this file's other plain-Date arithmetic; not the APP_TIMEZONE-
 * aware machinery in lib/format.ts, which would be more precision than a
 * single monthly rollup tile needs). Used only for the Performance
 * Snapshot's "Completed This Month" tile. */
export async function getCompletedAppearancesThisMonthCount(
  admin: SupabaseClient,
  businessId: string
): Promise<number> {
  const now = new Date();
  const startOfMonthIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count } = await admin
    .from("appearances")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .neq("status", "canceled")
    .gte("end_at", startOfMonthIso)
    .lt("end_at", now.toISOString());
  return count ?? 0;
}

export interface NeedsAttentionItem {
  id: string;
  /** WHAT needs attention, as a short title (Final Command Center UX pass). */
  title: string;
  /** WHY it matters / what exactly is missing — one sentence. */
  message: string;
  actionLabel: string;
  actionHref: string;
}

export interface NeedsAttentionInput {
  businessId: string;
  hasPrimaryMarket: boolean;
  pendingMarketRequestText: string | null;
  upcomingAppearances: DashboardAppearance[];
  newOrderCount: number;
  profileIncomplete: boolean;
  /** Which of profileIncomplete's own signals are missing (optional detail). */
  missingProfile?: { logo: boolean; description: boolean; category: boolean };
}

/** Every item here is derived from data the page already fetches — no new
 * generalized tasks/checklist engine, no fabricated alerts. Capped to 5,
 * roughly most-blocking-first; an item simply isn't produced once its
 * underlying condition resolves (nothing to dismiss/snooze). */
export function buildNeedsAttentionItems(input: NeedsAttentionInput): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = [];
  const base = `/account/business/${input.businessId}`;

  // Pending-review is deliberately NOT duplicated here — the Overview
  // tab already shows its own prominent "Pending Review" banner (with a
  // Preview Your Page link) above this section; a second, smaller
  // mention of the same thing in this list would just be noise.

  // B1 — a Business without geography is valid (VCL A2b), so having no
  // Findmi Market is never an attention item on its own, and never claims
  // the Business is hidden from discovery. Only the owner's
  // own pending Market Request is surfaced.
  if (!input.hasPrimaryMarket && input.pendingMarketRequestText) {
    items.push({
      id: "pending-market",
      title: "Findmi Area Requested",
      message: `Your requested area "${input.pendingMarketRequestText}" is awaiting review.`,
      actionLabel: "View Request",
      actionHref: `${base}?tab=market`,
    });
  }

  // Opportunities V2 — an empty schedule is NOT an attention item ("Nothing
  // happening yet." was informational, not actionable, and made Needs
  // Attention render on every new Business). Home's Coming Up section
  // already says so in its own empty state.
  if (input.upcomingAppearances.length > 0) {
    const missingImage = input.upcomingAppearances.find((a) => !a.hasImage);
    if (missingImage) {
      items.push({
        id: `missing-image-${missingImage.id}`,
        title: "Add an Image",
        message: `"${missingImage.title}" has no flyer image yet. An image helps it stand out on Findmi Here.`,
        actionLabel: "Add Image",
        actionHref: missingImage.editHref,
      });
    }
    const missingVenue = input.upcomingAppearances.find((a) => !a.hasVenue);
    if (missingVenue) {
      items.push({
        id: `missing-venue-${missingVenue.id}`,
        title: "Add Where It Is",
        message: `"${missingVenue.title}" is missing venue/location details, so people can’t tell where to find you.`,
        actionLabel: "Add Details",
        actionHref: missingVenue.editHref,
      });
    }
  }

  if (input.newOrderCount > 0) {
    items.push({
      id: "new-orders",
      title: input.newOrderCount === 1 ? "New Order" : "New Orders",
      message: `You have ${input.newOrderCount} new order${input.newOrderCount === 1 ? "" : "s"} to review.`,
      actionLabel: "View Orders",
      actionHref: `${base}?tab=orders`,
    });
  }

  // Unified Inbox V3 — the "You have N unread inquiries" item that used
  // to live here is REMOVED: it read unreadInquiryCount from the legacy
  // `inquiries` table (lib/inquiries.ts), which has had zero live rows
  // since the canonical Conversations system took over every inquiry
  // entry point (see the Unified Inbox V3 audit) and whose count was
  // therefore always 0 here — a permanently inert attention item. Real
  // customer-conversation visibility already lives entirely in the
  // Inbox preview/page (see account/page.tsx and account/messages/
  // page.tsx); the canonical system has no unread state, and none is
  // being added here to replace this.

  if (input.profileIncomplete) {
    // The same three signals profileIncomplete is computed from (logo,
    // description, category) — the first one missing says exactly what to
    // add and why. No new requirement: geography is never one of them.
    const missing = input.missingProfile;
    const specific = missing?.logo
      ? { message: "Add a logo so people can recognize your Business across Findmi.", actionLabel: "Add Logo" }
      : missing?.description
        ? { message: "Add a description so people know what your Business does.", actionLabel: "Add Description" }
        : missing?.category
          ? { message: "Choose a category so people can find your Business when they browse.", actionLabel: "Choose Category" }
          : null;
    items.push({
      id: "incomplete-profile",
      title: "Complete Your Profile",
      message: specific?.message ?? "Your profile is missing details that help customers find you.",
      actionLabel: specific?.actionLabel ?? "Complete Profile",
      actionHref: `${base}?tab=profile`,
    });
  }

  return items.slice(0, 5);
}
