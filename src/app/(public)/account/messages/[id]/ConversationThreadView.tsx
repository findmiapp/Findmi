import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getConversationThread,
  getUserManagedEntities,
  markConversationRead,
  type ConversationEntityType,
  type ConversationMessageItem,
  type ConversationOpportunityCard,
} from "@/lib/opportunities";
import { formatDateShort, formatTime } from "@/lib/format";
import ChevronIcon from "@/components/ChevronIcon";
import { respondToApplicationInThread, respondToInvitationInThread } from "@/app/(public)/connect/actions";
import ReplyComposer from "./ReplyComposer";
import { DIRECT_MESSAGING_PAUSED_MESSAGE, canSendInThread, isDirectBusinessMessagingEnabled } from "@/lib/communication-policy";
import { COMMERCIAL_INQUIRY_SUBJECT, INQUIRY_STATUS_LABELS, inquiryActionsFor, intentLabel } from "@/lib/commercial-inquiries-domain";
import { getInquiryByConversation, inquiryActorForEntity } from "@/lib/commercial-inquiries";
import InquiryActions from "@/components/inquiries/InquiryActions";
import { inboxTypeLabel, threadSourceLink } from "@/lib/inbox";

type TimelineItem =
  | { kind: "message"; createdAt: string; message: ConversationMessageItem }
  | { kind: "opportunity"; createdAt: string; opportunity: ConversationOpportunityCard };

/** One Conversation — the minimal real thread view: a single chronological
 * timeline mixing text / note / system messages with structured Opportunity
 * cards. Shared by the personal Inbox (/account/messages/[id]) and a Business
 * Manager's Inbox (/account/business/[id]/inbox/[conversationId]), so there is
 * ONE thread UI. Authorization is entirely getConversationThread's own live
 * re-derivation — a null result means "not found". Inside a Manager the thread
 * must involve that Business, and its context line links back to the source
 * (View Inquiry / View Opportunity / View Product). */
