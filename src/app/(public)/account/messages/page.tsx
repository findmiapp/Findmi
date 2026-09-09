import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser } from "@/lib/opportunities";
import { formatDateShort } from "@/lib/format";
import NavIcon from "@/components/NavIcon";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Public Messaging V1, Section 11 — the compact Messages entry point in
 * the signed-in account experience: latest conversations, the other
 * party's name, a last-message preview, and last-activity timestamp.
 * Deliberately no folders/search/unread count (explicitly out of scope
 * this pass) — a single flat, newest-first list, same "one unified list"
 * discipline the rest of Account Hub already uses (see ManageOnFindmiList). */
export default async function MessagesPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/messages");

  const admin = getAdminSupabase();
  const conversations = admin ? await listConversationsForUser(admin, user.id) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Messages</h1>
      <p className="mt-1.5 text-sm text-ink/50">Conversations with businesses, organizers, and venues on Findmi.</p>

      {conversations.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm sm:p-8">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
            <NavIcon name="bookmark" className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-ink">Your Findmi conversations will appear here</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink/50">
            Connect with an organizer, business, or venue from their Findmi page to start one.
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/account/messages/${c.id}`}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-findmi-50 text-xs font-bold uppercase text-findmi-700">
                {c.otherPartyLabel.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.otherPartyLabel}</p>
                <p className="mt-0.5 truncate text-xs text-ink/50">{c.lastMessageBody || "No messages yet"}</p>
              </div>
              <p className="shrink-0 text-[11px] text-ink/40">{formatDateShort(c.lastActivityAt)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
