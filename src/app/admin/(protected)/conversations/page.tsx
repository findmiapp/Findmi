import Link from "next/link";
import { getAdminConversationList } from "@/lib/admin/conversations";
import { formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Unify Site-Wide Communications pass — the smallest admin visibility
 * into the canonical Conversation architecture (Business/Event/Venue
 * Inquiry, Findmi Sales, and direct MESSAGE). Read-only, recent-activity
 * only — see lib/admin/conversations.ts's own note on why this stays
 * small rather than becoming a moderation dashboard. */
export default async function AdminConversationsPage() {
  const conversations = await getAdminConversationList();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Conversations</h1>
      <p className="mt-1 text-sm text-ink/60">
        Recent platform communication — direct messages, Business/Event/Venue inquiries, and Findmi Sales — in one
        place. Not a second inbox: replies happen in each participant&rsquo;s own Findmi Messages.
      </p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Context</th>
              <th className="px-4 py-3">Participants</th>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Last Message</th>
              <th className="px-4 py-3">Messages</th>
              <th className="px-4 py-3">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {conversations.map((c) => (
              <tr key={c.id} className="align-top hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <Link href={`/admin/conversations/${c.id}`} className="font-semibold text-findmi-700">
                    {c.contextLabel}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink/70">{c.participantLabels.join(", ") || "—"}</td>
                <td className="px-4 py-3 text-ink/70">
                  {c.guestName ? (
                    <>
                      {c.guestName}
                      {c.guestEmail && <p className="text-xs text-ink/45">{c.guestEmail}</p>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 max-w-[280px] text-ink/70">{c.lastMessagePreview ?? "—"}</td>
                <td className="px-4 py-3 text-ink/50">{c.messageCount}</td>
                <td className="px-4 py-3 text-ink/50">{formatDateShort(c.createdAt)}</td>
              </tr>
            ))}
            {conversations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/50">
                  No conversations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
