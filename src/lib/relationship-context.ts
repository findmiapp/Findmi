import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TargetKind } from "./commercial-intents";
import type { TargetStatus } from "./business-targets-domain";
import { TARGET_COLUMN } from "./business-targets";
import { getOpportunityCandidates, type OpportunityCandidate } from "./relevant-opportunities";
import { OPPORTUNITY_TYPE_LABELS } from "./opportunity-listings-domain";
import type { CommercialIntent } from "./commercial-intents";
import type { InquiryStatus } from "./commercial-inquiries-domain";
import { relationshipHref, relationshipRefFor } from "./relationship-links";

/** Relationship context — composed, owner-only reads over the EXISTING records
 * (business_targets, commercial_inquiries, opportunity_listings). No
 * relationship table, nothing written. Every function is scoped by the
 * viewer's own Business ids, which the caller has authorized; nothing here
 * ever returns Context, Next Step, Activity or Findmi Internal — only the
 * owner's own Target status, its own open Inquiries and Opportunities it can
 * already see. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

export interface ContextualOpportunity {
  title: string;
  typeLabel: string;
  path: string;
  reason: string;
  sentToYou: boolean;
}

/** Opportunities ONE Business can already see (sent to it, or open and
 * discoverable) that are explicitly about this exact entity:
 *   Place    → listed at this place;
 *   Event    → listed for this Event;
 *   Business → listed at a place it operates or for an Event it hosts
 *              (canonical relationships only — never organizer_name text).
 * Sent-to-you first, then the soonest deadline. Same Opportunity system;
 * each opens its existing page (recipient thread or Explore listing). */
export async function contextualOpportunities(
  admin: SupabaseClient,
  viewerBusinessId: string,
  kind: TargetKind,
  entityId: string,
  candidates?: readonly OpportunityCandidate[]
): Promise<ContextualOpportunity[]> {
  if (!UUID.test(entityId)) return [];
  const all = candidates ?? (await getOpportunityCandidates(admin, viewerBusinessId));
  if (!all.length) return [];
  let match: (c: OpportunityCandidate) => string | null;
  if (kind === "location") match = (c) => (c.geo.locationId === entityId ? "At This Place" : null);
  else if (kind === "event") match = (c) => (c.eventId === entityId ? "For This Event" : null);
  else {
    const eventIds = [...new Set(all.map((c) => c.eventId).filter((v): v is string => Boolean(v)))];
    const locationIds = [...new Set(all.map((c) => c.geo.locationId).filter((v): v is string => Boolean(v)))];
    const [hosted, operated] = await Promise.all([
      eventIds.length ? admin.from("events").select("id").in("id", eventIds).eq("host_business_id", entityId) : Promise.resolve({ data: [] }),
      locationIds.length ? admin.from("business_locations").select("location_id").in("location_id", locationIds).eq("business_id", entityId) : Promise.resolve({ data: [] }),
    ]);
    const ev = new Set(((hosted.data ?? []) as Row[]).map((r) => r.id as string));
    const loc = new Set(((operated.data ?? []) as Row[]).map((r) => r.location_id as string));
    match = (c) => (c.eventId && ev.has(c.eventId) ? "For Their Event" : c.geo.locationId && loc.has(c.geo.locationId) ? "At Their Place" : null);
  }
  const base = `/account/business/${viewerBusinessId}`;
  const t = (v: string | null) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);
  return all
    .map((c) => ({ c, reason: match(c) }))
    .filter((x): x is { c: OpportunityCandidate; reason: string } => Boolean(x.reason))
    .sort((a, b) => Number(Boolean(b.c.recipientId)) - Number(Boolean(a.c.recipientId)) || t(a.c.responseDeadline) - t(b.c.responseDeadline) || a.c.title.localeCompare(b.c.title) || a.c.listingId.localeCompare(b.c.listingId))
    .slice(0, 5)
    .map(({ c, reason }) => ({
      title: c.title,
      typeLabel: OPPORTUNITY_TYPE_LABELS[c.type],
      path: c.recipientId ? `${base}/opportunities/${c.recipientId}` : `${base}/opportunities/explore/${c.listingId}`,
      reason,
      sentToYou: Boolean(c.recipientId),
    }));
}

export interface EntityRelationship {
  businessId: string;
  businessName: string;
  /** Owner / manager may Connect and act; staff only open. */
  canEdit: boolean;
  /** The owner's own Target status (never shown to anyone else). */
  status: TargetStatus | null;
  href: string | null;
  /** The owner's open Inquiries with this entity (shared state). */
  inquiries: { id: string; intent: CommercialIntent; status: InquiryStatus }[];
  opportunities: ContextualOpportunity[];
}

/** For a signed-in viewer's own Businesses: each one's relationship with one
 * entity. Bounded: one Target read and one Inquiry read across all of them,
 * Opportunities for at most the first few. A Business is never related to
 * itself. */
export async function getEntityRelationships(
  admin: SupabaseClient,
  businesses: readonly { id: string; name: string; role: string }[],
  kind: TargetKind,
  entityId: string
): Promise<EntityRelationship[]> {
  if (!UUID.test(entityId)) return [];
  const mine = businesses.filter((b) => UUID.test(b.id) && !(kind === "business" && b.id === entityId)).slice(0, 10);
  if (!mine.length) return [];
  const ids = mine.map((b) => b.id);
  const cpCol = kind === "location" ? "counterparty_location_id" : kind === "event" ? "counterparty_event_id" : "counterparty_business_id";
  const [targets, inquiries] = await Promise.all([
    admin.from("business_targets").select("id, business_id, status, target_location_id").in("business_id", ids).eq(TARGET_COLUMN[kind], entityId),
    admin.from("commercial_inquiries").select("id, sender_business_id, intent, status").in("sender_business_id", ids).eq(cpCol, entityId).in("status", ["sent", "responded"]),
  ]);
  const tBy = new Map(((targets.data ?? []) as Row[]).map((r) => [r.business_id as string, r]));
  const qRows = (inquiries.data ?? []) as Row[];
  const opps = await Promise.all(mine.map((b, i) => (i < 3 ? contextualOpportunities(admin, b.id, kind, entityId) : Promise.resolve([] as ContextualOpportunity[]))));
  return mine.map((b, i) => {
    const t = tBy.get(b.id);
    return {
      businessId: b.id,
      businessName: b.name,
      canEdit: b.role === "owner" || b.role === "manager",
      status: (t?.status as TargetStatus | undefined) ?? null,
      href: t ? relationshipHref(b.id, relationshipRefFor(kind, { targetId: t.id as string, locationId: (t.target_location_id as string | null) ?? null })) : kind === "location" ? relationshipHref(b.id, { kind: "location", locationId: entityId }) : null,
      inquiries: qRows.filter((q) => q.sender_business_id === b.id).map((q) => ({ id: q.id as string, intent: q.intent as CommercialIntent, status: q.status as InquiryStatus })),
      opportunities: opps[i],
    };
  });
}
