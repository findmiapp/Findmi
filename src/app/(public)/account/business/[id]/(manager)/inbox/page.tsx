import type { Metadata } from "next";
import Link from "next/link";
import { getManagerCore, getShellExtras } from "../../managerContext";
import { listConversationsForUser, getPendingInvitationsForBusiness } from "@/lib/opportunities";
import { loadInboxView } from "@/lib/inbox-server";
import { managerHref, managerThreadHref } from "@/lib/manager-links";
import { formatDateShort } from "@/lib/format";
import { respondToEventInvitation } from "../../../actions";
import InboxScopeMenu, { type InboxScopeOption } from "@/components/inbox/InboxScopeMenu";
import InboxThreadList from "@/components/inbox/InboxThreadList";

export const metadata: Metadata = { title: "Inbox", robots: { index: false } };
export const dynamic = "force-dynamic";

/** A Business's Inbox — the unified Inbox scoped to THIS Business, inside its
 * Manager (the persistent shell stays: "Managing The Native Rose"). The same
 * Conversations as the personal Inbox, filtered to the ones this Business takes
 * part in; switching scope to another Business opens that Business's Manager
 * Inbox, and Personal / All open the personal Inbox. Event invitations are a
 * second view here because they're addressed to this Business. */
export default async function BusinessInboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const { view: viewParam } = await searchParams;
  const view = viewParam === "invitations" ? "invitations" : "conversations";
  const [core, extras] = await Promise.all([getManagerCore(id), getShellExtras()]);
  const { admin, user, business } = core;

  if (!user) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="font-display text-page-title font-bold text-primary">Inbox</h1>
        <p className="text-body text-muted">The Inbox belongs to each person on the team. Open this Business&rsquo;s conversations from Admin → Conversations.</p>
      </div>
    );
  }

  const businessIds = extras.managedBusinesses.map((b) => b.id);
  const [all, invitations] = await Promise.all([listConversationsForUser(admin, user.id), getPendingInvitationsForBusiness(admin, id)]);
  const inbox = await loadInboxView(admin, all, { kind: "business", businessId: id }, businessIds);
  const unread = inbox.counts.business[id] ?? 0;
  const scopes: InboxScopeOption[] = [
    { key: "all", label: "All", kind: "Everything you can see", href: "/account/messages", unread: inbox.counts.all },
    { key: "personal", label: "Personal", kind: "Just you", href: "/account/messages?scope=personal", unread: inbox.counts.personal },
    ...extras.managedBusinesses.map((b) => ({ key: `business:${b.id}`, label: b.name, kind: "Business", href: managerHref(b.id, "inbox"), unread: inbox.counts.business[b.id] ?? 0 })),
  ];
  const tab = (key: "conversations" | "invitations", label: string) => (
    <Link
      href={key === "conversations" ? managerHref(id, "inbox") : `${managerHref(id, "inbox")}?view=invitations`}
      aria-current={view === key ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-full px-3.5 text-label font-bold uppercase transition ${view === key ? "bg-ink text-white" : "bg-black/[0.04] text-muted hover:bg-black/[0.07]"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="font-display text-page-title font-bold text-primary">
          Inbox
          {unread > 0 && <span className="ml-2 align-middle text-label font-bold uppercase text-findmi-700">{unread} Unread</span>}
        </h1>
        <p className="mt-1 text-metadata text-muted">Conversations {business.name as string} is part of.</p>
      </div>
      <InboxScopeMenu current={`business:${id}`} options={scopes} />
      <div className="flex flex-wrap gap-1.5">
        {tab("conversations", "Conversations")}
        {tab("invitations", invitations.length ? `Event Invitations (${invitations.length})` : "Event Invitations")}
      </div>

      {view === "conversations" ? (
        <>
          <InboxThreadList
            rows={inbox.rows.map((c) => ({ ...c, href: managerThreadHref(id, c.id), viaLabel: null }))}
            empty="No conversations yet. Inquiries, Opportunities and messages to this Business will appear here."
          />
          {inbox.total > inbox.rows.length && <p className="text-metadata text-muted">Showing the {inbox.rows.length} most recent of {inbox.total}.</p>}
        </>
      ) : invitations.length === 0 ? (
        <p className="text-body text-muted">No event invitations waiting on {business.name as string}.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[0.06]">
          {invitations.map((o) => (
            <li key={o.id} className="py-3">
              <p className="truncate text-body font-semibold text-primary">{o.eventName}</p>
              <p className="mt-0.5 truncate text-metadata text-muted">
                Event Invitation{o.occurrenceStartAt ? ` · ${formatDateShort(o.occurrenceStartAt)}` : ""}
                {o.occurrenceLocationName ? ` · ${o.occurrenceLocationName}` : ""}
              </p>
              <div className="mt-1 flex items-center gap-4">
                <form action={respondToEventInvitation.bind(null, id, o.id, "accepted")}>
                  <button type="submit" className="flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
                    Accept
                  </button>
                </form>
                <form action={respondToEventInvitation.bind(null, id, o.id, "declined")}>
                  <button type="submit" className="flex min-h-10 items-center text-metadata font-semibold text-muted hover:underline">
                    Decline
                  </button>
                </form>
                {o.eventSlug && (
                  <Link href={`/event/${o.eventSlug}`} className="flex min-h-10 items-center text-metadata font-semibold text-accent hover:underline">
                    View Event
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
