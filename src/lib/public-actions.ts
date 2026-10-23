import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TargetKind } from "./commercial-intents";
import { isExplorable } from "./opportunity-listings-domain";
import {
  MAX_PUBLIC_ACTIONS,
  actionIntent,
  actionLabel,
  actionRoute,
  isActionCompatible,
  isPublicActionType,
  type PublicActionConfig,
  type PublicActionRoute,
  type PublicActionType,
} from "./public-actions-domain";

/** Public Actions — reads and writes over entity_public_actions (server-only,
 * service-role). The public page renders only what resolves to a real,
 * currently-available destination; nothing private is ever read here. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

export const PUBLIC_ACTION_ENTITY_COLUMN: Record<TargetKind, "business_id" | "location_id" | "event_id"> = {
  business: "business_id",
  location: "location_id",
  event: "event_id",
};

export function isMissingPublicActionsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /entity_public_actions/.test(error.message ?? "");
}

/** The entity's configured actions in display order, or null when it has
 * configured none (or the table isn't there yet) — the caller then keeps the
 * entity's existing behavior. */
export async function readPublicActions(admin: SupabaseClient, kind: TargetKind, entityId: string): Promise<PublicActionConfig[] | null> {
  if (!UUID.test(entityId)) return null;
  const { data, error } = await admin
    .from("entity_public_actions")
    .select("action_type, custom_label, enabled, display_order, opportunity_listing_id")
    .eq(PUBLIC_ACTION_ENTITY_COLUMN[kind], entityId)
    .order("display_order", { ascending: true })
    .limit(MAX_PUBLIC_ACTIONS);
  if (error) {
    if (!isMissingPublicActionsTable(error)) console.error("readPublicActions failed:", error.message);
    return null;
  }
  const rows = ((data ?? []) as Row[]).filter((r) => isPublicActionType(r.action_type) && isActionCompatible(kind, r.action_type as PublicActionType));
  if (!rows.length) return null;
  return rows.map((r) => ({
    type: r.action_type as PublicActionType,
    label: (r.custom_label as string | null) ?? null,
    enabled: r.enabled !== false,
    opportunityListingId: (r.opportunity_listing_id as string | null) ?? null,
  }));
}

/** Replaces the entity's actions with this validated list (slots 1..n). The
 * caller has authorized the entity manager. */
export async function savePublicActions(
  admin: SupabaseClient,
  kind: TargetKind,
  entityId: string,
  actions: readonly PublicActionConfig[],
  userId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const col = PUBLIC_ACTION_ENTITY_COLUMN[kind];
  for (const a of actions) {
    if (a.type === "opportunity" && !(await opportunityBelongsTo(admin, kind, entityId, a.opportunityListingId))) {
      return { ok: false, error: "That Opportunity isn't open for this page." };
    }
  }
  const cleared = await admin.from("entity_public_actions").delete().eq(col, entityId);
  if (cleared.error) {
    if (isMissingPublicActionsTable(cleared.error)) return { ok: false, error: "Public Actions aren't available yet." };
    console.error("savePublicActions failed:", cleared.error.message);
    return { ok: false, error: "Couldn't save your actions. Please try again." };
  }
  if (!actions.length) return { ok: true };
  const { error } = await admin.from("entity_public_actions").insert(
    actions.slice(0, MAX_PUBLIC_ACTIONS).map((a, i) => ({
      [col]: entityId,
      action_type: a.type,
      custom_label: a.label,
      enabled: a.enabled,
      display_order: i + 1,
      opportunity_listing_id: a.type === "opportunity" ? a.opportunityListingId : null,
      created_by_user_id: userId,
    }))
  );
  if (error) {
    console.error("savePublicActions failed:", error.message);
    return { ok: false, error: "Couldn't save your actions. Please try again." };
  }
  return { ok: true };
}

// ── Opportunities about this entity ────────────────────────────────────────

/** Open, discoverable Opportunity listings explicitly about this entity: at
 * this Place, for this Event, or (Business) at a Place it operates / for an
 * Event it hosts. The same listings Explore already shows to any Business. */
export async function entityOpportunityIds(admin: SupabaseClient, kind: TargetKind, entityId: string, now = new Date()): Promise<string[]> {
  if (!UUID.test(entityId)) return [];
  let locationIds: string[] = [];
  let eventIds: string[] = [];
  if (kind === "location") locationIds = [entityId];
  else if (kind === "event") eventIds = [entityId];
  else {
    const [ops, hosted] = await Promise.all([
      admin.from("business_locations").select("location_id").eq("business_id", entityId).limit(50),
      admin.from("events").select("id").eq("host_business_id", entityId).limit(50),
    ]);
    locationIds = ((ops.data ?? []) as Row[]).map((r) => r.location_id as string);
    eventIds = ((hosted.data ?? []) as Row[]).map((r) => r.id as string);
  }
  if (!locationIds.length && !eventIds.length) return [];
  const read = (col: "location_id" | "event_id", ids: string[]) =>
    ids.length
      ? admin.from("opportunity_listings").select("id, status, visibility, response_deadline, created_at").in(col, ids).eq("status", "open").eq("visibility", "discoverable").limit(20)
      : Promise.resolve({ data: [] as Row[] });
  const [atPlaces, forEvents] = await Promise.all([read("location_id", locationIds), read("event_id", eventIds)]);
  const rows = [...((atPlaces.data ?? []) as Row[]), ...((forEvents.data ?? []) as Row[])];
  const ids = new Set<string>();
  for (const r of rows) {
    if (isExplorable({ visibility: r.visibility as string, status: r.status as never, response_deadline: (r.response_deadline as string | null) ?? null }, now)) ids.add(r.id as string);
  }
  return [...ids].sort();
}

