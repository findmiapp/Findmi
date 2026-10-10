// Findmi communication boundary — the ONE switch and the ONE rule set for
// direct organization-to-organization messaging. Pure and dependency-free
// (imported by server actions, server components and the client
// MessageButton alike; tests/communication-policy.test.mjs).
//
// The switch is SERVER-SIDE CONFIGURATION: the environment variable
// DIRECT_BUSINESS_MESSAGING_ENABLED, read at request time by
// isDirectBusinessMessagingEnabled(). Fails closed — anything other than
// the literal "true" (unset, empty, "false", "1", wrong case) means OFF,
// the same convention as MEDIA_CALIBRATION_ENABLED. OFF pauses
// unrestricted direct messaging between organizations — Business ↔
// Business, Business ↔ Event / organizer, Business ↔ Location / venue — in
// every direction, so a commercial relationship can't simply move to
// another entity type. Enforced server-side (connect/actions.ts:
// messageBusiness, messageEventOrganizer, messageLocation, sendReply); the
// UI receives the same server-read value as a prop and only mirrors it.
// Nothing is deleted: historical threads stay readable, they just can't
// receive new org-to-org replies while the switch is off. To restore: set
// DIRECT_BUSINESS_MESSAGING_ENABLED=true in the deployment's environment
// and redeploy/restart — no code, data or schema change. Never read this on
// the client (it is not a NEXT_PUBLIC_ variable).
//
// NOT affected (Findmi-created or structured relationships, and consumers):
//   - structured Opportunity / event-participation threads (subject
//     "opportunity", or any thread an Opportunity is attached to):
//     invitations, applications, accept/decline, system messages AND
//     free-text replies;
//   - Findmi Opportunity listings (I'm Interested / Not for Us) — no
//     conversations involved at all;
//   - consumer ↔ organization inquiries (one organization + a person or
//     guest), including the organization's replies to the consumer;
//   - Findmi-mediated commercial requests (no organization participant).
export function isDirectBusinessMessagingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DIRECT_BUSINESS_MESSAGING_ENABLED === "true";
}

export const DIRECT_MESSAGING_PAUSED_MESSAGE =
  "Direct messages between businesses, events and venues are paused on Findmi. Commercial requests now go through Findmi.";

export type ThreadEntityType = "business" | "event" | "location" | "personal";

export interface ThreadMessagingFacts {
  subjectType: string | null;
  /** At least one Opportunity row points at this conversation. */
  hasOpportunity: boolean;
  parties: { entityType: ThreadEntityType; entityId: string | null }[];
}

const ORG_TYPES = new Set<ThreadEntityType>(["business", "event", "location"]);

/** Findmi-structured relationship: an Opportunity thread, or any thread an
 * Opportunity has been attached to (threads are reused per entity pair,
 * so the attachment — not only the subject — decides). */
export function isStructuredThread(facts: Pick<ThreadMessagingFacts, "subjectType" | "hasOpportunity">): boolean {
  return facts.subjectType === "opportunity" || facts.hasOpportunity;
}

/** Distinct organizations in a thread, optionally including the identity
 * about to send (so a member can't turn a consumer thread into an
 * org-to-org one by replying as a second organization). */
export function organizationKeys(
  parties: ThreadMessagingFacts["parties"],
  acting?: { entityType: ThreadEntityType; entityId: string | null }
): Set<string> {
  const keys = new Set<string>();
  for (const p of acting ? [...parties, acting] : parties) {
    if (ORG_TYPES.has(p.entityType) && p.entityId) keys.add(`${p.entityType}:${p.entityId}`);
  }
  return keys;
}

/** A direct org-to-org thread: two or more distinct organizations and no
 * Findmi structure. */
export function isDirectOrganizationThread(
  facts: ThreadMessagingFacts,
  acting?: { entityType: ThreadEntityType; entityId: string | null }
): boolean {
  return !isStructuredThread(facts) && organizationKeys(facts.parties, acting).size >= 2;
}

/** May `acting` post a free-text message into this thread right now?
 * `enabled` is the server-read switch (isDirectBusinessMessagingEnabled). */
export function canSendInThread(
  facts: ThreadMessagingFacts,
  acting: { entityType: ThreadEntityType; entityId: string | null },
  enabled: boolean
): boolean {
  if (enabled) return true;
  if (acting.entityType === "personal") return true;
  return !isDirectOrganizationThread(facts, acting);
}
