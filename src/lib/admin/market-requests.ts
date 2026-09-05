// Consumer Area Picker + Market Requests V1 — admin read/write helpers
// for the Market Requests queue. Same small dedicated-file shape as
// lib/admin/business-markets.ts. Grouping is done here, in JS, by
// normalized_key — the smallest implementation that still lets admin see
// aggregate demand ("Austin, TX — Consumers: 18, Businesses: 4, Events: 2")
// without a separate SQL view/materialized aggregation.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "./supabase-admin";
import type { MarketRequest, MarketRequestSource } from "@/lib/types";

export interface AdminMarketRequestRow extends MarketRequest {
  businessName: string | null;
  eventName: string | null;
  /** Only meaningful for source='consumer' — the number of distinct
   * people (signed-in or by email) who expressed interest in this exact
   * pending row. */
  interestCount: number;
}

export interface MarketRequestGroup {
  normalizedKey: string;
  requestedText: string;
  city: string | null;
  state: string | null;
  requests: AdminMarketRequestRow[];
  consumerInterestCount: number;
  businessCount: number;
  eventCount: number;
  oldestCreatedAt: string;
}

type RequestJoinRow = MarketRequest & {
  businesses: { name: string } | { name: string }[] | null;
  events: { name: string } | { name: string }[] | null;
};

/** All PENDING requests, grouped by normalized_key — the queue admin
 * actually works from. Approved/mapped/rejected requests aren't shown
 * here (V1 keeps the queue to "things that still need a decision"); the
 * underlying rows are never deleted, so a full history always remains
 * queryable directly if ever needed. */
export async function getPendingMarketRequestGroups(): Promise<MarketRequestGroup[]> {
  const admin = getAdminSupabase();
  if (!admin) return [];

  const { data: requestRows } = await admin
    .from("market_requests")
    .select("*, businesses(name), events(name)")
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
    const { businesses, events, ...requestFields } = r;
    const business = Array.isArray(businesses) ? businesses[0] : businesses;
    const event = Array.isArray(events) ? events[0] : events;
    const row: AdminMarketRequestRow = {
      ...requestFields,
      businessName: business?.name ?? null,
      eventName: event?.name ?? null,
      interestCount: interestCounts.get(r.id) ?? 0,
    };
    let group = groups.get(r.normalized_key);
    if (!group) {
      group = {
        normalizedKey: r.normalized_key,
        requestedText: r.requested_text,
        city: r.city,
        state: r.state,
        requests: [],
        consumerInterestCount: 0,
        businessCount: 0,
        eventCount: 0,
        oldestCreatedAt: r.created_at,
      };
      groups.set(r.normalized_key, group);
    }
    group.requests.push(row);
    if (row.source === "consumer") group.consumerInterestCount += row.interestCount;
    if (row.source === "business_creation") group.businessCount += 1;
    if (row.source === "event_creation") group.eventCount += 1;
    if (r.created_at < group.oldestCreatedAt) group.oldestCreatedAt = r.created_at;
  }

  return Array.from(groups.values()).sort((a, b) => a.oldestCreatedAt.localeCompare(b.oldestCreatedAt));
}

export type MarketRequestSourceFilter = MarketRequestSource;

/** Applies a resolution (an existing OR newly-created Market id) to
 * every linked business/event across a group of requests being
 * resolved together. NEVER overwrites an existing active Primary
 * Market or a non-null event.market_id — per this pass's own
 * "don't overwrite silently" rule, a business/event that already has
 * one is simply left alone (the request itself still gets marked
 * resolved; an admin_note on the request is the record of that
 * conflict having existed). */
export async function applyMarketRequestResolution(
  supabase: SupabaseClient,
  requests: { source_business_id: string | null; source_event_id: string | null }[],
  marketId: string
): Promise<void> {
  for (const r of requests) {
    if (r.source_business_id) {
      const { data: existingPrimary } = await supabase
        .from("business_markets")
        .select("id")
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
    }
    if (r.source_event_id) {
      const { data: ev } = await supabase.from("events").select("market_id").eq("id", r.source_event_id).maybeSingle();
      if (ev && ev.market_id === null) {
        await supabase.from("events").update({ market_id: marketId }).eq("id", r.source_event_id);
      }
    }
  }
}
