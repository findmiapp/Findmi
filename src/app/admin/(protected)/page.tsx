import Link from "next/link";
import { getDashboardCounts } from "@/lib/admin/queries";
import {
  getDashboardGlance,
  getDashboardNeedsAttention,
  getEventOpportunityCount,
  getLocationsAwaitingReview,
  getRecentActivity,
  getTodayOnFindmi,
} from "@/lib/admin/dashboard-queries";
import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";
import { formatTime } from "@/lib/format";
import AdminGlobalSearch from "./AdminGlobalSearch";
import { MetricCell, ModulePanel } from "./dashboard-ui";

export const dynamic = "force-dynamic";

interface AttentionQueueItem {
  label: string;
  pluralLabel: string;
  count: number;
  href: string;
}

/** Command Center V1 pass — ONE row shape for every real queue, replacing
 * the prior page's four overlapping "needs attention"-flavored sections.
 * Every count here is an EXISTING DashboardNeedsAttention field or the
 * already-fetched marketRequestGroups length — no new moderation state,
 * no new query, no duplicated approval action (tapping only routes to
 * the existing authoritative list/filter). */
function AttentionRow({ count, label, href }: { count: number; label: string; href: string }) {
  return (
    <Link href={href} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
      <span className="flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full bg-amber-100 px-2 text-metadata font-bold tabular-nums text-amber-800">
        {count}
      </span>
      <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">{label}</span>
      <span aria-hidden="true" className="shrink-0 text-ink/25">
        ›
      </span>
    </Link>
  );
}

