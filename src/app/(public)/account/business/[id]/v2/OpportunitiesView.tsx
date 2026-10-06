import Link from "next/link";
import type { OpportunityListItem } from "@/lib/opportunities";
import type { BusinessOpportunityItem } from "@/lib/opportunity-listings";
import { formatDateShort } from "@/lib/format";
import BusinessOpportunityCard from "@/components/opportunities/BusinessOpportunityCard";
import { respondToEventInvitation } from "../../actions";

/** Business Opportunities inbox — two separate systems, one page:
 *   Recommended For You — commercial Opportunities Findmi recommended to
 *     THIS Business (opportunity_recipients, Business-safe items only);
 *   Event Invitations & Applications — the existing Event participation
 *     workflow (lib/opportunities.ts), unchanged: same loaders and the same
 *     respondToEventInvitation action the Inbox's Opportunities filter uses. */
export default function OpportunitiesView({
  basePath,
  businessId,
  opportunities,
  recommended,
}: {
  basePath: string;
  businessId: string;
  opportunities: OpportunityListItem[];
  recommended: { active: BusinessOpportunityItem[]; past: BusinessOpportunityItem[] };
}) {
  const hrefFor = (item: BusinessOpportunityItem) => `${basePath}/opportunities/${item.view.recipientId}`;
  const total = recommended.active.length + recommended.past.length;
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="font-display text-page-title-lg font-bold text-primary">Opportunities</h1>
        <p className="mt-1 text-body text-muted">Opportunities Findmi recommends for your Business, plus your Event invitations and applications.</p>
      </div>

      <section aria-labelledby="recommended-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="recommended-heading" className="text-section-title font-bold text-primary">
            Recommended For You{total > 0 ? ` (${total})` : ""}
          </h2>
          <p className="mt-0.5 text-metadata text-muted">Opportunities Findmi thinks are a good fit for your Business.</p>
        </div>
        {total === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/12 bg-white px-5 py-7 text-center">
            <p className="text-card-title font-semibold text-primary">No recommendations yet.</p>
            <p className="mx-auto mt-1 max-w-sm text-metadata text-muted">Findmi will surface relevant Opportunities here when there&rsquo;s a fit.</p>
          </div>
        ) : (
          <>
            {recommended.active.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {recommended.active.map((item) => (
                  <BusinessOpportunityCard key={item.view.recipientId} item={item.view} place={item.place} href={hrefFor(item)} />
                ))}
              </div>
            )}
            {recommended.past.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="mt-2 text-label font-bold uppercase text-subtle">Past</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {recommended.past.map((item) => (
                    <BusinessOpportunityCard key={item.view.recipientId} item={item.view} place={item.place} href={hrefFor(item)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="event-participation-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="event-participation-heading" className="text-section-title font-bold text-primary">
            Event Invitations &amp; Applications
          </h2>
          <p className="mt-0.5 text-metadata text-muted">Event invitations and the events you&rsquo;ve applied to.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`${basePath}?tab=findmi-here&compose=1`}
            className="flex h-10 items-center rounded-full border border-black/10 bg-white px-4 text-button font-semibold text-secondary transition hover:border-black/20"
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
      </section>
    </div>
  );
}
