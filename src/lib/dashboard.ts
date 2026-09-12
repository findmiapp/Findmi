import type { SupabaseClient } from "@supabase/supabase-js";
import { cityState } from "@/lib/format";
import { getUpcomingAppearancesForBusiness, getUpcomingOccurrencesForEvent, eventHasAnyOccurrences } from "@/lib/data";
import { getPendingInvitationsForBusiness } from "@/lib/opportunities";
import { isBusinessPro, isPlanTierPro } from "@/lib/entitlements";
import type { PlanTier } from "@/lib/types";

// Account Command Center V1 — assembles the two new /account sections
// (Needs Your Attention, Coming Up) purely from EXISTING authorized
// queries/tables (getUpcomingAppearancesForBusiness, getUpcomingOccurrencesForEvent,
// eventHasAnyOccurrences, getPendingInvitationsForBusiness, the same
// opportunities/inquiries/entitlement architecture the Business Manager
// already reads) — no schema change, no new table, no RPC. Every read
// here is either already-public data (appearances/occurrences, read via
// the same anon client those two existing lib/data.ts functions already
// use internally) or an admin-client read the caller is responsible for
// gating behind an already-authenticated account/page.tsx session, same
// "authorize first, read after" discipline as every other admin-client
// read on that page (see getProBusinessIdSet there).
//
// Deliberately takes the account's already-fetched managed-entity lists
// as input (businesses/events/locations, exactly the shape account/
// page.tsx already computes as myBusinesses/myEvents/myLocations) rather
// than re-querying business_members/event_members/location_members a
// second time — one fewer redundant round trip per page load.

export interface DashboardBusiness {
  id: string;
  name: string;
  pendingReview: boolean;
}
export interface DashboardEvent {
  id: string;
  name: string;
  isDemo: boolean;
}
export interface DashboardLocation {
  id: string;
  name: string;
  isDemo: boolean;
}

export interface CommandCenterInput {
  businesses: DashboardBusiness[];
  events: DashboardEvent[];
  locations: DashboardLocation[];
  /** Already computed by account/page.tsx (myPendingClaims.length) — passed
   * in rather than re-queried here for the same reason as the managed
   * entity lists above. */
  pendingClaimsCount: number;
}

