// Consumer Area Picker + Market Requests V1, extended by Market ->
// Area/Submarket Hierarchy V2 — admin read/write helpers for the Market
// Requests queue. Same small dedicated-file shape as
// lib/admin/business-markets.ts. Grouping is done here, in JS, by
// EFFECTIVE normalized key (V2 — see MarketRequest.effective_normalized_key)
// so an admin correction (canonical_text) naturally regroups a request
// with any other request that already normalizes the same way, without a
// separate "merge" operation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "./supabase-admin";
import { findExistingGeographyMatch, type GeographyMatch } from "@/lib/market-requests";
import type { MarketRequest, MarketRequestResolutionType, MarketRequestSource, MarketRequestStatus } from "@/lib/types";

export interface AdminMarketRequestRow extends MarketRequest {
  businessName: string | null;
  eventName: string | null;
  /** Only meaningful for source='consumer' — the number of distinct
   * people (signed-in or by email) who expressed interest in this exact
   * pending row. */
  interestCount: number;
  /** Reopen Request pass — a PENDING row can still carry a stale
   * mapped_market_id/mapped_area_id/resolution_type from a resolution an
   * admin later reopened (see reopenMarketRequestGroup) — a fresh request
   * never has these set while pending, so their presence here always
   * means "previously resolved to this, now back under review," shown so
   * the admin has the exact context that made them reopen it in the first
   * place, never silently discarded. */
  previousMarketLabel: string | null;
  previousAreaLabel: string | null;
}

export interface MarketRequestGroup {
  /** V2 — grouping key, now the EFFECTIVE key (canonical_text ??
   * requested_text, normalized) rather than the original immutable one. */
  effectiveKey: string;
  /** The text shown as this group's current geography — the first
   * canonical_text found among its member requests, else the first
   * requested_text. Distinct from any individual member's own original
   * submission (see AdminMarketRequestRow.requested_text). */
  displayText: string;
  /** True when displayText came from an admin correction rather than a
   * raw submission — used to render "Current geography" vs "Original
   * submission" separately. */
  isCorrected: boolean;
  city: string | null;
  state: string | null;
  requests: AdminMarketRequestRow[];
  consumerInterestCount: number;
  businessCount: number;
  eventCount: number;
  oldestCreatedAt: string;
  /** V2 — a lightweight local suggestion (exact/substring/close-edit-
   * distance only, never geocoding) against existing active Markets/Areas,
   * computed from displayText. Null when nothing plausible was found —
   * admin still has to pick a resolution manually in that case. */
  suggestedMatch: GeographyMatch | null;
}

type NameRow = { name: string; display_name: string | null };
type RequestJoinRow = MarketRequest & {
  businesses: { name: string } | { name: string }[] | null;
  events: { name: string } | { name: string }[] | null;
  markets: NameRow | NameRow[] | null;
  market_areas: (NameRow & { markets: NameRow | NameRow[] | null }) | (NameRow & { markets: NameRow | NameRow[] | null })[] | null;
};

/** All PENDING requests, grouped by EFFECTIVE normalized key — the queue
 * admin actually works from. Approved/mapped/rejected requests aren't
 * shown here (the queue is "things that still need a decision"); the
 * underlying rows are never deleted, so a full history always remains
 * queryable (see getRecentlyResolvedMarketRequests below). */