async function opportunityBelongsTo(admin: SupabaseClient, kind: TargetKind, entityId: string, listingId: string | null): Promise<boolean> {
  if (!listingId) return false;
  return (await entityOpportunityIds(admin, kind, entityId)).includes(listingId);
}

// ── What the public page renders ───────────────────────────────────────────

export interface PublicActionView {
  /** Slot (1..3) — stable for auth continuation (?act=). */
  slot: number;
  type: PublicActionType;
  route: PublicActionRoute;
  label: string;
  intent: string | null;
  opportunityListingId: string | null;
  /** website only: the entity's own saved, safe URL. */
  href: string | null;
}

export interface PublicActionAvailability {
  /** The existing public Inquire / Contact form is available for this entity. */
  generalInquiry: boolean;
  /** Business only: its existing Inquire label (inquiry_cta_label) for the
   * legacy button when nothing is configured. */
  legacyInquireLabel?: string | null;
  /** Event only: participation applications are open. */
  participation?: boolean;
  /** The entity's own saved, safe website. */
  website?: string | null;
}

/** The buttons to render, in order. Configured actions that can't truthfully
 * route right now (Inquiries off, applications closed, Opportunity no longer
 * open, no website) are skipped — never a dead button. With nothing
 * configured, a Business keeps its existing Inquire button; Locations and
 * Events show none (nothing is fabricated). */
export function resolvePublicActions(
  kind: TargetKind,
  configured: readonly PublicActionConfig[] | null,
  available: PublicActionAvailability,
  openOpportunityIds: readonly string[]
): PublicActionView[] {
  const list: readonly PublicActionConfig[] =
    configured ?? (kind === "business" && available.generalInquiry ? [{ type: "general_inquiry", label: available.legacyInquireLabel?.trim() || null, enabled: true, opportunityListingId: null }] : []);
  const out: PublicActionView[] = [];
  list.forEach((a, i) => {
    if (!a.enabled || !isActionCompatible(kind, a.type)) return;
    const route = actionRoute(a.type);
    if (route === "general_inquiry" && !available.generalInquiry) return;
    if (route === "event_participation" && !available.participation) return;
    if (route === "website" && !available.website) return;
    if (route === "opportunity" && !(a.opportunityListingId && openOpportunityIds.includes(a.opportunityListingId))) return;
    out.push({
      slot: i + 1,
      type: a.type,
      route,
      label: actionLabel(a),
      intent: actionIntent(a.type),
      opportunityListingId: route === "opportunity" ? a.opportunityListingId : null,
      href: route === "website" ? (available.website ?? null) : null,
    });
  });
  return out.slice(0, MAX_PUBLIC_ACTIONS);
}

/** For a public page: its buttons and how many open Opportunities are about it. */
export async function loadPublicActions(
  admin: SupabaseClient | null,
  kind: TargetKind,
  entityId: string,
  available: PublicActionAvailability
): Promise<{ actions: PublicActionView[]; opportunityCount: number }> {
  if (!admin) return { actions: resolvePublicActions(kind, null, available, []), opportunityCount: 0 };
  const [configured, openIds] = await Promise.all([readPublicActions(admin, kind, entityId), entityOpportunityIds(admin, kind, entityId)]);
  return { actions: resolvePublicActions(kind, configured, available, openIds), opportunityCount: openIds.length };
}

/** For the manager's Public Actions settings: what's saved (empty when
 * nothing is), whether the store exists yet, and the open Opportunities about
 * this entity an Opportunity action may point at. */
export async function getPublicActionsEditorData(
  admin: SupabaseClient,
  kind: TargetKind,
  entityId: string
): Promise<{ ready: boolean; configured: PublicActionConfig[]; opportunities: { id: string; title: string }[] }> {
  const probe = await admin.from("entity_public_actions").select("id").eq(PUBLIC_ACTION_ENTITY_COLUMN[kind], entityId).limit(1);
  const ready = !isMissingPublicActionsTable(probe.error);
  const [configured, ids] = await Promise.all([ready ? readPublicActions(admin, kind, entityId) : Promise.resolve(null), entityOpportunityIds(admin, kind, entityId)]);
  let opportunities: { id: string; title: string }[] = [];
  if (ids.length) {
    const { data } = await admin.from("opportunity_listings").select("id, title").in("id", ids);
    opportunities = ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, title: (r.title as string) ?? "Opportunity" })).sort((a, b) => a.title.localeCompare(b.title));
  }
  return { ready, configured: configured ?? [], opportunities };
}
