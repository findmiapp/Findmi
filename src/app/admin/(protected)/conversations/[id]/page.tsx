import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminConversationDetail } from "@/lib/admin/conversations";
import { formatDateShort, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Communications Dashboard pass — the full thread behind one row of
 * /admin/conversations. Read-only, always (Step 10's own explicit rule):
 * no reply-as-participant, no edit, no delete — a founder who needs to
 * reply as a Business/Event/Location does so from their own Findmi
 * Messages; a Findmi Sales lead is followed up on directly outside
 * Findmi (see the View Sales Inquiry link), not from an admin reply
 * button here. */
export default async function AdminConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversation = await getAdminConversationDetail(id);
  if (!conversation) notFound();

  return (
    <div>
      <Link href="/admin/conversations" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Communications
      </Link>

      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-findmi-700">{conversation.typeLabel}</p>
      <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
        {conversation.senderLabel ?? conversation.participantLabels[0] ?? "Findmi Member"}
        {conversation.recipientLabel && (
          <>
            <span className="mx-2 text-ink/30">→</span>
            {conversation.recipientLabel}
          </>
        )}
      </h1>
      {conversation.contextLine && <p className="mt-1 text-sm font-medium text-ink/60">{conversation.contextLine}</p>}
      <p className="mt-1 text-xs text-ink/40">
        Started {formatDateShort(conversation.createdAt)} · {formatTime(conversation.createdAt)}
      </p>

      {conversation.guestEmail && (
        <p className="mt-2 text-sm text-ink/60">
          Guest contact: {conversation.guestEmail}
          {conversation.guestPhone && ` · ${conversation.guestPhone}`}
        </p>
      )}
      {conversation.participantLabels.length > 0 && (
        <p className="mt-1 text-xs text-ink/40">Participants: {conversation.participantLabels.join(", ")}</p>
      )}
      {conversation.entityLink && (
        <Link
          href={conversation.entityLink.href}
          className="mt-3 inline-block rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
        >
          {conversation.entityLink.label}
        </Link>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-2xl border p-4 ${m.kind === "system" ? "border-black/5 bg-black/[0.02] text-xs text-ink/50" : "border-black/10 bg-white"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
              {m.senderLabel ?? (m.kind === "system" ? "System" : "Unknown")} · {formatDateShort(m.createdAt)} ·{" "}
              {formatTime(m.createdAt)}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink/80">{m.body}</p>
          </div>
        ))}
        {conversation.messages.length === 0 && <p className="text-sm text-ink/50">No messages yet.</p>}
      </div>
    </div>
  );
}
