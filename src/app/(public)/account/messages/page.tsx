import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser, getPendingInvitationsForBusiness, getApplicationsForBusiness, type OpportunityListItem } from "@/lib/opportunities";
import { conversationContextLabel } from "@/lib/admin/conversations";
import { CUSTOMER_SUBJECT_TYPES } from "@/lib/dashboard";
import { formatDateShort } from "@/lib/format";
import { respondToEventInvitation } from "../business/actions";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Inbox",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type InboxFilter = "all" | "customers" | "opportunities";

/** Launch V2 Pass 1 — turns the plain Messages list into the owner's
 * Inbox: ALL / CUSTOMERS / OPPORTUNITIES over the SAME two already-
 * canonical systems (Conversations, Opportunities), unified only at
 * presentation — no merged table, no new query beyond one more
 * per-business Opportunities read (the same getPendingInvitationsForBusiness/
 * getApplicationsForBusiness the Business Manager's own Opportunities tab
 * already calls, just looped across every managed business here instead
 * of one). Route/table names are unchanged (still /account/messages,
 * still `conversations`); only the user-facing heading and terminology
 * become "Inbox."
 *
 * Unified Inbox V3 — visual-only pass on top of the same architecture:
 * flat divided rows instead of a card per conversation/opportunity, and
 * the "Customers" filter is relabeled "Messages" (its underlying set —
 * CUSTOMER_SUBJECT_TYPES — already includes non-inquiry direct messages
 * too, so "Messages" is the more truthful label; the filter's query value
 * and membership are unchanged, this is presentation only). */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: filterParam } = await searchParams;
  const filter: InboxFilter = filterParam === "customers" || filterParam === "opportunities" ? filterParam : "all";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/messages");

  const admin = getAdminSupabase();
  const allConversations = admin ? await listConversationsForUser(admin, user.id) : [];
  // 'opportunity'-subject_type Conversations (created only when a note is
  // attached to an invitation/application — see lib/opportunities.ts's
  // own createOpportunity) are deliberately excluded from BOTH lists
  // below: that same interaction is already represented, without
  // duplication, by the structured Opportunity row itself further down.
  const conversations = allConversations.filter((c) => c.subjectType !== "opportunity");
  const customerConversations = conversations.filter((c) => CUSTOMER_SUBJECT_TYPES.has(c.subjectType));

  const { data: businessMemberships } = await supabase.from("business_members").select("business_id, businesses(name)").eq("user_id", user.id);
  type Row = { business_id: string; businesses: { name: string } | { name: string }[] | null };
  const businesses = ((businessMemberships ?? []) as Row[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: m.business_id, name: b.name } : null;
    })
    .filter((b): b is { id: string; name: string } => Boolean(b));

  let invitations: OpportunityListItem[] = [];
  let applications: OpportunityListItem[] = [];
  if (admin && businesses.length > 0) {
    const [invByBusiness, appByBusiness] = await Promise.all([
      Promise.all(businesses.map((b) => getPendingInvitationsForBusiness(admin, b.id))),
      Promise.all(businesses.map((b) => getApplicationsForBusiness(admin, b.id))),
    ]);
    invitations = invByBusiness.flat();
    applications = appByBusiness.flat();
  }
  const opportunities = [...invitations, ...applications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const showConversations = filter !== "opportunities";
  const showOpportunities = filter !== "customers";
  const conversationRows = filter === "customers" ? customerConversations : conversations;
  const totalCount = (showConversations ? conversationRows.length : 0) + (showOpportunities ? opportunities.length : 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Inbox</h1>
      <p className="mt-1.5 text-sm text-ink/50">Customers, organizers and opportunities that need your attention.</p>

      <div className="mt-5 flex gap-1.5">
        {(["all", "customers", "opportunities"] as const).map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/account/messages" : `/account/messages?filter=${f}`}
            className={`rounded-full px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition ${
              filter === f ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
            }`}
          >
            {/* Query value stays "customers" (no filter/route contract
                change) — only the visible label becomes "Messages", since
                CUSTOMER_SUBJECT_TYPES already covers direct messages too,
                not just inquiries. */}
            {f === "all" ? "All" : f === "customers" ? "Messages" : "Opportunities"}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {totalCount === 0 ? (
          <p className="text-sm text-ink/50">
            {filter === "opportunities" ? "No opportunities right now." : filter === "customers" ? "No messages yet." : "Nothing here yet."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {showConversations &&
              conversationRows.map((c) => (
                <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/account/messages/${c.id}`} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{c.otherPartyLabel}</p>
                      <p className="mt-0.5 truncate text-xs text-ink/50">
                        {[conversationContextLabel(c.subjectType), c.myEntityLabel, c.productName].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink/60">{c.lastMessageBody || "No messages yet"}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-ink/40">{formatDateShort(c.lastActivityAt)}</span>
                  </Link>
                </li>
              ))}

            {showOpportunities &&
              opportunities.map((o) => (
                <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{o.eventName}</p>
                      <p className="mt-0.5 truncate text-xs text-ink/50">
                        {o.type === "event_invitation" ? "Event invitation" : "Event application"} · {o.businessName}
                      </p>
                      {o.occurrenceStartAt && <p className="mt-0.5 text-xs text-ink/60">{formatDateShort(o.occurrenceStartAt)}</p>}
                    </div>
                    <span
                      className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${
                        o.status === "pending" ? "text-findmi-700" : "text-ink/40"
                      }`}
                    >
                      {o.status === "pending" ? "Pending" : o.status === "accepted" ? "Approved" : o.status === "declined" ? "Declined" : "Withdrawn"}
                    </span>
                  </div>
                  {o.type === "event_invitation" && o.status === "pending" && (
                    <div className="mt-2 flex items-center gap-4">
                      <form action={respondToEventInvitation.bind(null, o.businessId, o.id, "accepted")}>
                        <button type="submit" className="text-xs font-semibold text-findmi-700 hover:underline">
                          Accept
                        </button>
                      </form>
                      <form action={respondToEventInvitation.bind(null, o.businessId, o.id, "declined")}>
                        <button type="submit" className="text-xs font-semibold text-ink/50 hover:underline">
                          Decline
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
