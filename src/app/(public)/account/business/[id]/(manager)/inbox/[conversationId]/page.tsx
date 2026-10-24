import type { Metadata } from "next";
import { getManagerCore } from "../../../managerContext";
import ConversationThreadView from "@/app/(public)/account/messages/[id]/ConversationThreadView";
import { managerHref, originBack } from "@/lib/manager-links";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };
export const dynamic = "force-dynamic";

/** One Conversation inside a Business's Manager — the shared thread view,
 * with the Business shell kept and Back returning to this Business's Inbox
 * (or wherever it was opened from). The thread must involve this Business. */
export default async function BusinessThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; conversationId: string }>;
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { id, conversationId } = await params;
  const { error, from } = await searchParams;
  const { admin, user } = await getManagerCore(id);
  if (!user) return <p className="text-body text-muted">Open this conversation from Admin → Conversations.</p>;
  const back = originBack(id, from) ?? { href: managerHref(id, "inbox"), label: "Inbox" };
  return <ConversationThreadView admin={admin} userId={user.id} conversationId={conversationId} error={error} back={back} managerBusinessId={id} />;
}
