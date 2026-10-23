// One Entity. One Relationship Context. Many Views.
//
// The ONE way any surface — Targets, Add To Targets, Discover, a public
// entity page, Home Follow-Ups, By Market, contextual Opportunities — opens
// a Business's relationship with a Place, Business or Event. There is no
// relationship table: the "relationship" is a composed read over the
// existing records (the private Target, Inquiries, Presence, Opportunities,
// Appearances), shown in the existing workspace. Pure (client + server).
//
// A Place opens by the place itself (`loc`), so it works with or without a
// Target; a Business or Event opens by its private Target (`tgt`). Legacy
// `pt` links keep resolving in the Business Manager page.
import type { TargetKind } from "./commercial-intents";
import { TARGET_STATUS_LABELS, type TargetStatus } from "./business-targets-domain";

export type RelationshipRef = { kind: "location"; locationId: string } | { kind: "business" | "event"; targetId: string };

/** The workspace params for a relationship — for in-place navigation inside
 * Growth → Targets that keeps the list's own filters (legacy `pt` cleared). */
export function relationshipParams(ref: RelationshipRef): { loc: string | null; tgt: string | null; pt: null } {
  return ref.kind === "location" ? { loc: ref.locationId, tgt: null, pt: null } : { tgt: ref.targetId, loc: null, pt: null };
}

/** The query that opens a relationship from a Business Manager base path. */
export function relationshipQuery(ref: RelationshipRef): string {
  return `?tab=growth&view=targets&${ref.kind === "location" ? `loc=${ref.locationId}` : `tgt=${ref.targetId}`}`;
}

export function relationshipHref(businessId: string, ref: RelationshipRef): string {
  return `/account/business/${businessId}${relationshipQuery(ref)}`;
}

/** The ref for a Target row (place → by place; Business / Event → by Target). */
export function relationshipRefFor(kind: TargetKind, ids: { targetId: string; locationId?: string | null }): RelationshipRef {
  return kind === "location" && ids.locationId ? { kind: "location", locationId: ids.locationId } : { kind: kind === "location" ? "business" : kind, targetId: ids.targetId };
}

/** The owner's own relationship state, as shown to that owner only. */
export function relationshipStateLabel(status: TargetStatus): string {
  return TARGET_STATUS_LABELS[status];
}

/** Action vocabulary — contextual, never a universal CRM verb.
 *   Connect           start / open a private commercial relationship context
 *   Open Relationship an existing one
 *   Send Inquiry      the deliberate shared outreach (from the relationship)
 *   Apply To Participate  the Event's own participation workflow
 *   Explore Opportunity   an existing Findmi Opportunity */
export const RELATIONSHIP_ACTIONS = {
  connect: "Connect",
  open: "Open Relationship",
  inquire: "Send Inquiry",
  participate: "Apply To Participate",
  opportunity: "Explore Opportunity",
} as const;

/** What "Connect" means, said once where it's offered. */
export const CONNECT_HINT = "Starts a private relationship for your Business. Nothing is sent until you choose to.";
export const MEDIATION_LINE = "Findmi is helping make the connection.";
