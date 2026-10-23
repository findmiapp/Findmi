// Opportunity Relationship Thread — pure rules (no I/O). The recipient row
// (opportunity_recipients) stays the one workflow record; these only decide
// what its Business ↔ Findmi thread says and who is told.
import type { RecipientStatus } from "./opportunity-listings-domain";

/** conversations.subject_type for a commercial Opportunity recipient thread
 * (subject_id = the recipient row). Distinct from the event-participation
 * "opportunity" subject so the two Opportunity systems never blur. */
export const COMMERCIAL_OPPORTUNITY_SUBJECT = "commercial_opportunity";

/** The history line for a recipient moving INTO `status`. `by` says whether
 * the Business answered or Findmi moved it — the same status can come from
 * either (e.g. Findmi reverting a Confirmed relationship to Interested). */
export function recipientStatusMessage(status: RecipientStatus, businessName: string, by: "business" | "findmi"): string {
  if (by === "business") {
    if (status === "interested") return `${businessName} is interested.`;
    if (status === "not_interested") return `${businessName} is not interested.`;
  }
  switch (status) {
    case "offered":
      return `Opportunity sent to ${businessName}.`;
    case "interested":
      return "Findmi moved this Opportunity back to Interested.";
    case "not_interested":
      return `${businessName} is not interested.`;
    case "confirmed":
      return "Findmi confirmed this Opportunity.";
    case "completed":
      return "Findmi marked this Opportunity completed.";
    case "cancelled":
      return "Findmi cancelled this Opportunity.";
    case "withdrawn":
      return "Findmi withdrew this Opportunity.";
  }
}

/** Findmi outcomes the Business must hear about by email (sending already
 * emails; a Business's own answer needs no email to itself). */
export function businessNotificationForAdminStatus(status: RecipientStatus, listingTitle: string): { subject: string; heading: string; body: string } | null {
  if (status === "confirmed")
    return { subject: `Confirmed: ${listingTitle}`, heading: "Findmi confirmed your Opportunity", body: `Findmi confirmed "${listingTitle}" with your Business. Open the Opportunity to see the details and message Findmi.` };
  if (status === "cancelled")
    return { subject: `Cancelled: ${listingTitle}`, heading: "Findmi cancelled an Opportunity", body: `Findmi cancelled "${listingTitle}". Open the Opportunity to see the conversation.` };
  if (status === "withdrawn")
    return { subject: `Withdrawn: ${listingTitle}`, heading: "Findmi withdrew an Opportunity", body: `Findmi withdrew "${listingTitle}" from your Business. Your conversation with Findmi stays in Messages.` };
  return null;
}

/** When a thread is created for a recipient that already moved on, its
 * history is seeded from the recipient's own timestamps: the send, then the
 * current state (if past "offered") at the time it happened. A Business that
 * raised its hand from Explore was never sent anything (its row is created
 * already answered — responded_at = offered_at), so it gets no "sent" line. */
export function seedRecipientHistory(recipient: {
  status: RecipientStatus;
  offered_at: string;
  responded_at: string | null;
  status_changed_at: string;
  businessName: string;
}): { body: string; createdAt: string }[] {
  const selfInitiated = recipient.responded_at !== null && recipient.responded_at === recipient.offered_at;
  const seed = selfInitiated ? [] : [{ body: recipientStatusMessage("offered", recipient.businessName, "findmi"), createdAt: recipient.offered_at }];
  if (recipient.status === "offered") return seed;
  const byBusiness = (recipient.status === "interested" || recipient.status === "not_interested") && recipient.responded_at !== null && recipient.responded_at >= recipient.status_changed_at;
  seed.push({ body: recipientStatusMessage(recipient.status, recipient.businessName, byBusiness ? "business" : "findmi"), createdAt: recipient.status_changed_at });
  return seed;
}
