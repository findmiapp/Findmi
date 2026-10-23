// Commercial Inquiry v1 — the pure rules (no I/O; client + server).
//
//   Target   = a Business's PRIVATE intent (business_targets). Never shared.
//   Inquiry  = an explicit, outward request through Findmi to ONE counterparty
//              about ONE intent (commercial_inquiries). Shared with whoever is
//              safely resolved on the other side, and always with Findmi.
//   Conversation = communication about the Inquiry (the existing
//              conversations system; subject "commercial_inquiry").
//
// event_participation never becomes an Inquiry: it is the existing Event
// participation / application workflow. A Findmi Opportunity is answered on
// its own recipient thread; Orders stay Orders.
import { COMMERCIAL_INTENT_LABELS, INTENTS_BY_KIND, type CommercialIntent, type TargetKind } from "./commercial-intents";
import type { TargetStatus } from "./business-targets-domain";

/** conversations.subject_type for an Inquiry's thread (subject_id = the Inquiry). */
export const COMMERCIAL_INQUIRY_SUBJECT = "commercial_inquiry";

export const INQUIRY_STATUSES = ["sent", "responded", "accepted", "declined", "withdrawn", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  sent: "Sent",
  responded: "Responded",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
};
export const INQUIRY_STATUS_TONE: Record<InquiryStatus, "aqua" | "aquaSoft" | "amber" | "neutral"> = {
  sent: "amber",
  responded: "aquaSoft",
  accepted: "aqua",
  declined: "neutral",
  withdrawn: "neutral",
  closed: "neutral",
};
/** Still awaiting an outcome. */
export const OPEN_INQUIRY_STATUSES: readonly InquiryStatus[] = ["sent", "responded"];
export const isOpenInquiry = (s: InquiryStatus) => OPEN_INQUIRY_STATUSES.includes(s);
export const isInquiryStatus = (v: unknown): v is InquiryStatus => typeof v === "string" && (INQUIRY_STATUSES as readonly string[]).includes(v);

export const INQUIRY_MESSAGE_MAX = 2000;

/** The intents an Inquiry may carry for a counterparty kind: the canonical
 * compatibility matrix, minus event_participation (its own workflow). */
export const INQUIRY_INTENTS_BY_KIND: Record<TargetKind, readonly CommercialIntent[]> = {
  location: INTENTS_BY_KIND.location.filter((i) => i !== "event_participation"),
  business: INTENTS_BY_KIND.business.filter((i) => i !== "event_participation"),
  event: INTENTS_BY_KIND.event.filter((i) => i !== "event_participation"),
};

/** event_participation on an Event goes to the existing participation flow. */
export function inquiryRouteFor(kind: TargetKind, intent: CommercialIntent): "inquiry" | "event_participation" | "incompatible" {
  if (kind === "event" && intent === "event_participation") return "event_participation";
  return INQUIRY_INTENTS_BY_KIND[kind].includes(intent) ? "inquiry" : "incompatible";
}

/** The Inquire composer's intent choices for a Target: its own compatible
 * intents (in canonical order), preselected when there is exactly one; all
 * compatible intents, none preselected, when the Target has none. */
export function inquiryIntentChoices(kind: TargetKind, targetIntents: readonly CommercialIntent[]): { choices: CommercialIntent[]; preselected: CommercialIntent | null; participation: boolean } {
  const fromTarget = INQUIRY_INTENTS_BY_KIND[kind].filter((i) => targetIntents.includes(i));
  const choices = fromTarget.length ? fromTarget : [...INQUIRY_INTENTS_BY_KIND[kind]];
  return { choices, preselected: fromTarget.length === 1 ? fromTarget[0] : null, participation: kind === "event" && targetIntents.includes("event_participation") };
}

export function validateInquiryInput(input: { kind: TargetKind; intent: unknown; message: unknown }): { ok: true; intent: CommercialIntent; message: string } | { ok: false; error: string } {
  const intent = input.intent as CommercialIntent;
  const route = typeof input.intent === "string" && input.intent in COMMERCIAL_INTENT_LABELS ? inquiryRouteFor(input.kind, intent) : "incompatible";
  if (route === "event_participation") return { ok: false, error: "Event participation goes through the Event's own application, not an Inquiry." };
  if (route === "incompatible") return { ok: false, error: "Choose one intent that fits." };
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { ok: false, error: "Add a short message so they know what you have in mind." };
  if (message.length > INQUIRY_MESSAGE_MAX) return { ok: false, error: `Keep the message under ${INQUIRY_MESSAGE_MAX.toLocaleString()} characters.` };
  return { ok: true, intent, message };
}

