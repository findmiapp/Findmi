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
import { getMarketAreaLabel } from "./data";
import { getTemporalLabel, type TemporalLabel } from "./format";

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
  participationStatus: EventParticipationStatus | null;
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
  hasImage: boolean;
  hasVenue: boolean;
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
  businessGeo: DashboardBusinessGeo
): Promise<ResolvedDashboardAppearances> {
  const managementHref = `/account/business/${businessId}?tab=findmi-here`;

  const eventIds = Array.from(
    new Set(appearances.map((a) => a.event_id).filter((v): v is string => Boolean(v)))
  );
  const { data: eventRows } = eventIds.length
    ? await admin.from("events").select("id, name, slug, is_demo, market_id, market_area_id").in("id", eventIds)
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
    return {
      id: a.id,
      title: a.title,
      startAt: a.start_at,
      endAt: a.end_at,
      venueName: a.venue_name,
      address: a.address,
      city: a.city,
      state: a.state,
      flyerImageUrl: a.flyer_image_url,
      isEventLinked: Boolean(a.event_id),
      eventName: event?.name ?? null,
      eventHref: event && !event.is_demo ? `/event/${event.slug}` : null,
      participationStatus: a.participationStatus,
      statusLabel: a.participationStatus ? EVENT_PARTICIPATION_LABEL[a.participationStatus] : "Confirmed",
      geographyLabel,
      temporal,
      isToday: temporal.live || temporal.label === "TODAY",
      managementHref,
      editHref: `${managementHref}&editing=${a.id}`,
      hasImage: Boolean(a.flyer_image_url),
      hasVenue: Boolean(a.venue_name || a.address),
    };
  });

  return { appearances: resolved, businessGeographyLabel };
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
  message: string;
  actionLabel: string;
  actionHref: string;
}

export interface NeedsAttentionInput {
  businessId: string;
  hasPrimaryMarket: boolean;
  pendingMarketRequestText: string | null;
  upcomingAppearances: DashboardAppearance[];
  unreadInquiryCount: number;
  nativeInquiriesEnabled: boolean;
  newOrderCount: number;
  profileIncomplete: boolean;
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

  if (!input.hasPrimaryMarket) {
    items.push(
      input.pendingMarketRequestText
        ? {
            id: "pending-market",
            message: `Your requested Market "${input.pendingMarketRequestText}" is awaiting review.`,
            actionLabel: "View Market",
            actionHref: `${base}?tab=market`,
          }
        : {
            id: "no-market",
            message: "No FindMi Market is assigned yet — you won't appear in general discovery.",
            actionLabel: "View Market",
            actionHref: `${base}?tab=market`,
          }
    );
  }

  if (input.upcomingAppearances.length === 0) {
    items.push({
      id: "no-appearances",
      message: "You don't have any upcoming appearances yet.",
      actionLabel: "Add Appearance",
      actionHref: `${base}?tab=findmi-here`,
    });
  } else {
    const missingImage = input.upcomingAppearances.find((a) => !a.hasImage);
    if (missingImage) {
      items.push({
        id: `missing-image-${missingImage.id}`,
        message: `"${missingImage.title}" has no flyer image yet.`,
        actionLabel: "Add Image",
        actionHref: missingImage.editHref,
      });
    }
    const missingVenue = input.upcomingAppearances.find((a) => !a.hasVenue);
    if (missingVenue) {
      items.push({
        id: `missing-venue-${missingVenue.id}`,
        message: `"${missingVenue.title}" is missing venue/location details.`,
        actionLabel: "Add Details",
        actionHref: missingVenue.editHref,
      });
    }
  }

  if (input.newOrderCount > 0) {
    items.push({
      id: "new-orders",
      message: `You have ${input.newOrderCount} new order${input.newOrderCount === 1 ? "" : "s"} to review.`,
      actionLabel: "View Orders",
      actionHref: `${base}?tab=orders`,
    });
  }

  if (input.nativeInquiriesEnabled && input.unreadInquiryCount > 0) {
    items.push({
      id: "unread-inquiries",
      message: `You have ${input.unreadInquiryCount} unread inquir${input.unreadInquiryCount === 1 ? "y" : "ies"}.`,
      actionLabel: "View Inquiries",
      actionHref: `${base}?tab=inquiries`,
    });
  }

  if (input.profileIncomplete) {
    items.push({
      id: "incomplete-profile",
      message: "Your profile is missing details that help customers find you.",
      actionLabel: "Complete Profile",
      actionHref: `${base}?tab=profile`,
    });
  }

  return items.slice(0, 5);
}
