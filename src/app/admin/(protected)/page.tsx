import Link from "next/link";
import { getDashboardCounts } from "@/lib/admin/queries";
import {
  getDashboardGlance,
  getDashboardNeedsAttention,
  getEventOpportunityCount,
  getRecentActivity,
} from "@/lib/admin/dashboard-queries";
import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";
import AdminGlobalSearch from "./AdminGlobalSearch";
import AdminQuickCreate from "./AdminQuickCreate";
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
function AttentionRow({ item }: { item: AttentionQueueItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 transition hover:border-amber-300"
    >
      <span className="text-sm font-semibold text-amber-900">
        {item.count} {item.count === 1 ? item.label : item.pluralLabel}
      </span>
      <span className="shrink-0 text-xs font-bold text-amber-700">→</span>
    </Link>
  );
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function AdminDashboardPage() {
  const [counts, needsAttention, glance, marketRequestGroups, eventOpportunityCount, recentActivity] = await Promise.all([
    getDashboardCounts(),
    getDashboardNeedsAttention(),
    getDashboardGlance(),
    getPendingMarketRequestGroups(),
    getEventOpportunityCount(),
    getRecentActivity(),
  ]);

  // Every real, existing queue this admin already has a working list/
  // filter for, as one flat list. Zero-count queues are filtered out
  // entirely (never a wall of "0" rows) rather than rendered quiet.
  const attentionQueue: AttentionQueueItem[] = needsAttention
    ? [
        {
          label: "Business awaiting review",
          pluralLabel: "Businesses awaiting review",
          count: needsAttention.pendingBusinessReviews,
          href: "/admin/businesses?published=pending_review",
        },
        {
          label: "Event awaiting review",
          pluralLabel: "Events awaiting review",
          count: needsAttention.pendingEventReviews,
          href: "/admin/events?needsReview=1",
        },
        {
          label: "Product awaiting review",
          pluralLabel: "Products awaiting review",
          count: needsAttention.pendingProductReviews,
          href: "/admin/products?status=needs_review",
        },
        {
          label: "Marketplace submission awaiting review",
          pluralLabel: "Marketplace submissions awaiting review",
          count: needsAttention.pendingMarketplaceReviews,
          href: "/admin/products?status=marketplace_review",
        },
        {
          label: "Pending claim",
          pluralLabel: "Pending claims",
          count: needsAttention.pendingClaims,
          href: "/admin/claims?status=pending",
        },
        {
          label: "Event application",
          pluralLabel: "Event applications",
          count: needsAttention.pendingEventApplications,
          href: "/admin/events?pending=1",
        },
        {
          label: "Onboarding submission awaiting review",
          pluralLabel: "Onboarding submissions awaiting review",
          count: needsAttention.pendingOnboardingReview,
          href: "/admin/onboarding?view=pending_review",
        },
        {
          label: "Market/Area request",
          pluralLabel: "Market/Area requests",
          count: marketRequestGroups.length,
          href: "/admin/market-requests",
        },
        {
          // Admin Where I'll Be Review Inbox pass — deliberately NOT
          // phrased "awaiting review": acknowledging a Where I'll Be
          // record is not an approval decision.
          label: "unreviewed Where I’ll Be record",
          pluralLabel: "unreviewed Where I’ll Be records",
          count: needsAttention.unreviewedAppearances,
          href: "/admin/appearances?reviewed=unreviewed",
        },
      ]
    : [];
  const activeAttentionItems = attentionQueue.filter((item) => item.count > 0);
  const attentionCount = activeAttentionItems.length;

  return (
    <div className="pb-10">
      {/* COMMAND BAND — title + Findmi's universal command/navigation
          instrument + Quick Create, all in one operational strip instead
          of a title block, then a lone search field, then a separate
          button row further down the page. Global Search's own
          server action/authorization/debounce/grouping/routing are
          untouched (see AdminGlobalSearch.tsx) — only its visual role
          changed. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="shrink-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-600">Admin</p>
          <h1 className="font-display text-lg font-bold leading-tight tracking-tight text-ink lg:text-xl">
            Findmi Command Center
          </h1>
        </div>
        <div className="flex items-center gap-2 lg:w-[30rem]">
          <div className="min-w-0 flex-1">
            <AdminGlobalSearch />
          </div>
          <AdminQuickCreate />
        </div>
      </div>

      {!counts && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t
          load, and writes will fail until it&rsquo;s set.
        </p>
      )}

      {/* OPERATIONAL GRID — mobile stacks in priority order (what needs
          me -> platform scale -> what changed); desktop places Needs
          Attention as a persistent status rail alongside a wider column
          for scale + activity, so all three are visible simultaneously
          instead of a single scrolling document. Explicit grid placement
          (not `order`) keeps DOM order = mobile priority order while
          desktop repositions purely visually. */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:items-start">
        {/* NEEDS ATTENTION — mobile: first (answers "what needs me").
            Desktop: right rail, self-sized (never stretched to match the
            left column's combined height). Preserve logic: existing
            queues only, empty state compact, active state prominent. */}
        <div className="lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:self-start">
          {needsAttention && (
            <ModulePanel
              title="Needs Attention"
              meta={
                attentionCount > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{attentionCount}</span>
                ) : (
                  <span className="text-xs font-semibold text-emerald-700">Clear ✓</span>
                )
              }
            >
              {attentionCount === 0 ? (
                <p className="text-sm text-ink/50">Nothing needs your review right now.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {activeAttentionItems.map((item) => (
                    <AttentionRow key={item.label} item={item} />
                  ))}
                </div>
              )}
            </ModulePanel>
          )}
        </div>

        {/* PLATFORM SNAPSHOT — mobile: second. Desktop: left column, row 1.
            Core platform-scale counts read large/bold; Inquiries/Orders
            (currently both low-signal) recede to a quiet inline line
            below rather than matching cells — same data, real hierarchy,
            nothing hidden. "Venues" -> "Locations": Findmi's canonical
            term for this entity everywhere else in the product — same
            counts.locations query, text only. */}
        <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1">
          <ModulePanel title="Platform Snapshot">
            <div className="grid grid-cols-2 divide-x divide-y divide-black/5 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
              <MetricCell label="Live Businesses" count={counts?.businessesPublic} href="/admin/businesses" />
              <MetricCell label="Upcoming Events" count={glance?.upcomingEvents} href="/admin/events?when=upcoming" />
              <MetricCell label="Locations" count={counts?.locations} href="/admin/locations" />
              <MetricCell label="Products" count={counts?.products} href="/admin/products" />
              <MetricCell label="Accounts" count={glance?.users} href="/admin/users" />
              <MetricCell
                label="Event Opportunities"
                count={eventOpportunityCount ?? undefined}
                href="/admin/appearances?linkage=standalone&when=upcoming"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-black/[0.06] pt-3">
              <Link href="/admin/inquiries" className="text-xs text-ink/40 transition hover:text-ink/70">
                {glance?.inquiries ?? "—"} Inquiries
              </Link>
              <Link href="/admin/orders" className="text-xs text-ink/40 transition hover:text-ink/70">
                {counts?.orders ?? "—"} Orders
              </Link>
            </div>
          </ModulePanel>
        </div>

        {/* RECENT ACTIVITY — mobile: third. Desktop: left column, row 2,
            beneath Platform Snapshot. Same assembled-from-existing-
            timestamps feed as before (see getRecentActivity's own doc
            comment); omitted entirely if the helper can't run. */}
        {recentActivity && (
          <div className="lg:col-start-1 lg:col-span-2 lg:row-start-2">
            <ModulePanel title="Recent Activity" meta={<span className="text-xs text-ink/40">What changed</span>}>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-ink/50">No recent activity.</p>
              ) : (
                <div className="-mx-4 -my-4 divide-y divide-black/[0.06]">
                  {recentActivity.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                        <span className="text-xs text-ink/45">{item.label}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink/40">{relativeDate(item.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </ModulePanel>
          </div>
        )}
      </div>
    </div>
  );
}