export interface AttentionItem {
  key: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface ScheduleItem {
  /** Canonical dedup key — see getAccountCommandCenter's own doc comment
   * on precedence. Also used as the React list key. */
  key: string;
  startAt: string;
  endAt: string | null;
  /** Only ever set for an Appearance-sourced item — carries the
   * TIME_UNKNOWN_MARKER convention formatAppearanceTime/
   * formatAppearanceDateRange (lib/format.ts) already knows how to read.
   * Null for every other source, which have no such placeholder-time
   * concept. */
  description: string | null;
  title: string;
  where: string | null;
  /** Every managed entity this SAME real-world happening was found
   * through — e.g. ["Your Event", "Native Rose", "At Minthorne Market"]
   * when a user organizes the Event, owns the participating Business,
   * AND manages the venue. Never collapsed to just one label — see the
   * dedup section below. */
  relatedTo: string[];
  href: string;
}

export interface CommandCenterData {
  attention: AttentionItem[];
  schedule: ScheduleItem[];
}

// A generous per-source over-fetch — the existing functions already
// over-fetch/dedupe internally where relevant (see
// getUpcomingAppearancesForBusiness's own comment); this just makes sure
// a user managing several entities doesn't have one source's items
// starved out of the final chronological top-N by an earlier source's
// own small per-call limit.
const PER_SOURCE_FETCH_LIMIT = 12;
const SCHEDULE_DISPLAY_LIMIT = 8;

async function getNewInquiryCounts(admin: SupabaseClient, businessIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (businessIds.length === 0) return counts;
  const { data } = await admin
    .from("inquiries")
    .select("business_id")
    .in("business_id", businessIds)
    .eq("status", "new");
  for (const row of (data ?? []) as { business_id: string | null }[]) {
    if (!row.business_id) continue;
    counts.set(row.business_id, (counts.get(row.business_id) ?? 0) + 1);
  }
  return counts;
}

interface PlanRow {
  id: string;
  // Matches Business.plan_tier's own shape (lib/types.ts) — optional/
  // undefined, never null, even though the column itself is nullable —
  // same normalization applied below.
  plan_tier?: PlanTier;
  plan_expires_at: string | null;
}
async function getPlanRows(admin: SupabaseClient, businessIds: string[]): Promise<PlanRow[]> {
  if (businessIds.length === 0) return [];
  const { data } = await admin.from("businesses").select("id, plan_tier, plan_expires_at").in("id", businessIds);
  return ((data ?? []) as { id: string; plan_tier: PlanTier | null; plan_expires_at: string | null }[]).map((r) => ({
    id: r.id,
    plan_tier: r.plan_tier ?? undefined,
    plan_expires_at: r.plan_expires_at,
  }));
}

interface FallbackEventRow {
  event_id: string;
  start_at: string;
  end_at: string;
  venue_name: string | null;
  city: string | null;
  state: string | null;
}
/** Legacy/non-recurring managed Events fall back to the event's own
 * start_at/end_at, exactly as every other Findmi surface already does for
 * a zero-occurrence event. `candidateEventIds` is deliberately pre-
 * narrowed by the caller to only events with zero UPCOMING occurrences
 * (from the same Promise.all batch that already fetched
 * getUpcomingOccurrencesForEvent) — this then does exactly one more
 * existence check per CANDIDATE only (eventHasAnyOccurrences, any status/
 * any time, not just upcoming — so an event whose only occurrences are
 * all in the past is never wrongly treated as "non-recurring" and shown
 * via its own possibly-stale start_at/end_at), never for an event that
 * already produced upcoming occurrences and obviously doesn't need this
 * fallback at all. */
async function getFallbackNonRecurringEvents(admin: SupabaseClient, candidateEventIds: string[]): Promise<FallbackEventRow[]> {
  if (candidateEventIds.length === 0) return [];
  const hasOccurrences = await Promise.all(candidateEventIds.map((id) => eventHasAnyOccurrences(id)));
  const targets = candidateEventIds.filter((_, i) => !hasOccurrences[i]);
  if (targets.length === 0) return [];
  const { data } = await admin
    .from("events")
    .select("id, start_at, end_at, venue_name, city, state")
    .in("id", targets)
    .gt("end_at", new Date().toISOString());
  return ((data ?? []) as { id: string; start_at: string; end_at: string; venue_name: string | null; city: string | null; state: string | null }[]).map(
    (r) => ({ event_id: r.id, start_at: r.start_at, end_at: r.end_at, venue_name: r.venue_name, city: r.city, state: r.state })
  );
}

interface LocationOccurrenceRow {
  occurrence_id: string;
  location_id: string;
  start_at: string;
  end_at: string;
  event_name: string;
  event_slug: string;
}
/** Real Events happening at a managed Location, via the canonical
 * event_occurrences.location_id FK only — deliberately NOT reusing
 * getUpcomingAtLocation()'s own legacy venue-name fuzzy-match fallback:
 * that fallback exists for the PUBLIC location page (best-effort display
 * when no real relationship is recorded), but an owner's operational
 * dashboard needs a real canonical event_occurrence id to dedupe safely
 * against the Business/Event sources below (see getAccountCommandCenter's
 * dedup section) — a fuzzy text match has no such id to key on. Same
 * status='scheduled'/non-demo filtering getUpcomingAtLocation itself
 * already applies. */
async function getLocationOccurrences(admin: SupabaseClient, locationIds: string[]): Promise<LocationOccurrenceRow[]> {
  if (locationIds.length === 0) return [];
  const { data } = await admin
    .from("event_occurrences")
    .select("id, location_id, start_at, end_at, event:events(name, slug, is_demo)")
    .in("location_id", locationIds)
    .eq("status", "scheduled")
    .gt("end_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(PER_SOURCE_FETCH_LIMIT * locationIds.length);
  const rows: LocationOccurrenceRow[] = [];
  for (const row of (data ?? []) as { id: string; location_id: string; start_at: string; end_at: string; event: { name: string; slug: string; is_demo: boolean } | { name: string; slug: string; is_demo: boolean }[] | null }[]) {
    const event = Array.isArray(row.event) ? (row.event[0] ?? null) : row.event;
    if (!event || event.is_demo) continue;
    rows.push({ occurrence_id: row.id, location_id: row.location_id, start_at: row.start_at, end_at: row.end_at, event_name: event.name, event_slug: event.slug });
  }
  return rows;
}

interface LocationAppearanceRow {
  appearance_id: string;
  location_id: string;
  start_at: string;
  end_at: string;
  title: string;
  business_slug: string | null;
}
/** Standalone (event_id IS NULL) Appearances at a managed Location, via
 * appearances.location_id — the occurrence-based branch above already
 * covers any Event happening there, so this only ever adds genuinely
 * separate standalone Appearances, never a second copy of the same
 * Event. Same real-FK-only reasoning as getLocationOccurrences above. */
async function getLocationAppearances(admin: SupabaseClient, locationIds: string[]): Promise<LocationAppearanceRow[]> {
  if (locationIds.length === 0) return [];
  const { data } = await admin
    .from("appearances")
    .select("id, location_id, start_at, end_at, title, business:businesses(slug, is_demo)")
    .in("location_id", locationIds)
    .is("event_id", null)
    .neq("status", "canceled")
    .gt("end_at", new Date().toISOString())
    .order("start_at", { ascending: true })
    .limit(PER_SOURCE_FETCH_LIMIT * locationIds.length);
  const rows: LocationAppearanceRow[] = [];
  for (const row of (data ?? []) as { id: string; location_id: string; start_at: string; end_at: string; title: string; business: { slug: string; is_demo: boolean } | { slug: string; is_demo: boolean }[] | null }[]) {
    const business = Array.isArray(row.business) ? (row.business[0] ?? null) : row.business;
    if (business?.is_demo) continue;
    rows.push({ appearance_id: row.id, location_id: row.location_id, start_at: row.start_at, end_at: row.end_at, title: row.title, business_slug: business?.slug ?? null });
  }
  return rows;
}

/**
 * The one data source for both new /account sections.
 *
 * DEDUPLICATION (Coming Up) — precedence, most authoritative first:
 *   1. occurrence:{event_occurrence_id} — an Appearance/Location happening
 *      linked to a real event_occurrences row, OR that occurrence read
 *      directly for a managed Event. This is the strongest available
 *      canonical id (the real occurrence PK).
 *   2. event:{event_id} — an Appearance linked to a genuinely
 *      non-recurring Event (event_id set, event_occurrence_id null), OR
 *      that same non-recurring managed Event read via its own
 *      start_at/end_at fallback. Both branches key identically, so they
 *      collapse into the same one entry rather than needing occurrence
 *      rows to exist first.
 *   3. appearance:{appearance_id} — a standalone Appearance (no Event
 *      relationship at all) — the appearance's own real id.
 * Never keyed on title/name/time text — only real ids already proven,
 * by the existing schema's own foreign keys, to refer to the same row.
 * When two+ sources produce the SAME key (e.g. the user both owns the
 * participating Business AND organizes the Event), the first-seen
 * source's display fields (title/where/href) win — sources are read in
 * priority order (Event occurrences, then Business appearances, then
 * Location happenings) — but every source's relationship label is kept
 * in `relatedTo`, never dropped. An Appearance and an Event occurrence
 * are only ever collapsed when the Appearance's own event_occurrence_id/
 * event_id column actually says so — never merely because they share a
 * time or location.
 */
export async function getAccountCommandCenter(admin: SupabaseClient, input: CommandCenterInput): Promise<CommandCenterData> {
  const { businesses, events, locations, pendingClaimsCount } = input;
  const businessIds = businesses.map((b) => b.id);
  const eventIds = events.map((e) => e.id);
  const locationIds = locations.map((l) => l.id);

  const [
    invitationsByBusiness,
    inquiryCounts,
    planRows,
    appearancesByBusiness,
    occurrencesByEvent,
    locationOccurrences,
    locationAppearances,
  ] = await Promise.all([
    Promise.all(businesses.map((b) => getPendingInvitationsForBusiness(admin, b.id))),
    getNewInquiryCounts(admin, businessIds),
    getPlanRows(admin, businessIds),
    Promise.all(businesses.map((b) => getUpcomingAppearancesForBusiness(b.id, PER_SOURCE_FETCH_LIMIT))),
    Promise.all(events.map((e) => getUpcomingOccurrencesForEvent(e.id, PER_SOURCE_FETCH_LIMIT))),
    getLocationOccurrences(admin, locationIds),
    getLocationAppearances(admin, locationIds),
  ]);

  // Only an event with zero UPCOMING occurrences is even a candidate for
  // the non-recurring fallback below — narrowed here (using the batch
  // above) before that function's own eventHasAnyOccurrences existence
  // check runs, so it's never called for an event that obviously already
  // has upcoming occurrences.
  const eventIdsWithoutUpcomingOccurrences = eventIds.filter((_, i) => occurrencesByEvent[i].length === 0);
  const fallbackEvents = await getFallbackNonRecurringEvents(admin, eventIdsWithoutUpcomingOccurrences);

  // ---- Needs Your Attention ----
  const attention: AttentionItem[] = [];

  businesses.forEach((b, i) => {
    for (const inv of invitationsByBusiness[i]) {
      attention.push({
        key: `invite:${inv.id}`,
        title: `${inv.eventName} invited ${b.name}`,
        subtitle: inv.occurrenceStartAt ? new Date(inv.occurrenceStartAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Review and respond",
        href: `/account/business/${b.id}?tab=opportunities`,
      });
    }
  });

  for (const b of businesses) {
    const count = inquiryCounts.get(b.id) ?? 0;
    if (count > 0) {
      attention.push({
        key: `inquiry:${b.id}`,
        title: `${count} new inquir${count === 1 ? "y" : "ies"} for ${b.name}`,
        subtitle: null,
        href: `/account/business/${b.id}?tab=inquiries`,
      });
    }
  }

  // Pending Review — informational only, never framed as an error/action
  // the member caused. Wording deliberately matches the existing Business
  // Manager Overview banner's own tone ("Your business is saved... it
  // will appear in Findmi discovery after review").
  for (const b of businesses) {
    if (b.pendingReview) {
      attention.push({
        key: `pending_business:${b.id}`,
        title: `${b.name} is awaiting Findmi review`,
        subtitle: "You can keep building your profile in the meantime.",
        href: `/account/business/${b.id}`,
      });
    }
  }
  for (const e of events) {
    if (e.isDemo) {
      attention.push({
        key: `pending_event:${e.id}`,
        title: `${e.name} is awaiting Findmi review`,
        subtitle: null,
        href: `/account/event/${e.id}`,
      });
    }
  }
  for (const l of locations) {
    if (l.isDemo) {
      attention.push({
        key: `pending_location:${l.id}`,
        title: `${l.name} is awaiting Findmi review`,
        subtitle: null,
        href: `/account/location/${l.id}`,
      });
    }
  }

  // Pending Business Claims — summarized + anchored to the existing
  // section below (never duplicated), since a pending claim genuinely
  // has no member action while under review (same "Typically reviewed
  // within 48-72 hours" wording the existing section already uses).
  if (pendingClaimsCount > 0) {
    attention.push({
      key: "pending_claims",
      title: `${pendingClaimsCount} pending claim${pendingClaimsCount === 1 ? "" : "s"} under review`,
      subtitle: "Typically reviewed within 48–72 hours.",
      href: "/account#pending-claims",
    });
  }

  // Pro Expiration — expired only (isBusinessPro is the one authoritative
  // active-entitlement check; there is no reliable "expiring soon"
  // signal to invent one for).
  for (const row of planRows) {
    if (isPlanTierPro(row.plan_tier) && !isBusinessPro(row)) {
      const b = businesses.find((x) => x.id === row.id);
      attention.push({
        key: `pro_expired:${row.id}`,
        title: `Findmi Pro expired for ${b?.name ?? "your business"}`,
        subtitle: "Renew to restore your full profile.",
        href: `/upgrade/pro?business=${row.id}`,
      });
    }
  }

  // ---- Coming Up ----
  const scheduleMap = new Map<string, ScheduleItem>();
  function upsertSchedule(key: string, relatedLabel: string, factory: () => Omit<ScheduleItem, "key" | "relatedTo">) {
    const existing = scheduleMap.get(key);
    if (existing) {
      if (!existing.relatedTo.includes(relatedLabel)) existing.relatedTo.push(relatedLabel);
      return;
    }
    scheduleMap.set(key, { key, relatedTo: [relatedLabel], ...factory() });
  }

  // Priority 1 — organizer's own Events (occurrence-based, then the
  // non-recurring fallback, both keyed so they merge correctly with any
  // matching Appearance found below).
  events.forEach((e, i) => {
    for (const occ of occurrencesByEvent[i]) {
      upsertSchedule(`occurrence:${occ.id}`, "Your Event", () => ({
        startAt: occ.start_at,
        endAt: occ.end_at,
        description: null,
        title: e.name,
        where: occ.location ? [occ.location.name, cityState(occ.location.city, occ.location.state)].filter(Boolean).join(" · ") : null,
        href: `/account/event/${e.id}?tab=dates`,
      }));
    }
  });
  for (const ev of fallbackEvents) {
    const e = events.find((x) => x.id === ev.event_id);
    if (!e) continue;
    upsertSchedule(`event:${ev.event_id}`, "Your Event", () => ({
      startAt: ev.start_at,
      endAt: ev.end_at,
      description: null,
      title: e.name,
      where: [ev.venue_name, cityState(ev.city, ev.state)].filter(Boolean).join(" · ") || null,
      href: `/account/event/${e.id}`,
    }));
  }

  // Priority 2 — Business appearances, keyed by the strongest relationship
  // the appearance's own columns actually record.
  businesses.forEach((b, i) => {
    for (const a of appearancesByBusiness[i]) {
      const key = a.event_occurrence_id ? `occurrence:${a.event_occurrence_id}` : a.event_id ? `event:${a.event_id}` : `appearance:${a.id}`;
      upsertSchedule(key, b.name, () => ({
        startAt: a.start_at,
        endAt: a.end_at,
        description: a.description,
        title: a.title,
        where: [a.venue_name, cityState(a.city, a.state)].filter(Boolean).join(" · ") || null,
        href: `/account/business/${b.id}?tab=findmi-here`,
      }));
    }
  });

  // Priority 3 — happenings at a managed Location the user doesn't
  // otherwise own/organize. Only ever adds a NEW entry when the key
  // wasn't already produced above; otherwise just contributes the "At
  // {location}" relationship label to the existing entry.
  for (const row of locationOccurrences) {
    const loc = locations.find((x) => x.id === row.location_id);
    if (!loc) continue;
    upsertSchedule(`occurrence:${row.occurrence_id}`, `At ${loc.name}`, () => ({
      startAt: row.start_at,
      endAt: row.end_at,
      description: null,
      title: row.event_name,
      where: loc.name,
      href: `/event/${row.event_slug}`,
    }));
  }
  for (const row of locationAppearances) {
    const loc = locations.find((x) => x.id === row.location_id);
    if (!loc) continue;
    upsertSchedule(`appearance:${row.appearance_id}`, `At ${loc.name}`, () => ({
      startAt: row.start_at,
      endAt: row.end_at,
      description: null,
      title: row.title,
      where: loc.name,
      href: row.business_slug ? `/business/${row.business_slug}` : `/account/location/${loc.id}`,
    }));
  }

  const schedule = [...scheduleMap.values()]
    .filter((item) => !item.endAt || new Date(item.endAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, SCHEDULE_DISPLAY_LIMIT);

  return { attention, schedule };
}
