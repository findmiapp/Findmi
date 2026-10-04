import Link from "next/link";
import type { OpportunityListItem } from "@/lib/opportunities";
import { formatDateShort } from "@/lib/format";
import { respondToEventInvitation } from "../../actions";

/** /account V2, Pass 1 — Opportunities inside the Business context: this
 * Business's own event invitations and applications, from the same
 * loaders and the same respondToEventInvitation action the Inbox's
 * Opportunities filter already uses (Inbox stays the account-wide view). */
export default function OpportunitiesView({
  basePath,
  businessId,
  opportunities,
}: {
  basePath: string;
  businessId: string;
  opportunities: OpportunityListItem[];
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="font-display text-page-title-lg font-bold text-primary">Opportunities</h1>
        <p className="mt-1 text-body text-muted">Event invitations and the events you&rsquo;ve applied to.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`${basePath}?tab=findmi-here&compose=1`}
          className="flex h-10 items-center rounded-full bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600"
        >
          Find an event to join
        </Link>
        <Link
          href="/account/messages?filter=opportunities"
          className="flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-secondary transition hover:border-black/20"
        >
          Open in Inbox
        </Link>
      </div>

      {opportunities.length === 0 ? (
        <p className="text-body text-muted">No invitations or applications right now.</p>
      ) : (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
          {opportunities.map((o) => (
            <li key={o.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/event/${o.eventSlug}`} className="block truncate text-card-title font-semibold text-primary hover:underline">
                    {o.eventName}
                  </Link>
                  <p className="mt-0.5 truncate text-metadata text-muted">
                    {o.type === "event_invitation" ? "Invitation" : "Application"}
                    {o.occurrenceStartAt ? ` · ${formatDateShort(o.occurrenceStartAt)}` : ""}
                    {o.occurrenceLocationName ? ` · ${o.occurrenceLocationName}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 text-label font-bold uppercase ${o.status === "pending" ? "text-accent" : "text-subtle"}`}>
                  {o.status === "pending" ? "Pending" : o.status === "accepted" ? "Approved" : o.status === "declined" ? "Declined" : "Withdrawn"}
                </span>
              </div>
              {o.type === "event_invitation" && o.status === "pending" && (
                <div className="mt-2.5 flex items-center gap-2">
                  <form action={respondToEventInvitation.bind(null, businessId, o.id, "accepted")}>
                    <button type="submit" className="flex h-9 items-center rounded-full bg-findmi px-4 text-metadata font-bold text-white transition hover:bg-findmi-600">
                      Accept
                    </button>
                  </form>
                  <form action={respondToEventInvitation.bind(null, businessId, o.id, "declined")}>
                    <button type="submit" className="flex h-9 items-center rounded-full border border-black/10 px-4 text-metadata font-semibold text-muted transition hover:border-black/20">
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
  );
}
