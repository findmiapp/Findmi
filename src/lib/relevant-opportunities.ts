import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPPORTUNITY_TYPE_LABELS, getBusinessVisibility, isExplorable, type ListingStatus, type OpportunityType, type RecipientStatus } from "./opportunity-listings-domain";
import { isGoalInterest, type GoalInterest } from "./opportunity-goals-domain";
import { contextReasons, geographyReason, type ListingGeography, type RelevanceScope } from "./relevant-opportunities-domain";
import { areaWithDescendants } from "./geography-scope";

/** Relevant commercial Opportunities — ONE reader for every lens (a place's
 * relationship workspace, a Market / Area, later the Map and Next).
 *
 * Source: opportunity_listings only (never public.opportunities). A Business
 * sees exactly what the existing rules already allow — Opportunities sent to it
 * that are still active for it (getBusinessVisibility), plus open, discoverable
 * listings (isExplorable). Nothing private to another Business, no drafts, no
 * internal notes. Service-role client; the caller has already authorized the
 * session for THIS Business. Bounded reads; relevance is deterministic. */

export interface RelevantOpportunity {
  listingId: string;
  title: string;
  type: OpportunityType;
  typeLabel: string;
  placeName: string | null;
  startsAt: string | null;
  responseDeadline: string | null;
  /** Path under the Business Manager: the Business's own Opportunity, or the Explore listing. */
  path: string;
  reasons: string[];
}

export interface OpportunityCandidate {
  listingId: string;
  title: string;
  type: OpportunityType;
  placeName: string | null;
  startsAt: string | null;
  responseDeadline: string | null;
  geo: ListingGeography;
  recipientId: string | null;
  /** The Event it is for, when it names one (exact-Event relevance). */
  eventId: string | null;
}

export interface GrowthContext {
  priorityMarketIds: Set<string>;
  priorityAreaIds: Set<string>;
  interests: Set<GoalInterest>;
}

const RECIPIENT_LIMIT = 200;
const EXPLORE_LIMIT = 100;

type Loc = { id: string; name: string; market_id: string | null; market_area_id: string | null };
type Named = { name: string; display_name?: string | null };
type ListingRow = {
  id: string;
  status: ListingStatus;
  opportunity_type: OpportunityType;
  title: string;
  location_id: string | null;
  event_id?: string | null;
  starts_at: string | null;
  response_deadline: string | null;
  visibility?: string | null;
  market_id?: string | null;
  market_area_id?: string | null;
  location: Loc | Loc[] | null;
  market?: Named | Named[] | null;
  area?: Named | Named[] | null;
};
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** `geo` adds the Block B geography columns; before that migration the reader
 * falls back to Location-only geography (nothing breaks). */
const listingColumns = (geo: boolean) =>
  `id, status, opportunity_type, title, location_id, event_id, starts_at, response_deadline${geo ? ", market_id, market_area_id, market:markets(name), area:market_areas(name, display_name)" : ""}, location:locations(id, name, market_id, market_area_id)`;

const missingGeo = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42703" || e.code === "PGRST200" || /market_area_id|market_id|relationship/.test(e.message ?? "")));

function toCandidate(row: ListingRow, recipientId: string | null): OpportunityCandidate {
  const loc = one(row.location);
  const area = one(row.area);
  const market = one(row.market);
  const geo: ListingGeography = loc
    ? { locationId: loc.id, marketId: loc.market_id, areaId: loc.market_area_id, areaName: null, marketName: null }
    : { locationId: null, marketId: row.market_id ?? null, areaId: row.market_area_id ?? null, areaName: area ? area.display_name?.trim() || area.name : null, marketName: market?.name ?? null };
  return { listingId: row.id, title: row.title, type: row.opportunity_type, placeName: loc?.name ?? null, startsAt: row.starts_at, responseDeadline: row.response_deadline, geo, recipientId, eventId: row.event_id ?? null };
}