// ── Who may move an Inquiry ───────────────────────────────────────────────

export type InquiryActor = "sender" | "counterparty" | "findmi";

const MOVES: Record<InquiryActor, readonly InquiryStatus[]> = {
  sender: ["withdrawn"],
  counterparty: ["accepted", "declined"],
  findmi: ["accepted", "declined", "closed"],
};

/** Explicit outcomes only, and only while open. "responded" is never chosen —
 * it follows the first reply from the other side or Findmi. */
export function canMoveInquiry(actor: InquiryActor, from: InquiryStatus, to: InquiryStatus): boolean {
  return isOpenInquiry(from) && MOVES[actor].includes(to);
}

/** The outcome actions a viewer gets, in display order. */
export function inquiryActionsFor(actor: InquiryActor | null, status: InquiryStatus): InquiryStatus[] {
  return actor && isOpenInquiry(status) ? [...MOVES[actor]] : [];
}

/** The first reply from the other side (or Findmi) moves Sent → Responded.
 * A sender's own follow-up, a view, or a later reply changes nothing. */
export function statusAfterReply(status: InquiryStatus, by: InquiryActor): InquiryStatus {
  return status === "sent" && by !== "sender" ? "responded" : status;
}

/** Sending an Inquiry may move the private Target from Target to In
 * Conversation — never from any other state (never Passed, never Active). */
export function targetStatusAfterInquiry(status: TargetStatus): TargetStatus | null {
  return status === "target" ? "in_conversation" : null;
}

// ── Copy ──────────────────────────────────────────────────────────────────

export const intentLabel = (intent: CommercialIntent) => COMMERCIAL_INTENT_LABELS[intent];

/** The thread's history lines (system messages: no sender). */
export function inquiryHistoryLine(event: "sent" | InquiryStatus, names: { sender: string; counterparty: string }, intent: CommercialIntent): string {
  switch (event) {
    case "sent":
      return `${names.sender} sent an Inquiry to ${names.counterparty} about ${intentLabel(intent)}.`;
    case "accepted":
      return "Inquiry accepted.";
    case "declined":
      return "Inquiry declined.";
    case "withdrawn":
      return `${names.sender} withdrew this Inquiry.`;
    case "closed":
      return "Findmi closed this Inquiry.";
    default:
      return "";
  }
}

/** Email copy. Never includes anything from the private Target. */
export function inquiryEmail(kind: "received" | "accepted" | "declined" | "withdrawn" | "closed", names: { sender: string; counterparty: string }, intent: CommercialIntent): { subject: string; heading: string; body: string } {
  const what = intentLabel(intent);
  switch (kind) {
    case "received":
      return { subject: `New Inquiry from ${names.sender} on Findmi`, heading: `${names.sender} sent an Inquiry`, body: `${names.sender} would like to talk about ${what} with ${names.counterparty}. Findmi is part of the conversation.` };
    case "accepted":
      return { subject: `Inquiry accepted: ${names.counterparty}`, heading: "Your Inquiry was accepted", body: `Your ${what} Inquiry with ${names.counterparty} was accepted. Continue the conversation on Findmi.` };
    case "declined":
      return { subject: `Inquiry declined: ${names.counterparty}`, heading: "Your Inquiry was declined", body: `Your ${what} Inquiry with ${names.counterparty} was declined. The conversation stays on Findmi for your records.` };
    case "withdrawn":
      return { subject: `Inquiry withdrawn: ${names.sender}`, heading: "An Inquiry was withdrawn", body: `${names.sender} withdrew its ${what} Inquiry. The conversation stays on Findmi for your records.` };
    case "closed":
      return { subject: `Inquiry closed: ${names.sender} → ${names.counterparty}`, heading: "Findmi closed an Inquiry", body: `Findmi closed the ${what} Inquiry between ${names.sender} and ${names.counterparty}.` };
  }
}
