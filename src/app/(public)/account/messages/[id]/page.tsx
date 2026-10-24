import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getPersonalDisplayName } from "@/lib/personalGraph";
import PersonalAppShell from "../../PersonalAppShell";
import ConversationThreadView from "./ConversationThreadView";

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** A Conversation in the personal Inbox. The thread itself is the shared
 * ConversationThreadView (also used inside a Business Manager's Inbox). */
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
  const displayName = await getPersonalDisplayName(supabase, user.id);

  return (
    <PersonalAppShell displayName={displayName}>
      <ConversationThreadView admin={admin} userId={user.id} conversationId={id} error={error} back={{ href: "/account/messages", label: "Inbox" }} />
    </PersonalAppShell>
  );
}
