import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import {
  getConversationThread,
  getUserManagedEntities,
  type ConversationEntityType,
  type ConversationMessageItem,
  type ConversationOpportunityCard,
} from "@/lib/opportunities";
import { formatDateShort, formatTime } from "@/lib/format";
import { respondToApplicationInThread, respondToInvitationInThread } from "@/app/(public)/connect/actions";
import AccountNav from "../../AccountNav";
import ReplyComposer from "./ReplyComposer";

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type TimelineItem =
  | { kind: "message"; createdAt: string; message: ConversationMessageItem }
  | { kind: "opportunity"; createdAt: string; opportunity: ConversationOpportunityCard };

/** Public Messaging V1, Section 4/6 — the minimal real Conversation view:
 * a single chronological timeline mixing freeform text/note/system
 * messages with structured Opportunity cards (Section 9's own requirement
 * that the two "coexist in the same Conversation" — never a separate tab
 * for one or the other). Authorization is entirely getConversationThread's
 * own live re-derivation (Section 14) — a null result here means "not
 * found," same as a missing row, never a partial/redacted render. */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/messages/${id}`)}`);

  const admin = getAdminSupabase();
  if (!admin) notFound();

  const [thread, managed] = await Promise.all([getConversationThread(admin, id, user.id), getUserManagedEntities(admin, user.id)]);
  if (!thread) notFound();

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

  const otherParties = thread.parties.filter((p) => !myParties.some((m) => m.entityType === p.entityType && m.entityId === p.entityId));
  const title = otherParties.map((p) => p.label).join(" & ") || "Conversation";

  const timeline: TimelineItem[] = [
    ...thread.messages.map((m): TimelineItem => ({ kind: "message", createdAt: m.createdAt, message: m })),
    ...thread.opportunityCards.map((o): TimelineItem => ({ kind: "opportunity", createdAt: o.createdAt, opportunity: o })),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <Link href="/account/messages" className="text-xs font-semibold text-ink/40 hover:text-ink/70">
        ← Messages
      </Link>
      <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-red-600">{error}</p>}

      <div className="mt-6 flex flex-col gap-3">
        {timeline.length === 0 && <p className="text-sm text-ink/50">No messages yet.</p>}
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
            />
          )
        )}
      </div>

      <div className="mt-6">
        {myParties.length > 0 ? (
          <ReplyComposer conversationId={id} parties={myParties} />
        ) : (
          <p className="text-xs text-ink/40">You can view this conversation, but none of your current identities can reply here.</p>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessageItem }) {
  if (message.kind === "system") {
    return <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink/35">{message.body}</p>;
  }
  return (
    <div className={`max-w-[85%] rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm ${message.kind === "note" ? "bg-findmi-50/40" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-ink">{message.senderLabel ?? "Findmi Member"}</p>
        <p className="shrink-0 text-[10px] text-ink/35">
          {formatDateShort(message.createdAt)} · {formatTime(message.createdAt)}
        </p>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-sm text-ink/75">{message.body}</p>
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
}: {
  opportunity: ConversationOpportunityCard;
  conversationId: string;
  canRespondAsBusiness: boolean;
  canRespondAsOrganizer: boolean;
}) {
  const isInvitation = opportunity.type === "event_invitation";
  const canRespond = opportunity.status === "pending" && (isInvitation ? canRespondAsBusiness : canRespondAsOrganizer);

  return (
    <div className="rounded-2xl border border-findmi/20 bg-findmi-50/50 p-3.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">
        {isInvitation ? "Event Invitation" : "Event Application"}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink">
        {opportunity.businessName} {isInvitation ? "invited to" : "applied to"} {opportunity.eventName}
      </p>
      {opportunity.occurrenceStartAt && <p className="mt-0.5 text-xs text-ink/50">{formatDateShort(opportunity.occurrenceStartAt)}</p>}
      <p className="mt-1.5 inline-block rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/55">
        {OPPORTUNITY_STATUS_LABEL[opportunity.status] ?? opportunity.status}
      </p>

      {canRespond && (
        <div className="mt-3 flex gap-2">
          {isInvitation ? (
            <>
              <form action={respondToInvitationInThread.bind(null, conversationId, opportunity.id, opportunity.businessId, "accepted")}>
                <button type="submit" className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                  Accept
                </button>
              </form>
              <form action={respondToInvitationInThread.bind(null, conversationId, opportunity.id, opportunity.businessId, "declined")}>
                <button type="submit" className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/60 transition hover:border-black/20">
                  Decline
                </button>
              </form>
            </>
          ) : (
            <>
              <form action={respondToApplicationInThread.bind(null, conversationId, opportunity.eventId, opportunity.businessId, "approved")}>
                <button type="submit" className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                  Approve
                </button>
              </form>
              <form action={respondToApplicationInThread.bind(null, conversationId, opportunity.eventId, opportunity.businessId, "declined")}>
                <button type="submit" className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/60 transition hover:border-black/20">
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