const QUICK_CREATE = [
  { href: "/admin/businesses/new", label: "Business" },
  { href: "/admin/events/new", label: "Event" },
  { href: "/admin/locations/new", label: "Location" },
  { href: "/admin/appearances/new", label: "Appearance" },
];

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function AdminDashboardPage() {
  const [counts, needsAttention, glance, marketRequestGroups, eventOpportunityCount, recentActivity, locationsAwaiting, today] =
    await Promise.all([
      getDashboardCounts(),
      getDashboardNeedsAttention(),
      getDashboardGlance(),
      getPendingMarketRequestGroups(),
      getEventOpportunityCount(),
      getRecentActivity(),
      getLocationsAwaitingReview(),
      getTodayOnFindmi(),
    ]);

  // Every real, existing queue with a working list/filter. Zero-count
  // queues are dropped entirely (never a wall of "0" rows).
  const attentionQueue: AttentionQueueItem[] = needsAttention
    ? [
        { label: "Business awaiting review", pluralLabel: "Businesses awaiting review", count: needsAttention.pendingBusinessReviews, href: "/admin/businesses?published=pending_review" },
        { label: "Event awaiting review", pluralLabel: "Events awaiting review", count: needsAttention.pendingEventReviews, href: "/admin/events?needsReview=1" },
        { label: "Product awaiting review", pluralLabel: "Products awaiting review", count: needsAttention.pendingProductReviews, href: "/admin/products?status=needs_review" },
        { label: "Marketplace submission awaiting review", pluralLabel: "Marketplace submissions awaiting review", count: needsAttention.pendingMarketplaceReviews, href: "/admin/products?status=marketplace_review" },
        { label: "Pending claim", pluralLabel: "Pending claims", count: needsAttention.pendingClaims, href: "/admin/claims?status=pending" },
        { label: "Event application", pluralLabel: "Event applications", count: needsAttention.pendingEventApplications, href: "/admin/events?pending=1" },
        { label: "Onboarding submission awaiting review", pluralLabel: "Onboarding submissions awaiting review", count: needsAttention.pendingOnboardingReview, href: "/admin/onboarding?view=pending_review" },
        { label: "Market/Area request", pluralLabel: "Market/Area requests", count: marketRequestGroups.length, href: "/admin/market-requests" },
        // Acknowledging a Where I'll Be record is not an approval decision,
        // hence not phrased "awaiting review".
        { label: "unreviewed Where I’ll Be record", pluralLabel: "unreviewed Where I’ll Be records", count: needsAttention.unreviewedAppearances, href: "/admin/appearances?reviewed=unreviewed" },
      ]
    : [];
  const activeAttentionItems = attentionQueue.filter((item) => item.count > 0);
  const pendingLocations = locationsAwaiting?.items ?? [];
  const attentionTotal = activeAttentionItems.length + pendingLocations.length;
  const now = Date.now();
  const todayItems = today ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Command band — identity, global search, quick create. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="min-w-0">
          <p className="text-label font-bold uppercase text-accent">Findmi Admin</p>
          <h1 className="font-display text-page-title-lg font-bold text-primary">Home</h1>
        </div>
        <div className="w-full lg:w-[26rem]">
          <AdminGlobalSearch />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUICK_CREATE.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 text-button font-semibold text-secondary transition hover:border-findmi/40 hover:text-findmi-700"
          >
            <span aria-hidden="true" className="text-findmi-600">
              +
            </span>
            {q.label}
          </Link>
        ))}
      </div>

      {!counts && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-body text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t load, and
          writes will fail until it&rsquo;s set.
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          {/* Needs attention — first thing on a phone. Collapses to a single
              quiet line when everything is clear. */}
          {needsAttention &&
            (attentionTotal === 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3">
                <span className="text-body font-semibold text-primary">Needs attention</span>
                <span className="text-body font-semibold text-emerald-700">All clear ✓</span>
              </div>
            ) : (
              <ModulePanel
                title="Needs attention"
                meta={<span className="rounded-full bg-amber-100 px-2 py-0.5 text-metadata font-bold text-amber-800">{attentionTotal}</span>}
                flush
              >
                <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                  {activeAttentionItems.map((item) => (
                    <AttentionRow key={item.label} count={item.count} label={item.count === 1 ? item.label : item.pluralLabel} href={item.href} />
                  ))}
                  {pendingLocations.map((l) => (
                    <Link key={l.id} href={`/admin/locations/${l.id}`} className="flex min-h-[48px] items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-label font-bold uppercase text-amber-800">Location</span>
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">{l.name}</span>
                      <span className="shrink-0 text-metadata text-muted">Awaiting review</span>
                    </Link>
                  ))}
                  {(locationsAwaiting?.total ?? 0) > pendingLocations.length && (
                    <Link href="/admin/locations" className="block px-4 py-2.5 text-metadata font-semibold text-findmi-700 hover:underline">
                      {locationsAwaiting!.total - pendingLocations.length} more locations awaiting review →
                    </Link>
                  )}
                </div>
              </ModulePanel>
            ))}

          {/* Today on Findmi — hidden when nothing overlaps today. "Live" only
              when now is genuinely between start and end. */}
          {todayItems.length > 0 && (
            <ModulePanel title="Today on Findmi" meta={<span className="text-metadata text-muted">{todayItems.length} today</span>} flush>
              <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                {todayItems.map((item) => {
                  const live =
                    item.endAt !== null && new Date(item.startAt).getTime() <= now && now <= new Date(item.endAt).getTime();
                  return (
                    <Link key={item.id} href={item.href} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                      <span className="w-[4.5rem] shrink-0 text-metadata font-semibold tabular-nums text-secondary">
                        {formatTime(item.startAt)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-semibold text-primary">{item.title}</span>
                        <span className="block truncate text-metadata text-muted">
                          {item.kind === "event" ? "Event" : "Appearance"}
                          {item.subtitle ? ` · ${item.subtitle}` : ""}
                        </span>
                      </span>
                      {live && (
                        <span className="shrink-0 rounded-full bg-findmi px-2 py-0.5 text-label font-bold uppercase text-white">Live</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </ModulePanel>
          )}

          {recentActivity && recentActivity.length > 0 && (
            <ModulePanel title="Recently added" flush>
              <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
                {recentActivity.map((item) => (
                  <Link key={item.id} href={item.href} className="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold text-primary">{item.title}</span>
                      <span className="text-metadata text-muted">{item.label}</span>
                    </span>
                    <span className="shrink-0 text-metadata text-subtle">{relativeDate(item.createdAt)}</span>
                  </Link>
                ))}
              </div>
            </ModulePanel>
          )}
        </div>

        {/* Platform snapshot — real counts only, each opening its list. */}
        <ModulePanel title="Platform snapshot" flush>
          <div className="grid grid-cols-2 divide-x divide-y divide-black/[0.06] border-t border-black/[0.06]">
            <MetricCell label="Live businesses" count={counts?.businessesPublic} href="/admin/businesses" />
            <MetricCell label="Upcoming events" count={glance?.upcomingEvents} href="/admin/events?when=upcoming" />
            <MetricCell label="Locations" count={counts?.locations} href="/admin/locations" />
            <MetricCell label="Products" count={counts?.products} href="/admin/products" />
            <MetricCell label="Accounts" count={glance?.users} href="/admin/users" />
            <MetricCell label="Event opportunities" count={eventOpportunityCount ?? undefined} href="/admin/appearances?linkage=standalone&when=upcoming" />
          </div>
          {(Boolean(glance?.inquiries) || Boolean(counts?.orders)) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-black/[0.06] px-4 py-3">
              <Link href="/admin/inquiries" className="text-metadata text-muted transition hover:text-primary">
                {glance?.inquiries ?? "—"} inquiries
              </Link>
              <Link href="/admin/orders" className="text-metadata text-muted transition hover:text-primary">
                {counts?.orders ?? "—"} paid orders
              </Link>
            </div>
          )}
        </ModulePanel>
      </div>
    </div>
  );
}
