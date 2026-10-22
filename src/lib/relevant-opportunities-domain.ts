/** Relevant Opportunities — the pure, deterministic rules (no I/O, no scores).
 *
 * A commercial Opportunity (opportunity_listings — never the Event participation
 * table public.opportunities) is relevant to a scope when its geography
 * overlaps it. Every match carries plain reason labels a person can check
 * ("At This Place", "In Jersey City", "Priority Market", "Matches Sampling &
 * Demos Interest") — never a percentage, rank or AI judgement. */

import { GOAL_INTEREST_LABELS, type GoalInterest } from "./opportunity-goals-domain";
import type { OpportunityType } from "./opportunity-listings-domain";

/** An Opportunity's geography: its Location's when it has one, otherwise its
 * own Market / Area fields. */
export interface ListingGeography {
  locationId: string | null;
  marketId: string | null;
  areaId: string | null;
  /** Display name of the Area / Market it covers (for the reason label). */
  areaName: string | null;
  marketName: string | null;
}

/** What is being matched against. `areaIds` are the Area and its descendants;
 * `areaAncestors` (location scope) are the place's Area and every ancestor, so
 * an Area-wide Opportunity covering Jersey City also reaches a Downtown place. */
export type RelevanceScope =
  | { kind: "location"; locationId: string; marketId: string | null; areaAncestors: string[] }
  | { kind: "market"; marketId: string; label: string }
  | { kind: "area"; marketId: string; areaIds: string[]; label: string };

/** Interest (Opportunity goal) → the commercial types it asks for. */
export const INTEREST_TYPES: Partial<Record<GoalInterest, OpportunityType[]>> = {
  sampling_demos: ["sampling_demo"],
  pop_ups: ["activation"],
  experiential: ["activation"],
  vending: ["vending"],
  sponsorships: ["sponsorship"],
  content_creator: ["content"],
  partnerships: ["partnership"],
};

/** Does the Opportunity's geography fall in the scope? Returns the geographic
 * reason, or null when it doesn't. */
export function geographyReason(geo: ListingGeography, scope: RelevanceScope): string | null {
  if (scope.kind === "location") {
    if (geo.locationId) return geo.locationId === scope.locationId ? "At This Place" : null;
    if (geo.areaId) return scope.areaAncestors.includes(geo.areaId) ? `In ${geo.areaName ?? "This Area"}` : null;
    if (geo.marketId) return geo.marketId === scope.marketId ? `In ${geo.marketName ?? "This Market"}` : null;
    return null;
  }
  if (scope.kind === "market") {
    return geo.marketId === scope.marketId ? `In ${scope.label}` : null;
  }
  // Area scope: the Opportunity's place/Area is inside it, or it is Market-wide
  // for the Area's Market (and so covers the Area too).
  if (geo.areaId && scope.areaIds.includes(geo.areaId)) return `In ${scope.label}`;
  if (!geo.locationId && !geo.areaId && geo.marketId === scope.marketId) return `In ${geo.marketName ?? scope.label}`;
  return null;
}

/** The extra, explainable reasons beyond geography. */
export function contextReasons(
  listing: { type: OpportunityType; geo: ListingGeography; sentToYou: boolean },
  ctx: { priorityMarketIds: ReadonlySet<string>; priorityAreaIds: ReadonlySet<string>; interests: ReadonlySet<GoalInterest> }
): string[] {
  const out: string[] = [];
  if (listing.sentToYou) out.push("Sent To You");
  if ((listing.geo.areaId && ctx.priorityAreaIds.has(listing.geo.areaId)) || (listing.geo.marketId && ctx.priorityMarketIds.has(listing.geo.marketId))) out.push("Priority Market");
  for (const [interest, types] of Object.entries(INTEREST_TYPES) as [GoalInterest, OpportunityType[]][]) {
    if (ctx.interests.has(interest) && types.includes(listing.type)) {
      out.push(`Matches ${GOAL_INTEREST_LABELS[interest]} Interest`);
      break;
    }
  }
  return out;
}