export default async function ConversationThreadView({
  admin,
  userId,
  conversationId: id,
  error,
  back,
  managerBusinessId,
}: {
  admin: SupabaseClient;
  userId: string;
  conversationId: string;
  error?: string;
  back: { href: string; label: string };
  /** Set when opened inside that Business's Manager. */
  managerBusinessId?: string;
}) {
  const [thread, managed] = await Promise.all([getConversationThread(admin, id, userId), getUserManagedEntities(admin, userId)]);
  if (!thread) notFound();
  // Opened inside a Business Manager: that Business must actually be a party,
  // otherwise this thread belongs to another context (the personal Inbox).
  if (managerBusinessId && !thread.parties.some((p) => p.entityType === "business" && p.entityId === managerBusinessId)) redirect(`/account/messages/${id}`);

  const myBusinessIds = new Set(managed.businesses.map((b) => b.id));
  const myEventIds = new Set(managed.events.map((e) => e.id));
  const myLocationIds = new Set(managed.locations.map((l) => l.id));

  // Every identity the viewer can reply AS in this specific thread — the
  // intersection of "who's a party to this conversation" and "who this
  // viewer currently manages." Personal participation is included only
  // when the viewer themselves is the personal participant.
  const myParties: { entityType: ConversationEntityType; entityId: string | null; label: string }[] = thread.parties.filter((p) => {
    if (p.entityType === "personal") return false; // personal isn't offered for this pass — see connect/actions.ts's own scope note
    if (p.entityType === "business") return p.entityId != null && myBusinessIds.has(p.entityId);
    if (p.entityType === "event") return p.entityId != null && myEventIds.has(p.entityId);
    if (p.entityType === "location") return p.entityId != null && myLocationIds.has(p.entityId);
    return false;
  });

  // Opening the thread marks it read for this viewer only (per participant).
  await markConversationRead(
    admin,
    id,
    userId,
    myParties.flatMap((p) => (p.entityId && (p.entityType === "business" || p.entityType === "event" || p.entityType === "location") ? [{ entityType: p.entityType, entityId: p.entityId }] : []))
  );

  const otherParties = thread.parties.filter((p) => !myParties.some((m) => m.entityType === p.entityType && m.entityId === p.entityId));
  // Unify Site-Wide Communications pass — a guest-originated inquiry has
  // no participant at all for the guest side (see createInquiryConversation),
  // so otherParties is empty; fall back to the guest's own name rather
  // than the generic "Conversation".
  const isFindmiRequest = thread.subjectType === "findmi_commercial_request";
  const messagingEnabled = isDirectBusinessMessagingEnabled();
  const title = isFindmiRequest ? "Findmi" : otherParties.map((p) => p.label).join(" & ") || thread.guestName || "Conversation";
  // Communication boundary — a direct org-to-org thread is read-only while
  // direct messaging is paused (history stays visible). Opportunity
  // threads and consumer threads keep their reply box.
  const replyPaused = myParties.length > 0 && myParties.every((p) => !canSendInThread(
    { subjectType: thread.subjectType, hasOpportunity: thread.opportunityCards.length > 0, parties: thread.parties },
    { entityType: p.entityType, entityId: p.entityId },
    messagingEnabled
  ));

  // Commercial Inquiry thread: what it is, where it stands, and — for the
  // entity it was routed to (or the sender) — its actions. Never the Target.
  const inquiry = thread.subjectType === COMMERCIAL_INQUIRY_SUBJECT ? await getInquiryByConversation(admin, id) : null;
  const inquiryRoles = inquiry
    ? myParties.flatMap((p) => {
        const role = p.entityId ? inquiryActorForEntity(inquiry, { entityType: p.entityType, entityId: p.entityId }) : null;
        return role && p.entityId ? [{ party: p, role }] : [];
      })
    : [];

  const source = threadSourceLink(thread.subjectType ?? "", thread.subjectId ?? "", managerBusinessId ?? null);

  const timeline: TimelineItem[] = [
    ...thread.messages.map((m): TimelineItem => ({ kind: "message", createdAt: m.createdAt, message: m })),
    ...thread.opportunityCards.map((o): TimelineItem => ({ kind: "opportunity", createdAt: o.createdAt, opportunity: o })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <>
      <Link href={back.href} className="inline-flex min-h-10 items-center gap-1 text-metadata font-semibold text-subtle hover:text-muted">
        <ChevronIcon direction="left" className="h-3 w-3" />
        {back.label}
      </Link>
      <h1 className="font-display text-page-title font-bold text-primary">{title}</h1>
      {/* Why this conversation exists, and the one thing it is about. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-metadata text-muted">
        <span className="font-semibold text-secondary">{[inboxTypeLabel(thread.subjectType ?? ""), inquiry ? intentLabel(inquiry.intent) : null].filter(Boolean).join(" · ")}</span>
        {source && (
          <Link href={source.href} className="flex min-h-10 items-center font-semibold text-accent hover:underline">
            {source.label}
          </Link>
        )}
      </p>
      {/* Unify Site-Wide Communications pass — a guest inquiry has no
          Findmi account to reply from (Phase 12's own "smallest safe V1"
          limitation), so their contact info is surfaced here instead —
          the way an authorized manager actually follows up. */}
      {isFindmiRequest ? (
        <p className="mt-1 text-metadata text-subtle">
          Sent to Findmi, not directly to the business. Findmi will review it and follow up
          {thread.guestEmail ? ` at ${thread.guestEmail}` : ""}.
        </p>
      ) : (
        thread.guestEmail && (
          <p className="mt-1 text-metadata text-subtle">
            Guest contact: {thread.guestEmail}
            {thread.guestPhone && ` · ${thread.guestPhone}`}
          </p>
        )
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-metadata text-red-600">{error}</p>}

      {inquiry && (
        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-black/[0.08] bg-white p-3.5">
          <p className="text-label font-bold uppercase text-findmi-700">Inquiry · {intentLabel(inquiry.intent)}</p>
          <p className="text-metadata text-muted">Status: {INQUIRY_STATUS_LABELS[inquiry.status]} · Findmi is part of this conversation.</p>
          {inquiryRoles.map(({ party, role }) =>
            party.entityType === "business" ? (
              <Link key={`${party.entityType}:${party.entityId}`} href={`/account/business/${party.entityId}/inquiries/${inquiry.id}`} className="w-fit text-metadata font-semibold text-accent hover:underline">
                Open Inquiry as {party.label} →
              </Link>
            ) : (
              <InquiryActions key={`${party.entityType}:${party.entityId}`} inquiryId={inquiry.id} asEntity={{ entityType: party.entityType, entityId: party.entityId as string }} actions={inquiryActionsFor(role, inquiry.status)} />
            )
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {timeline.length === 0 && <p className="text-body text-muted">No messages yet.</p>}
        {timeline.map((item) =>
          item.kind === "message" ? (
            <MessageBubble key={item.message.id} message={item.message} />
          ) : (
            <OpportunityCardView
              key={item.opportunity.id}
              opportunity={item.opportunity}
              conversationId={id}
              canRespondAsBusiness={myBusinessIds.has(item.opportunity.businessId)}
              canRespondAsOrganizer={myEventIds.has(item.opportunity.eventId)}
              inManager={managerBusinessId === item.opportunity.businessId}
            />
          )
        )}
      </div>

      <div className="mt-6">
        {replyPaused ? (
          <p className="rounded-xl bg-findmi-50 px-3.5 py-2.5 text-metadata leading-relaxed text-findmi-700">
            {DIRECT_MESSAGING_PAUSED_MESSAGE} This conversation stays here for your records.
          </p>
        ) : myParties.length > 0 ? (
          <ReplyComposer
            conversationId={id}
            parties={myParties.filter((p) =>
              canSendInThread(
                { subjectType: thread.subjectType, hasOpportunity: thread.opportunityCards.length > 0, parties: thread.parties },
                { entityType: p.entityType, entityId: p.entityId },
                messagingEnabled
              )
            )}
          />
        ) : (
          <p className="text-metadata text-subtle">You can view this conversation, but none of your current identities can reply here.</p>
        )}
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: ConversationMessageItem }) {
  if (message.kind === "system") {
    return <p className="text-center text-label font-semibold uppercase text-subtle">{message.body}</p>;
  }
  return (
    <div className={`max-w-[85%] rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm ${message.kind === "note" ? "bg-findmi-50/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-metadata font-bold text-primary">{message.senderLabel ?? "Findmi Member"}</p>
        <p className="shrink-0 text-microcopy text-subtle">
          {formatDateShort(message.createdAt)} · {formatTime(message.createdAt)}
        </p>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-body text-secondary">{message.body}</p>
    </div>
  );
}

const OPPORTUNITY_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
};

/** Structured cards — Section 6. Accept/Decline (Business side of an
 * invitation) and Approve/Decline (Event side of an application) both
 * bind straight to the existing canonical-participation/Appearance-sync/
 * Opportunity-resolution logic (see connect/actions.ts's own doc
 * comments) — no parallel decision logic lives here, this is presentation
 * only. */
function OpportunityCardView({
  opportunity,
  conversationId,
  canRespondAsBusiness,
  canRespondAsOrganizer,
  inManager,
}: {
  opportunity: ConversationOpportunityCard;
  conversationId: string;
  canRespondAsBusiness: boolean;
  canRespondAsOrganizer: boolean;
  /** Opened inside the invited Business's Manager: answers return there. */
  inManager: boolean;
}) {
  const isInvitation = opportunity.type === "event_invitation";
  const canRespond = opportunity.status === "pending" && (isInvitation ? canRespondAsBusiness : canRespondAsOrganizer);

  return (
    <div className="rounded-2xl border border-findmi/20 bg-findmi-50/50 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-label font-bold uppercase text-accent">
          {isInvitation ? "Event Invitation" : "Event Application"}
        </p>
        <span
          className={`shrink-0 text-label font-bold uppercase ${
            opportunity.status === "pending" ? "text-accent" : "text-subtle"
          }`}
        >
          {OPPORTUNITY_STATUS_LABEL[opportunity.status] ?? opportunity.status}
        </span>
      </div>
      <p className="mt-1 text-body font-semibold text-primary">
        {opportunity.businessName} {isInvitation ? "invited to" : "applied to"} {opportunity.eventName}
      </p>
      {opportunity.occurrenceStartAt && <p className="mt-0.5 text-metadata text-muted">{formatDateShort(opportunity.occurrenceStartAt)}</p>}

      {canRespond && (
        <div className="mt-2.5 flex items-center gap-4">
          {isInvitation ? (
            <>
              <form action={respondToInvitationInThread.bind(null, conversationId, opportunity.id, opportunity.businessId, "accepted", inManager)}>
                <button type="submit" className="text-metadata font-semibold text-accent hover:underline">
                  Accept
                </button>
              </form>
              <form action={respondToInvitationInThread.bind(null, conversationId, opportunity.id, opportunity.businessId, "declined", inManager)}>
                <button type="submit" className="text-metadata font-semibold text-muted hover:underline">
                  Decline
                </button>
              </form>
            </>
          ) : (
            <>
              <form action={respondToApplicationInThread.bind(null, conversationId, opportunity.eventId, opportunity.businessId, "approved")}>
                <button type="submit" className="text-metadata font-semibold text-accent hover:underline">
                  Approve
                </button>
              </form>
              <form action={respondToApplicationInThread.bind(null, conversationId, opportunity.eventId, opportunity.businessId, "declined")}>
                <button type="submit" className="text-metadata font-semibold text-muted hover:underline">
                  Decline
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
