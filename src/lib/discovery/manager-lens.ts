import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isExplorable } from "@/lib/opportunity-listings-domain";
import { isValidCoordinate, mapStatus, type MapFeature, type MapTone } from "./map-core";
import { loadMapItems } from "./map-server";

// Discovery Engine V1 — the Business Manager geographic lens. SAME map
// engine and renderer as consumer discovery (one MapFeature contract, one
// DiscoveryMapCanvas); only the relationship adapters differ, each reading
// its existing canonical table:
//
//   presence       business_locations (operates here), live in-effect
//                  business_location_availability (Available Here),
//                  business_location_placements status 'active'
//   upcoming       the consumer engine itself (loadMapItems with this
//                  Brand) — exactly what customers would find
//   targets        business_targets / placements: target, agreed,
//                  placement_pending
//   conversations  business_targets / placements: in_conversation
//   opportunities  opportunity_listings at a real Location that are
//                  Explorable (lib/opportunity-listings-domain)
//
// Markers name the place and the relationship in words ("3 Acres —
// Target", "Eataly — Active") — no color legend. Read with the Manager's
// service client AFTER getManagerCore authorized this Business.

export const MANAGER_LAYERS = ["presence", "upcoming", "targets", "conversations", "opportunities"] as const;
export type ManagerLayer = (typeof MANAGER_LAYERS)[number];
export const MANAGER_LAYER_LABELS: Record<ManagerLayer, string> = {
  presence: "Presence",
  upcoming: "Upcoming",
  targets: "Targets",
  conversations: "Conversations",
  opportunities: "Opportunities",
};

interface Mark {
  layer: ManagerLayer;
  locationId: string;
  status: string;
  detail?: string;
  href: string | null;
  live?: boolean;
  tone?: MapTone;
}

export interface ManagerRow {
  key: string;
  layer: ManagerLayer;
  place: string;
  status: string;
  detail: string | null;
  href: string | null;
  featureId: string;
  lng: number;
  lat: number;
}

export interface ManagerMapData {
  features: MapFeature[];
  rows: ManagerRow[];
  /** Relationships whose place has no map coordinate yet. */
  unplaced: number;
}

type Row = Record<string, unknown>;
const TARGET_STATUS: Record<string, string> = { target: "Target", agreed: "Agreed", placement_pending: "Placement Pending", in_conversation: "Conversation", active: "Active" };

async function presence(admin: SupabaseClient, businessId: string, now: Date): Promise<Mark[]> {
  const today = now.toISOString().slice(0, 10);
  const [ops, avail, placed] = await Promise.all([
    admin.from("business_locations").select("location_id").eq("business_id", businessId),
    admin.from("business_location_availability").select("location_id, status, starts_on, ends_on").eq("business_id", businessId),
    admin.from("business_location_placements").select("location_id").eq("business_id", businessId).eq("status", "active"),
  ]);
  const inEffect = (r: Row) => (r.status === undefined || r.status === "live") && (!r.starts_on || String(r.starts_on) <= today) && (!r.ends_on || String(r.ends_on) >= today);
  return [
    ...((ops.data ?? []) as Row[]).map((r) => ({ layer: "presence" as const, locationId: r.location_id as string, status: "Your Place", href: null })),
    ...((avail.data ?? []) as Row[]).filter(inEffect).map((r) => ({ layer: "presence" as const, locationId: r.location_id as string, status: "Available Here", href: null })),
    ...((placed.data ?? []) as Row[]).map((r) => ({ layer: "presence" as const, locationId: r.location_id as string, status: "Active", href: null })),
  ];
}

async function relationships(admin: SupabaseClient, businessId: string): Promise<Mark[]> {
  const [targets, placements] = await Promise.all([
    admin.from("business_targets").select("target_location_id, target_business_id, target_event_id, status").eq("business_id", businessId).in("status", ["target", "in_conversation", "agreed"]),
    admin.from("business_location_placements").select("location_id, status").eq("business_id", businessId).in("status", ["target", "in_conversation", "placement_pending"]),
  ]);
  const t = (targets.data ?? []) as Row[];
  // A Business target is placed at its primary Location; an Event target
  // at its next scheduled date's Location.
  const bizIds = t.filter((r) => !r.target_location_id && r.target_business_id).map((r) => r.target_business_id as string);
  const evIds = t.filter((r) => !r.target_location_id && !r.target_business_id && r.target_event_id).map((r) => r.target_event_id as string);
  const [prim, occ] = await Promise.all([
    bizIds.length ? admin.from("business_locations").select("business_id, location_id").in("business_id", bizIds).eq("is_primary", true) : Promise.resolve({ data: [] }),
    evIds.length ? admin.from("event_occurrences").select("event_id, location_id, start_at").in("event_id", evIds).eq("status", "scheduled").not("location_id", "is", null).gte("end_at", new Date().toISOString()).order("start_at") : Promise.resolve({ data: [] }),
  ]);
  const primary = new Map(((prim.data ?? []) as Row[]).map((r) => [r.business_id as string, r.location_id as string]));
  const nextOcc = new Map<string, string>();
  for (const r of (occ.data ?? []) as Row[]) if (!nextOcc.has(r.event_id as string)) nextOcc.set(r.event_id as string, r.location_id as string);
  const out: Mark[] = [];
  for (const r of t) {
    const loc = (r.target_location_id as string) || primary.get(r.target_business_id as string) || nextOcc.get(r.target_event_id as string);
    if (!loc) continue;
    out.push({ layer: r.status === "in_conversation" ? "conversations" : "targets", locationId: loc, status: TARGET_STATUS[r.status as string] ?? "Target", href: null });
  }
  for (const r of (placements.data ?? []) as Row[]) out.push({ layer: r.status === "in_conversation" ? "conversations" : "targets", locationId: r.location_id as string, status: TARGET_STATUS[r.status as string] ?? "Target", href: null });
  return out;
}

