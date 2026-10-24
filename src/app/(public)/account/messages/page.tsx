import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { listConversationsForUser, getPendingInvitationsForBusiness, getApplicationsForBusiness, type OpportunityListItem } from "@/lib/opportunities";
import { loadInboxView } from "@/lib/inbox-server";
import { parseInboxScope } from "@/lib/inbox";
import { managerHref } from "@/lib/manager-links";
import InboxScopeMenu, { type InboxScopeOption } from "@/components/inbox/InboxScopeMenu";
import InboxThreadList from "@/components/inbox/InboxThreadList";
import { CUSTOMER_SUBJECT_TYPES } from "@/lib/dashboard";
import { formatDateShort } from "@/lib/format";
import { respondToEventInvitation } from "../business/actions";
import { getPersonalDisplayName } from "@/lib/personalGraph";
import PersonalAppShell from "../PersonalAppShell";

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
  searchParams: Promise<{ filter?: string; scope?: string }>;
}) {
  const { filter: filterParam, scope: scopeParam } = await searchParams;
  const filter: InboxFilter = filterParam === "customers" || filterParam === "opportunities" ? filterParam : "all";

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/messages");

  const admin = getAdminSupabase();
  const [allConversations, displayName] = await Promise.all([
    admin ? listConversationsForUser(admin, user.id) : Promise.resolve([]),
    getPersonalDisplayName(supabase, user.id),
  ]);
  const { data: businessMemberships } = await supabase.from("business_members").select("business_id, businesses(name)").eq("user_id", user.id);
  type Row = { business_id: string; businesses: { name: string } | { name: string }[] | null };
  const businesses = ((businessMemberships ?? []) as Row[])
    .map((m) => {
      const b = Array.isArray(m.businesses) ? m.businesses[0] : m.businesses;
      return b ? { id: m.business_id, name: b.name } : null;
    })
    .filter((b): b is { id: string; name: string } => Boolean(b));

  // Unified Inbox — one Conversation list, scoped (lib/inbox). Here: All or
  // Personal; a Business scope opens that Business's Manager Inbox so its
  // context (and shell) stays. 'opportunity'-subject_type Conversations (a
  // note on an invitation/application) are excluded inside loadInboxView:
  // the structured Opportunity row below already represents them.
  const scope = parseInboxScope(scopeParam, []);
  const inbox = admin ? await loadInboxView(admin, allConversations, scope, businesses.map((b) => b.id)) : { rows: [], total: 0, counts: { all: 0, personal: 0, business: {} as Record<string, number> } };
  const conversations = inbox.rows;
  const customerConversations = conversations.filter((c) => CUSTOMER_SUBJECT_TYPES.has(c.subjectType));
  const scopes: InboxScopeOption[] = [
    { key: "all", label: "All", kind: "Everything you can see", href: "/account/messages", unread: inbox.counts.all },
    { key: "personal", label: "Personal", kind: "Just you", href: "/account/messages?scope=personal", unread: inbox.counts.personal },
    ...businesses.map((b) => ({ key: `business:${b.id}`, label: b.name, kind: "Business", href: managerHref(b.id, "inbox"), unread: inbox.counts.business[b.id] ?? 0 })),
  ];

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
  const showOpportunities = filter !== "customers" && scope.kind === "all";
  const conversationRows = filter === "customers" ? customerConversations : conversations;
  const unreadCount = scope.kind === "personal" ? inbox.counts.personal : inbox.counts.all;
  const totalCount = (showConversations ? conversationRows.length : 0) + (showOpportunities ? opportunities.length : 0);

  return (
    <PersonalAppShell displayName={displayName}>
      <h1 className="font-display text-page-title font-bold text-primary">
        Inbox
        {unreadCount > 0 && <span className="ml-2 align-middle text-label font-bold uppercase text-findmi-700">{unreadCount} Unread</span>}
      </h1>
      <p className="mt-1.5 text-body text-muted">Customers, organizers and event invitations that need your attention.</p>
      <div className="mt-4">
        <InboxScopeMenu current={scope.kind === "personal" ? "personal" : "all"} options={scopes} />
      </div>

      <div className="mt-5 flex gap-1.5">
        {(["all", "customers", "opportunities"] as const).map((f) => (
          <Link
            key={f}
            href={`/account/messages?${new URLSearchParams({ ...(f === "all" ? {} : { filter: f }), ...(scope.kind === "personal" ? { scope: "personal" } : {}) }).toString()}`}
            className={`rounded-full px-3.5 py-2 text-label font-bold uppercase transition ${
              filter === f ? "bg-ink text-white" : "bg-black/[0.04] text-muted hover:bg-black/[0.07]"
            }`}
          >
            {/* Query value stays "customers"/"opportunities" (no filter/
                route contract change) — only the visible labels change:
                "Messages" since CUSTOMER_SUBJECT_TYPES already covers direct
                messages too, not just inquiries; "Event Invitations" since
                this filter contains ONLY Event invitations/applications
                (the unrelated commercial Opportunities system) — calling
                this filter "Opportunities" let it collide with that other,
                commercial system (Opportunities Cleanup Pass A). */}
            {f === "all" ? "All" : f === "customers" ? "Messages" : "Event Invitations"}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {totalCount === 0 ? (
          <p className="text-body text-muted">
            {filter === "opportunities" ? "No event invitations right now." : filter === "customers" ? "No messages yet." : "Nothing here yet."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/[0.06]">
            {showConversations && conversationRows.length > 0 && (
              <li className="py-0">
                <InboxThreadList
                  rows={conversationRows.map((c) => ({ ...c, href: `/account/messages/${c.id}`, viaLabel: [c.myEntityLabel, c.productName].filter(Boolean).join(" · ") || null }))}
                  empty=""
                />
              </li>
            )}

            {showOpportunities &&
              opportunities.map((o) => (
                <li key={o.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-body font-semibold text-primary">{o.eventName}</p>
                      <p className="mt-0.5 truncate text-metadata text-muted">
                        {o.type === "event_invitation" ? "Event invitation" : "Event application"} · {o.businessName}
                      </p>
                      {o.occurrenceStartAt && <p className="mt-0.5 text-metadata text-muted">{formatDateShort(o.occurrenceStartAt)}</p>}
                    </div>
                    <span
                      className={`shrink-0 text-label font-semibold uppercase ${
                        o.status === "pending" ? "text-accent" : "text-subtle"
                      }`}
                    >
                      {o.status === "pending" ? "Pending" : o.status === "accepted" ? "Approved" : o.status === "declined" ? "Declined" : "Withdrawn"}
                    </span>
                  </div>
                  {o.type === "event_invitation" && o.status === "pending" && (
                    <div className="mt-2 flex items-center gap-4">
                      <form action={respondToEventInvitation.bind(null, o.businessId, o.id, "accepted")}>
                        <button type="submit" className="text-metadata font-semibold text-accent hover:underline">
                          Accept
                        </button>
                      </form>
                      <form action={respondToEventInvitation.bind(null, o.businessId, o.id, "declined")}>
                        <button type="submit" className="text-metadata font-semibold text-muted hover:underline">
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
    </PersonalAppShell>
  );
}
