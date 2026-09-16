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
import { MetricCell, NavRow, PageEyebrow, QuickActionRow, SectionLabel } from "./dashboard-ui";

export const dynamic = "force-dynamic";

interface AttentionQueueItem {
  label: string;
  pluralLabel: string;
  count: number;
  href: string;
}

/** Command Center V1 pass — ONE row shape for every real queue, replacing
 * the prior page's four overlapping "needs attention"-flavored sections
 * (Needs Review / Business+Product+Marketplace ReviewCards / Needs
 * Attention AttentionCards / Event Opportunities). Every count here is an
 * EXISTING DashboardNeedsAttention field or the already-fetched
 * marketRequestGroups length — no new moderation state, no new query,
 * no duplicated approval action (tapping only routes to the existing
 * authoritative list/filter).
 *
 * Findmi 2026 Visual System pass — an active queue keeps its amber
 * semantic treatment (genuinely actionable, earns the extra weight); the
 * row itself is tighter and no longer sits inside its own bordered card. */
function AttentionRow({ item }: { item: AttentionQueueItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 transition hover:border-amber-300"
    >
      <span className="text-sm font-semibold text-amber-900">
        {item.count} {item.count === 1 ? item.label : item.pluralLabel}
      </span>
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-700">Review →</span>
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

  // A. NEEDS ATTENTION — every real, existing queue this admin already
  // has a working list/filter for, as one flat list. Zero-count queues
  // are filtered out entirely (never a wall of "0" cards) rather than
  // rendered quiet — with 8 possible queues, a quiet-but-visible zero
  // row per queue would still be clutter on a normal day.
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
          // phrased "awaiting review" like the moderation queues above:
          // acknowledging a Where I'll Be record is not an approval
          // decision (see admin_reviewed_at's own doc comment).
          label: "unreviewed Where I’ll Be record",
          pluralLabel: "unreviewed Where I’ll Be records",
          count: needsAttention.unreviewedAppearances,
          href: "/admin/appearances?reviewed=unreviewed",
        },
      ]
    : [];
  const activeAttentionItems = attentionQueue.filter((item) => item.count > 0);

  return (
    <div className="pb-8">
      {/* PAGE INTRO — establishes hierarchy, then gets out of the way;
          this is an operational dashboard, not a hero. */}
      <div>
        <PageEyebrow>Admin</PageEyebrow>
        <h1 className="mt-0.5 font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-ink">
          Findmi Command Center
        </h1>
        <p className="mt-1 text-sm text-ink/55">Review what needs attention and manage what&rsquo;s happening across Findmi.</p>
      </div>

      {/* GLOBAL SEARCH — logic/behavior completely unchanged (see
          AdminGlobalSearch.tsx); full width on mobile, a comfortable
          fixed width on desktop rather than stretching edge to edge. */}
      <div className="mt-4 max-w-xl">
        <AdminGlobalSearch />
      </div>

      {!counts && (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t
          load, and writes will fail until it&rsquo;s set.
        </p>
      )}

      {/* NEEDS ATTENTION — first, highest priority. Routes to the
          authoritative list/filter for each queue; no moderation action
          is duplicated here. Empty state is one compact line, not a card
          reserved for "nothing to do." */}
      {needsAttention && (
        <section className="mt-7">
          {activeAttentionItems.length === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Needs Attention</SectionLabel>
              <p className="text-sm font-medium text-emerald-700">You&rsquo;re caught up ✓</p>
            </div>
          ) : (
            <>
              <SectionLabel>Needs Attention</SectionLabel>
              <div className="mt-2 flex flex-col gap-1.5">
                {activeAttentionItems.map((item) => (
                  <AttentionRow key={item.label} item={item} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* AT A GLANCE — one compact instrument strip instead of eight
          independent cards: number-forward cells separated by hairline
          dividers, not eight bordered rectangles fighting for equal
          attention. Core platform counts read first, pipeline/volume
          counts (Inquiries/Orders, currently both low) follow — same
          uniform cell treatment, ordering alone establishes priority.
          "Venues" renamed to "Locations" — Findmi's canonical term for
          this entity everywhere else in the product — same underlying
          counts.locations query, text only. */}
      <section className="mt-7">
        <SectionLabel>At a Glance</SectionLabel>
        <div className="mt-2 grid grid-cols-2 divide-x divide-y divide-black/5 rounded-lg border border-black/5 sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-8">
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
          <MetricCell label="Inquiries" count={glance?.inquiries} href="/admin/inquiries" />
          <MetricCell label="Orders" count={counts?.orders} href="/admin/orders" />
        </div>
      </section>

      {/* QUICK ACTIONS — same four existing creation routes (Command
          Center V1's own exact set), presented as compact controls rather
          than large bordered tiles. */}
      <section className="mt-7">
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          <QuickActionRow href="/admin/businesses/new" label="Business" />
          <QuickActionRow href="/admin/events/new" label="Event" />
          <QuickActionRow href="/admin/locations/new" label="Location" />
          <QuickActionRow href="/admin/products/new" label="Product" />
        </div>
      </section>

      {/* RECENT ACTIVITY — assembled from existing timestamps only (see
          getRecentActivity's own doc comment); omitted entirely if the
          helper can't run (no service-role access) rather than showing a
          misleading empty state. Rows now share one hairline-divided list
          container instead of each carrying its own border/card. */}
      {recentActivity && (
        <section className="mt-7">
          <SectionLabel>Recent Activity</SectionLabel>
          {recentActivity.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">No recent activity.</p>
          ) : (
            <div className="mt-2 divide-y divide-black/5 rounded-lg border border-black/5">
              {recentActivity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 transition hover:bg-black/[0.02]"
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
        </section>
      )}

      {/* MANAGE + SITE & DISCOVERY — every existing destination, same
          routes/descriptions, now compact divided lists (a list of similar
          navigation destinations is exactly the case this pass's own
          "lists before cards" principle targets) instead of a grid of
          bordered cards. Side by side at desktop width, stacked on
          mobile. "Venues" -> "Locations" here too, for the same reason as
          At a Glance — same route, same underlying entity, just the
          canonical label. */}
      <section className="mt-7 grid grid-cols-1 gap-x-8 lg:grid-cols-2">
        <div>
          <SectionLabel>Manage</SectionLabel>
          <div className="mt-1 divide-y divide-black/5">
            <NavRow letter="B" label="Businesses" description="Profiles, plan tier, and business access." href="/admin/businesses" />
            <NavRow letter="E" label="Events" description="Event listings and vendor participation." href="/admin/events" />
            <NavRow letter="U" label="Users" description="Consumer and vendor accounts." href="/admin/users" />
            <NavRow letter="C" label="Claims" description="Business and event ownership claims." href="/admin/claims" />
            <NavRow letter="W" label="Where You'll Be" description="Where and when businesses show up." href="/admin/appearances" />
            <NavRow letter="Pr" label="Products" description="Marketplace product listings." href="/admin/products" />
            <NavRow letter="Pe" label="People" description="Public person profiles." href="/admin/people" />
            <NavRow letter="L" label="Locations" description="Venues and places businesses appear." href="/admin/locations" />
          </div>
        </div>

        <div className="mt-7 lg:mt-0">
          <SectionLabel>Site &amp; Discovery</SectionLabel>
          <div className="mt-1 divide-y divide-black/5">
            <NavRow letter="Ca" label="Categories" description="Homepage category controls." href="/admin/categories" />
            <NavRow letter="Ma" label="Markets" description="Findmi Markets, consumer Area names, and areas included." href="/admin/markets" />
            <NavRow letter="Mr" label="Market Requests" description="Geography consumers/businesses/events have asked for." href="/admin/market-requests" />
            <NavRow letter="Si" label="Sales Inquiries" description="Multi-Region/National leads from Join's Talk to Sales." href="/admin/sales-inquiries" />
            <NavRow letter="Co" label="Communications" description="All platform communications — inquiries, direct messages, and sales." href="/admin/conversations" />
            <NavRow letter="S" label="Site Editor" description="Homepage, navigation, and site content." href="/admin/site" />
          </div>
        </div>
      </section>
    </div>
  );
}