export async function getPendingMarketRequestGroups(): Promise<MarketRequestGroup[]> {
  const admin = getAdminSupabase();
  if (!admin) return [];

  const { data: requestRows } = await admin
    .from("market_requests")
    .select(
      "*, businesses(name), events(name), markets(name, display_name), market_areas(name, display_name, markets(name, display_name))"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const rows = (requestRows ?? []) as RequestJoinRow[];
  if (rows.length === 0) return [];

  const requestIds = rows.map((r) => r.id);
  const { data: interestRows } = await admin
    .from("market_request_interests")
    .select("request_id")
    .in("request_id", requestIds);
  const interestCounts = new Map<string, number>();
  for (const i of (interestRows ?? []) as { request_id: string }[]) {
    interestCounts.set(i.request_id, (interestCounts.get(i.request_id) ?? 0) + 1);
  }

  const groups = new Map<string, MarketRequestGroup>();
  for (const r of rows) {
    const { businesses, events, markets, market_areas, ...requestFields } = r;
    const business = Array.isArray(businesses) ? businesses[0] : businesses;
    const event = Array.isArray(events) ? events[0] : events;
    const market = Array.isArray(markets) ? markets[0] : markets;
    const areaJoin = Array.isArray(market_areas) ? market_areas[0] : market_areas;
    const areaParentMarket = areaJoin ? (Array.isArray(areaJoin.markets) ? areaJoin.markets[0] : areaJoin.markets) : null;
    const row: AdminMarketRequestRow = {
      ...requestFields,
      businessName: business?.name ?? null,
      eventName: event?.name ?? null,
      interestCount: interestCounts.get(r.id) ?? 0,
      // Reopen Request pass — non-null here means this pending row was
      // previously resolved and then reopened (a fresh request never has
      // mapped_market_id/mapped_area_id set) — see AdminMarketRequestRow's
      // own doc comment.
      previousMarketLabel: market ? market.display_name || market.name : null,
      previousAreaLabel: areaJoin
        ? `${areaJoin.display_name || areaJoin.name}${areaParentMarket ? ` — ${areaParentMarket.display_name || areaParentMarket.name}` : ""}`
        : null,
    };
    const key = r.effective_normalized_key;
    let group = groups.get(key);
    if (!group) {
      group = {
        effectiveKey: key,
        displayText: r.canonical_text || r.requested_text,
        isCorrected: Boolean(r.canonical_text),
        city: r.city,
        state: r.state,
        requests: [],
        consumerInterestCount: 0,
        businessCount: 0,
        eventCount: 0,
        oldestCreatedAt: r.created_at,
        suggestedMatch: null,
      };
      groups.set(key, group);
    } else if (!group.isCorrected && r.canonical_text) {
      // A later-seen row in this group carries an admin correction the
      // first-seen row didn't — prefer it as the group's display text.
      group.displayText = r.canonical_text;
      group.isCorrected = true;
    }
    group.requests.push(row);
    if (row.source === "consumer") group.consumerInterestCount += row.interestCount;
    if (row.source === "business_creation") group.businessCount += 1;
    if (row.source === "event_creation") group.eventCount += 1;
    if (r.created_at < group.oldestCreatedAt) group.oldestCreatedAt = r.created_at;
  }

  const groupList = Array.from(groups.values()).sort((a, b) => a.oldestCreatedAt.localeCompare(b.oldestCreatedAt));

  // Suggestions computed once per group (not per request) against its
  // current displayText — never automatically applied, just surfaced.
  await Promise.all(
    groupList.map(async (g) => {
      g.suggestedMatch = await findExistingGeographyMatch(admin, g.displayText);
    })
  );

  return groupList;
}

export interface AdminMarketAreaOption {
  id: string;
  marketId: string;
  marketName: string;
  name: string;
  displayName: string | null;
  slug: string;
}

/** Every ACTIVE Area, with its parent Market's name attached — the flat
 * "Area — Market" option list for the admin "Map to existing Area" and
 * "Create new Area" (parent picker) forms. Mirrors
 * getAllMarketsForAdmin's own shape/spirit. */
export async function getActiveMarketAreasForAdmin(admin: SupabaseClient): Promise<AdminMarketAreaOption[]> {
  const { data } = await admin
    .from("market_areas")
    .select("id, market_id, name, display_name, slug, markets(name)")
    .eq("active", true)
    .order("sort_order");
  return ((data ?? []) as { id: string; market_id: string; name: string; display_name: string | null; slug: string; markets: { name: string } | { name: string }[] | null }[]).map(
    (a) => {
      const market = Array.isArray(a.markets) ? a.markets[0] : a.markets;
      return {
        id: a.id,
        marketId: a.market_id,
        marketName: market?.name ?? "Unknown Market",
        name: a.name,
        displayName: a.display_name,
        slug: a.slug,
      };
    }
  );
}

export const RESOLUTION_TYPE_LABEL: Record<MarketRequestResolutionType, string> = {
  existing_market: "Existing Market",
  existing_area: "Existing Area",
  new_market: "New Market",
  new_area: "New Area",
};

export interface ResolvedMarketRequestRow {
  id: string;
  requestedText: string;
  canonicalText: string | null;
  status: MarketRequestStatus;
  resolutionType: MarketRequestResolutionType | null;
  source: MarketRequestSource;
  marketLabel: string | null;
  areaLabel: string | null;
  adminNote: string | null;
  reviewedAt: string | null;
}

/** A recent-history strip — the most recently reviewed (non-pending)
 * requests, each showing plainly which of the four resolution paths (or
 * rejection) it went through and, for an Area resolution, both the Area
 * and its parent Market together (never the Area alone). Read-only,
 * admin-facing only — never consulted by discovery/entitlement logic. */
export async function getRecentlyResolvedMarketRequests(limit = 12): Promise<ResolvedMarketRequestRow[]> {
  const admin = getAdminSupabase();
  if (!admin) return [];
  const { data } = await admin
    .from("market_requests")
    .select(
      "id, requested_text, canonical_text, status, resolution_type, source, admin_note, reviewed_at, markets(name, display_name), market_areas(name, display_name, markets(name, display_name))"
    )
    .neq("status", "pending")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  type Row = {
    id: string;
    requested_text: string;
    canonical_text: string | null;
    status: MarketRequestStatus;
    resolution_type: MarketRequestResolutionType | null;
    source: MarketRequestSource;
    admin_note: string | null;
    reviewed_at: string | null;
    markets: { name: string; display_name: string | null } | { name: string; display_name: string | null }[] | null;
    market_areas:
      | {
          name: string;
          display_name: string | null;
          markets: { name: string; display_name: string | null } | { name: string; display_name: string | null }[] | null;
        }
      | {
          name: string;
          display_name: string | null;
          markets: { name: string; display_name: string | null } | { name: string; display_name: string | null }[] | null;
        }[]
      | null;
  };

  return ((data ?? []) as Row[]).map((r) => {
    const market = Array.isArray(r.markets) ? r.markets[0] : r.markets;
    const areaJoin = Array.isArray(r.market_areas) ? r.market_areas[0] : r.market_areas;
    const areaParentMarket = areaJoin ? (Array.isArray(areaJoin.markets) ? areaJoin.markets[0] : areaJoin.markets) : null;
    const areaLabel = areaJoin
      ? `${areaJoin.display_name || areaJoin.name}${areaParentMarket ? ` — ${areaParentMarket.display_name || areaParentMarket.name}` : ""}`
      : null;
    return {
      id: r.id,
      requestedText: r.requested_text,
      canonicalText: r.canonical_text,
      status: r.status,
      resolutionType: r.resolution_type,
      source: r.source,
      marketLabel: market ? market.display_name || market.name : null,
      areaLabel,
      adminNote: r.admin_note,
      reviewedAt: r.reviewed_at,
    };
  });
}

export type MarketRequestSourceFilter = MarketRequestSource;

export interface ResolutionConflict {
  kind: "business" | "event";
  name: string;
}

/** Applies a resolution (an existing OR newly-created Market id, and
 * optionally a market_areas id nested inside it) to every linked
 * business/event across a group of requests being resolved together.
 *
 * NEVER overwrites an existing active Primary Market or a non-null
 * event.market_id (V1 behavior, unchanged) — a business/event that
 * already has one is simply left alone. V2 extends this same
 * conservatism to market_area_id: it is only ever set when the
 * business/event's EFFECTIVE Market (its pre-existing one, or the one
 * just assigned here) actually matches the Market this Area belongs to,
 * and only when it doesn't already carry a different Area. Any mismatch
 * is returned as a conflict for the caller to surface to the admin
 * (never silently dropped, never silently overwritten). */
export async function applyMarketRequestResolution(
  supabase: SupabaseClient,
  requests: { source_business_id: string | null; source_event_id: string | null }[],
  marketId: string,
  areaId?: string | null
): Promise<{ conflicts: ResolutionConflict[] }> {
  const conflicts: ResolutionConflict[] = [];
  for (const r of requests) {
    if (r.source_business_id) {
      const { data: existingPrimary } = await supabase
        .from("business_markets")
        .select("id, market_id")
        .eq("business_id", r.source_business_id)
        .eq("relationship", "primary")
        .eq("active", true)
        .maybeSingle();
      if (!existingPrimary) {
        await supabase.from("business_markets").insert({
          business_id: r.source_business_id,
          market_id: marketId,
          relationship: "primary",
          provenance: "self_selected",
          active: true,
        });
      }
      if (areaId) {
        const effectiveMarketId = existingPrimary ? existingPrimary.market_id : marketId;
        if (effectiveMarketId === marketId) {
          const { data: biz } = await supabase
            .from("businesses")
            .select("id, name, market_area_id")
            .eq("id", r.source_business_id)
            .maybeSingle();
          if (biz && !biz.market_area_id) {
            await supabase.from("businesses").update({ market_area_id: areaId }).eq("id", r.source_business_id);
            // Business Market -> Multi-Area Assignment pass — this branch
            // just confirmed (existingPrimary already active for
            // marketId) or created (the insert a few lines up) an active
            // business_markets primary row for this exact marketId, so
            // the normalized relationship is always valid to write here
            // too. Kept alongside the legacy scalar write above for
            // backward compatibility — see that column's own deprecation
            // note. ignoreDuplicates guards re-running resolution on the
            // same request twice.
            await supabase
              .from("business_market_areas")
              .upsert(
                { business_id: r.source_business_id, market_id: marketId, market_area_id: areaId },
                { onConflict: "business_id,market_id,market_area_id", ignoreDuplicates: true }
              );
          }
        } else {
          const { data: biz } = await supabase.from("businesses").select("name").eq("id", r.source_business_id).maybeSingle();
          conflicts.push({ kind: "business", name: biz?.name ?? r.source_business_id });
        }
      }
    }
    if (r.source_event_id) {
      const { data: ev } = await supabase
        .from("events")
        .select("market_id, market_area_id, name")
        .eq("id", r.source_event_id)
        .maybeSingle();
      const wasNull = ev ? ev.market_id === null : false;
      if (wasNull) {
        await supabase.from("events").update({ market_id: marketId }).eq("id", r.source_event_id);
      }
      if (areaId && ev) {
        const effectiveMarketId = wasNull ? marketId : ev.market_id;
        if (effectiveMarketId === marketId) {
          if (!ev.market_area_id) {
            await supabase.from("events").update({ market_area_id: areaId }).eq("id", r.source_event_id);
          }
        } else {
          conflicts.push({ kind: "event", name: ev.name });
        }
      }
    }
  }
  return { conflicts };
}