/** Every Opportunity this Business may see right now, with its geography. */
export async function getOpportunityCandidates(admin: SupabaseClient, businessId: string, now = new Date()): Promise<OpportunityCandidate[]> {
  const read = (geo: boolean) =>
    Promise.all([
      admin
        .from("opportunity_recipients")
        .select(`id, listing_id, status, listing:opportunity_listings!inner(${listingColumns(geo)})`)
        .eq("business_id", businessId)
        .neq("status", "withdrawn")
        .neq("listing.status", "draft")
        .order("offered_at", { ascending: false })
        .limit(RECIPIENT_LIMIT),
      admin.from("opportunity_listings").select(`${listingColumns(geo)}, visibility`).eq("visibility", "discoverable").eq("status", "open").order("created_at", { ascending: false }).limit(EXPLORE_LIMIT),
    ]);
  let [sent, open] = await read(true);
  if (missingGeo(sent.error) || missingGeo(open.error)) [sent, open] = await read(false);
  if (sent.error || open.error) return [];

  const byId = new Map<string, OpportunityCandidate>();
  for (const r of (sent.data ?? []) as unknown as { id: string; status: RecipientStatus; listing: ListingRow | ListingRow[] | null }[]) {
    const listing = one(r.listing);
    if (!listing || getBusinessVisibility(listing.status, r.status) !== "active") continue;
    byId.set(listing.id, toCandidate(listing, r.id));
  }
  for (const listing of (open.data ?? []) as unknown as ListingRow[]) {
    if (byId.has(listing.id)) continue;
    if (!isExplorable({ visibility: listing.visibility ?? null, status: listing.status, response_deadline: listing.response_deadline }, now)) continue;
    byId.set(listing.id, toCandidate(listing, null));
  }
  return [...byId.values()];
}

/** What the Business told Findmi: priority Markets / Areas (Growth Setup, plus
 * active Opportunity goals for compatibility) and Opportunity interests. Areas
 * include their descendants. */
export async function getGrowthContext(admin: SupabaseClient, businessId: string): Promise<GrowthContext> {
  const [audit, goals] = await Promise.all([
    admin.from("brand_audit_markets").select("market_id, market_area_id").eq("business_id", businessId).eq("intent", "priority"),
    admin.from("business_opportunity_goals").select("market_ids, opportunity_interests").eq("business_id", businessId).eq("status", "active"),
  ]);
  const priorityMarketIds = new Set<string>();
  const declaredAreas = new Set<string>();
  for (const r of (audit.data ?? []) as { market_id: string | null; market_area_id: string | null }[]) {
    if (r.market_area_id) declaredAreas.add(r.market_area_id);
    else if (r.market_id) priorityMarketIds.add(r.market_id);
  }
  const interests = new Set<GoalInterest>();
  for (const g of (goals.data ?? []) as { market_ids: string[] | null; opportunity_interests: string[] | null }[]) {
    for (const id of g.market_ids ?? []) priorityMarketIds.add(id);
    for (const i of g.opportunity_interests ?? []) if (isGoalInterest(i)) interests.add(i);
  }
  const priorityAreaIds = new Set<string>();
  if (declaredAreas.size > 0) {
    const { data } = await admin.from("market_areas").select("id, parent_area_id").eq("active", true);
    const areas = (data ?? []) as { id: string; parent_area_id: string | null }[];
    for (const id of declaredAreas) for (const a of areaWithDescendants(id, areas)) priorityAreaIds.add(a);
  }
  return { priorityMarketIds, priorityAreaIds, interests };
}

/** The relevant subset for one scope: geography first, then the extra reasons.
 * Sent-to-you first, then soonest deadline / start. */
export function selectRelevantOpportunities(businessId: string, candidates: readonly OpportunityCandidate[], scope: RelevanceScope, ctx: GrowthContext, limit = 20): RelevantOpportunity[] {
  const base = `/account/business/${businessId}`;
  const out: (RelevantOpportunity & { sent: boolean })[] = [];
  for (const c of candidates) {
    const where = geographyReason(c.geo, scope);
    if (!where) continue;
    const sent = Boolean(c.recipientId);
    out.push({
      listingId: c.listingId,
      title: c.title,
      type: c.type,
      typeLabel: OPPORTUNITY_TYPE_LABELS[c.type],
      placeName: c.placeName,
      startsAt: c.startsAt,
      responseDeadline: c.responseDeadline,
      path: c.recipientId ? `${base}/opportunities/${c.recipientId}` : `${base}/opportunities/explore/${c.listingId}`,
      reasons: [where, ...contextReasons({ type: c.type, geo: c.geo, sentToYou: sent }, ctx)],
      sent,
    });
  }
  const t = (v: string | null) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  out.sort((a, b) => Number(b.sent) - Number(a.sent) || t(a.responseDeadline) - t(b.responseDeadline) || t(a.startsAt) - t(b.startsAt) || a.title.localeCompare(b.title));
  return out.slice(0, limit).map((r) => ({ listingId: r.listingId, title: r.title, type: r.type, typeLabel: r.typeLabel, placeName: r.placeName, startsAt: r.startsAt, responseDeadline: r.responseDeadline, path: r.path, reasons: r.reasons }));
}
