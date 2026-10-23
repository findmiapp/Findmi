import Link from "next/link";
import { notFound } from "next/navigation";
import BusinessAppShell from "../../v2/BusinessAppShell";
import ChevronIcon from "@/components/ChevronIcon";
import { TargetThumb } from "../../v2/TargetsView";
import { Chip } from "../../../../owner-ui";
import { loadBusinessShell } from "../../opportunities/loadBusinessShell";
import ReplyComposer from "@/app/(public)/account/messages/[id]/ReplyComposer";
import InquiryActions from "@/components/inquiries/InquiryActions";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { getConversationThread, markConversationRead } from "@/lib/opportunities";
import { getInquiryForBusiness } from "@/lib/commercial-inquiries";
import { INQUIRY_STATUS_LABELS, INQUIRY_STATUS_TONE, inquiryActionsFor, intentLabel } from "@/lib/commercial-inquiries-domain";
import { formatDateShort, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** One Commercial Inquiry, from one of the viewer's Businesses — the sender,
 * or the Business it was routed to. Shows who, why, where it stands, what has
 * been said, and the actions that party may take. The sender's private Target
 * is never shown to the other side (getInquiryForBusiness gives the Target id
 * to the sender only, for its own way back). */
export default async function InquiryDetailPage({ params }: { params: Promise<{ id: string; inquiryId: string }> }) {
  const { id, inquiryId } = await params;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/inquiries/${inquiryId}`);
  const admin = getAdminSupabase();
  if (!admin) notFound();
  const inquiry = await getInquiryForBusiness(admin, id, inquiryId);
  if (!inquiry) notFound();

  const user = membership.viaAdmin ? null : await getCurrentUser();
  const thread = inquiry.conversationId && user ? await getConversationThread(admin, inquiry.conversationId, user.id) : null;
  if (thread && user) await markConversationRead(admin, thread.id, user.id, [{ entityType: "business", entityId: id }]);

  const mayAct = !membership.viaAdmin && (membership.role === "owner" || membership.role === "manager");
  const actions = mayAct ? inquiryActionsFor(inquiry.role, inquiry.status) : [];
  const other = inquiry.role === "sender" ? inquiry.counterparty : inquiry.sender;
  const targetHref =
    inquiry.role === "sender" && inquiry.targetId
      ? `${shell.basePath}?tab=growth&view=targets&${inquiry.counterparty.kind === "location" ? `loc=${inquiry.counterparty.id}` : `tgt=${inquiry.targetId}`}`
      : null;
  const back = inquiry.role === "sender" ? (targetHref ?? `${shell.basePath}?tab=growth&view=targets`) : `${shell.basePath}#home-requests`;

  return (
    <BusinessAppShell {...shell} activeSection={inquiry.role === "sender" ? "growth" : "home"}>
      {/* The shell already pads for the phone bottom navigation (pb-28). */}
      <div className="flex max-w-3xl flex-col gap-4">
        <Link href={back} className="flex w-fit items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          <ChevronIcon direction="left" className="h-3 w-3" />
          {inquiry.role === "sender" ? (targetHref ? "Target" : "Targets") : "Home"}
        </Link>

        <header className="flex items-start gap-3">
          <TargetThumb imageUrl={other.imageUrl} kind={other.kind} />
          <div className="min-w-0 flex-1">
            <p className="text-label font-bold uppercase text-findmi-700">{inquiry.role === "sender" ? "Inquiry Sent" : "Inquiry Received"}</p>
            <h1 className="font-display text-card-title-lg font-bold leading-snug text-primary">{other.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={INQUIRY_STATUS_TONE[inquiry.status]}>{INQUIRY_STATUS_LABELS[inquiry.status]}</Chip>
              <span className="text-metadata font-semibold text-primary">{intentLabel(inquiry.intent)}</span>
            </div>
            {other.href && (
              <Link href={other.href} className="mt-1 inline-flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
                View {other.kind === "event" ? "Event" : other.kind === "location" ? "Place" : "Profile"} →
              </Link>
            )}
          </div>
        </header>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3 text-metadata min-[400px]:grid-cols-[auto_1fr]">
          <dt className="font-semibold text-muted">From</dt>
          <dd className="min-w-0 truncate text-primary">{inquiry.sender.name}</dd>
          <dt className="font-semibold text-muted">To</dt>
          <dd className="min-w-0 truncate text-primary">{inquiry.counterparty.name}</dd>
          <dt className="font-semibold text-muted">Sent</dt>
          <dd className="text-primary">{formatDateShort(inquiry.createdAt)}</dd>
          <dt className="font-semibold text-muted">With</dt>
          <dd className="text-primary">{inquiry.findmiOnly ? "Findmi (they're not on Findmi yet — Findmi will reach out)" : "Findmi is part of this conversation"}</dd>
        </dl>

        {actions.length > 0 && <InquiryActions inquiryId={inquiry.id} asEntity={{ entityType: "business", entityId: id }} actions={actions} />}
        {!mayAct && inquiry.status !== "withdrawn" && (
          <p className="text-metadata text-muted">{membership.viaAdmin ? "Viewing as a Findmi Admin — manage this Inquiry from Admin." : "Only an owner or manager can respond."}</p>
        )}

        <section aria-labelledby="inquiry-conversation" className="flex flex-col gap-3">
          <h2 id="inquiry-conversation" className="text-label font-bold uppercase text-subtle">
            Conversation
          </h2>
          {!thread ? (
            <p className="text-metadata text-muted">{membership.viaAdmin ? "Open this conversation from Admin → Commercial Inquiries." : "This conversation is being set up. Refresh in a moment."}</p>
          ) : (
            <>
              {thread.messages.map((m) =>
                m.kind === "system" ? (
                  <p key={m.id} className="text-center text-label font-semibold uppercase text-subtle">
                    {m.body}
                  </p>
                ) : (
                  <div key={m.id} className="max-w-[85%] rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-metadata font-bold text-primary">{m.senderLabel ?? "Findmi Member"}</p>
                      <p className="shrink-0 text-microcopy text-subtle">
                        {formatDateShort(m.createdAt)} · {formatTime(m.createdAt)}
                      </p>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line break-words text-body text-secondary">{m.body}</p>
                  </div>
                )
              )}
              <ReplyComposer conversationId={thread.id} parties={[{ entityType: "business", entityId: id, label: shell.business.name }]} />
            </>
          )}
        </section>
      </div>
    </BusinessAppShell>
  );
}
