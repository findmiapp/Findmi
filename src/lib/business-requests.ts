// Business Home → Requests: things sent TO this Business that are waiting on
// its response — composed only from state the records that own it already
// carry (nothing stored, nothing new read):
//   · a commercial Opportunity offered to it on an open listing
//     (opportunity_recipients "offered" → the "For You" group);
//   · an Event invitation to it still pending (opportunities
//     event_invitation / pending);
//   · paid orders whose fulfillment for it is still "new"
//     (getBusinessOrderSummary's newCount — one aggregate row).
// A Request disappears when its record moves on (responded, accepted /
// declined, fulfilled). Messages and inquiries are not Requests: the
// Conversations system has no read / handled state. Pure and client-safe.
import type { BusinessOpportunityGroup } from "./opportunity-listings-domain";
import type { OpportunityStatus, OpportunityType } from "./opportunities";
import { APP_TIMEZONE } from "./format";

/** Home shows this many; See All shows the rest. */
export const REQUESTS_INITIAL_LIMIT = 3;

export interface RequestOpportunityInput {
  recipientId: string;
  title: string;
  /** businessOpportunityGroup — "for_you" is exactly offered + open listing. */
  group: BusinessOpportunityGroup;
  placeName: string | null;
  offeredAt: string;
}

export interface RequestInvitationInput {
  id: string;
  type: OpportunityType;
  status: OpportunityStatus;
  eventName: string;
  occurrenceStartAt: string | null;
  occurrenceLocationName: string | null;
  createdAt: string;
}

export interface BusinessRequest {
  key: string;
  title: string;
  /** Kind · "Response Requested" (or the order line). */
  meta: string;
  /** Short existing context (place, date), when there is any. */
  detail: string | null;
  href: string;
  actionLabel: string;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: APP_TIMEZONE });

export function buildBusinessRequests({
  basePath,
  opportunities,
  invitations,
  newOrderCount,
}: {
  basePath: string;
  opportunities: readonly RequestOpportunityInput[];
  invitations: readonly RequestInvitationInput[];
  /** Paid orders still "new" for this Business (getBusinessOrderSummary). */
  newOrderCount: number;
}): BusinessRequest[] {
  const requests: BusinessRequest[] = [];

  // Orders first: a paying customer is already waiting.
  if (newOrderCount > 0) {
    requests.push({
      key: "orders:new",
      title: newOrderCount === 1 ? "1 New Order" : `${newOrderCount} New Orders`,
      meta: newOrderCount === 1 ? "An order needs your attention" : "Orders need your attention",
      detail: null,
      href: `${basePath}?tab=orders`,
      actionLabel: "View Orders",
    });
  }

  // Event invitations, soonest date first (undated last), then oldest invite.
  const pending = invitations
    .filter((i) => i.type === "event_invitation" && i.status === "pending")
    .sort((a, b) => (a.occurrenceStartAt ?? "9999").localeCompare(b.occurrenceStartAt ?? "9999") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const i of pending) {
    requests.push({
      key: `invitation:${i.id}`,
      title: i.eventName,
      meta: "Event Invitation · Response Requested",
      detail: [i.occurrenceStartAt ? day(i.occurrenceStartAt) : null, i.occurrenceLocationName].filter(Boolean).join(" · ") || null,
      href: "/account/messages?filter=opportunities",
      actionLabel: "Review",
    });
  }

  // Commercial Opportunities offered and still open, oldest offer first.
  const offered = opportunities.filter((o) => o.group === "for_you").sort((a, b) => a.offeredAt.localeCompare(b.offeredAt) || a.recipientId.localeCompare(b.recipientId));
  for (const o of offered) {
    requests.push({
      key: `opportunity:${o.recipientId}`,
      title: o.title,
      meta: "Opportunity · Response Requested",
      detail: o.placeName,
      href: `${basePath}/opportunities/${o.recipientId}`,
      actionLabel: "Review",
    });
  }

  return requests;
}
