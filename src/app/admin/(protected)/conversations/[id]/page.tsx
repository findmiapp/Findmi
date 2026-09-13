import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminConversationDetail } from "@/lib/admin/conversations";
import { formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Unify Site-Wide Communications pass — the full thread behind one row
 * of /admin/conversations. Read-only (no reply-as-admin action — admin
 * is an observer here, not a participant; a founder who needs to reply
 * as a Business/Event/Location does so from their own Findmi Messages,
 * same as any other manager). */
export default async function AdminConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversation = await getAdminConversationDetail(id);
  if (!conversation) notFound();

  return (
    <div>
      <Link href="/admin/conversations" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← Conversations
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">{conversation.contextLabel}</h1>
      <p className="mt-1 text-sm text-ink/60">
        Started {formatDateShort(conversation.createdAt)} · {conversation.participantLabels.join(", ") || "No entity participants"}
      </p>
      {conversation.guestName && (
        <p className="mt-1 text-sm text-ink/60">
          Guest: {conversation.guestName}
          {conversation.guestEmail && ` · ${conversation.guestEmail}`}
          {conversation.guestPhone && ` · ${conversation.guestPhone}`}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-2xl border p-4 ${m.kind === "system" ? "border-black/5 bg-black/[0.02] text-xs text-ink/50" : "border-black/10 bg-white"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
              {m.senderLabel ?? (m.kind === "system" ? "System" : "Unknown")} · {formatDateShort(m.createdAt)}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink/80">{m.body}</p>
          </div>
        ))}
        {conversation.messages.length === 0 && <p className="text-sm text-ink/50">No messages yet.</p>}
      </div>
    </div>
  );
}