async function opportunities(admin: SupabaseClient, now: Date): Promise<Mark[]> {
  const { data } = await admin.from("opportunity_listings").select("id, title, location_id, status, visibility, response_deadline").eq("status", "open").eq("visibility", "discoverable").not("location_id", "is", null).limit(300);
  return ((data ?? []) as Row[])
    .filter((r) => isExplorable(r as { visibility: string; status: "open"; response_deadline: string | null }, now))
    .map((r) => ({ layer: "opportunities" as const, locationId: r.location_id as string, status: "Opportunity", detail: r.title as string, href: null }));
}

async function upcoming(slug: string, now: Date): Promise<Mark[]> {
  const { items } = await loadMapItems({ brands: [slug], entities: ["event", "appearance"] }, now);
  return items
    .filter((i) => i.brands.some((b) => b.slug === slug) && i.status !== "cancelled")
    .map((i) => {
      const s = mapStatus(i, now);
      return { layer: "upcoming" as const, locationId: i.location.id, status: s.live ? "LIVE" : "Upcoming", detail: `${i.title} · ${s.text}`, href: i.href, live: s.live, tone: s.tone };
    });
}

export async function getManagerMapData(admin: SupabaseClient, business: { id: string; slug: string }, layers: ManagerLayer[], now: Date = new Date()): Promise<ManagerMapData> {
  const want = new Set(layers);
  const marks = (
    await Promise.all([
      want.has("presence") ? presence(admin, business.id, now) : [],
      want.has("targets") || want.has("conversations") ? relationships(admin, business.id) : [],
      want.has("opportunities") ? opportunities(admin, now) : [],
      want.has("upcoming") ? upcoming(business.slug, now) : [],
    ])
  )
    .flat()
    .filter((m) => want.has(m.layer));
  const ids = [...new Set(marks.map((m) => m.locationId))];
  const locs = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from("locations").select("id, name, slug, latitude, longitude, logo_url, is_demo").in("id", ids.slice(i, i + 150)).is("archived_at", null).is("trashed_at", null);
    for (const r of (data ?? []) as Row[]) locs.set(r.id as string, r);
  }
  const byLoc = new Map<string, Mark[]>();
  let unplaced = 0;
  for (const m of marks) {
    const l = locs.get(m.locationId);
    if (!l || !isValidCoordinate(l.latitude, l.longitude)) {
      unplaced++;
      continue;
    }
    byLoc.set(m.locationId, [...(byLoc.get(m.locationId) ?? []), m]);
  }
  const features: MapFeature[] = [];
  const rows: ManagerRow[] = [];
  for (const [locId, list] of byLoc) {
    const l = locs.get(locId)!;
    const statuses = [...new Set(list.map((m) => m.status))];
    const live = list.some((m) => m.live);
    const id = `loc:${locId}`;
    const placeHref = l.is_demo === false && l.slug ? `/location/${l.slug}` : null;
    features.push({ id, lng: l.longitude as number, lat: l.latitude as number, count: list.length, label: l.name as string, place: l.name as string, status: statuses.join(" · "), live, tone: live ? "live" : "place", logo: (l.logo_url as string) ?? null, locationId: locId, keys: list.map((_, i) => `${locId}:${i}`) });
    list.forEach((m, i) => rows.push({ key: `${locId}:${i}`, layer: m.layer, place: l.name as string, status: m.status, detail: m.detail ?? null, href: m.href ?? placeHref, featureId: id, lng: l.longitude as number, lat: l.latitude as number }));
  }
  rows.sort((a, b) => MANAGER_LAYERS.indexOf(a.layer) - MANAGER_LAYERS.indexOf(b.layer) || a.place.localeCompare(b.place));
  return { features, rows, unplaced };
}
