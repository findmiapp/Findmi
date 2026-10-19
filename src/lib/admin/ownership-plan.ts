// Admin Ownership & Management — what a management change WILL and will
// NOT touch, decided in one pure place so the confirmation copy and the
// server action can never disagree. Pure (client + server).

export interface EventReassignPlan {
  /** New events.host_business_id (the managing Page). */
  hostBusinessId: string;
  /** event_members rows removed (direct user management). */
  removeMemberIds: string[];
  title: string;
  message: string;
}

/** Events keep everything except their management relationships. */
export const EVENT_UNCHANGED =
  "This will not recreate the Event or change its dates, Location, participating Businesses, media, URLs, analytics or Findmi Here appearances.";

export function planEventReassignment(input: {
  eventName: string;
  currentHost: { id: string; name: string } | null;
  nextHost: { id: string; name: string };
  directManagers: { memberId: string; label: string }[];
  removeDirect: boolean;
}): EventReassignPlan {
  const { eventName, currentHost, nextHost, directManagers, removeDirect } = input;
  const removing = removeDirect ? directManagers : [];
  const parts = [
    currentHost && currentHost.id === nextHost.id
      ? `${nextHost.name} stays the managing Page for ${eventName}.`
      : `${nextHost.name} will become the managing Page for ${eventName}${currentHost ? `, replacing ${currentHost.name}` : ""}; its Owners and Managers can edit it.`,
    removing.length > 0
      ? `Direct management will be removed for: ${removing.map((m) => m.label).join(", ")}.`
      : directManagers.length > 0
        ? "Direct managers are kept."
        : "",
    EVENT_UNCHANGED,
  ].filter(Boolean);
  return {
    hostBusinessId: nextHost.id,
    removeMemberIds: removing.map((m) => m.memberId),
    title: `Reassign This Event To ${nextHost.name}?`,
    message: parts.join(" "),
  };
}

/** Location listing approval and management are separate decisions; the
 * combined Admin actions are conveniences over both. */
export type LocationReviewDecision = "approve_assign" | "approve_unclaimed" | "decline_request" | "publish";

export function planLocationReview(decision: LocationReviewDecision): { publish: boolean; approveRequest: boolean; declineRequest: boolean } {
  switch (decision) {
    case "approve_assign":
      return { publish: true, approveRequest: true, declineRequest: false };
    case "approve_unclaimed":
      return { publish: true, approveRequest: false, declineRequest: true };
    case "decline_request":
      return { publish: false, approveRequest: false, declineRequest: true };
    case "publish":
      return { publish: true, approveRequest: false, declineRequest: false };
  }
}

export function isLocationReviewDecision(v: unknown): v is LocationReviewDecision {
  return v === "approve_assign" || v === "approve_unclaimed" || v === "decline_request" || v === "publish";
}
