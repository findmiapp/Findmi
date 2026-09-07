import Link from "next/link";
import { getDashboardCounts } from "@/lib/admin/queries";
import {
  getDashboardGlance,
  getDashboardNeedsAttention,
  getEventOpportunityCount,
  getRecentActivity,
} from "@/lib/admin/dashboard-queries";
import { getPendingMarketRequestGroups } from "@/lib/admin/market-requests";

export const dynamic = "force-dynamic";

function Monogram({ letter }: { letter: string }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 font-display font-bold text-findmi-700 ${
        letter.length > 1 ? "text-xs" : "text-sm"
      }`}
    >
      {letter}
    </span>
  );
}

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
 * authoritative list/filter). */
function AttentionRow({ item }: { item: AttentionQueueItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 transition hover:border-amber-300"
    >
      <span className="text-sm font-semibold text-amber-900">
        {item.count} {item.count === 1 ? item.label : item.pluralLabel}
      </span>
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-700">Review →</span>
    </Link>
  );
}

function MetricCard({ label, count, href }: { label: string; count: number | undefined; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-black/5 bg-white p-3.5 transition hover:border-black/10 hover:shadow-sm">
      <p className="font-display text-xl font-semibold text-ink">{count ?? "—"}</p>
      <p className="mt-0.5 text-xs font-medium text-ink/60">{label}</p>
    </Link>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-findmi/40 hover:bg-findmi-50 hover:text-findmi-700"
    >
      <span aria-hidden>+</span> {label}
    </Link>
  );
}

function ManageCard({ letter, label, description, href }: { letter: string; label: string; description: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm"
    >
      <Monogram letter={letter} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-ink/50">{description}</span>
      </span>
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
    <div>
      {/* HEADER */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Admin</p>
        <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">Findmi Command Center</h1>
        <p className="mt-1 text-sm text-ink/60">Review what needs attention and manage what&rsquo;s happening across Findmi.</p>
      </div>

      {!counts && (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t
          load, and writes will fail until it&rsquo;s set.
        </p>
      )}

      {/* A. NEEDS ATTENTION — first, highest priority. Routes to the
          authoritative list/filter for each queue; no moderation action
          is duplicated here. */}
      {needsAttention && (
        <section className="mt-5 rounded-2xl border border-black/5 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Needs Attention</h2>
          {activeAttentionItems.length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-emerald-700">You&rsquo;re caught up.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {activeAttentionItems.map((item) => (
                <AttentionRow key={item.label} item={item} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* B. AT A GLANCE — informational counts only, no new expensive
          query architecture: businesses/events/locations/products/orders
          all come from the existing getDashboardCounts() head-count
          batch, upcomingEvents/inquiries/users from getDashboardGlance(),
          Event Opportunities from the existing getEventOpportunityCount()
          (kept as an informational count here rather than its own
          dashboard section, since it's explicitly not a moderation
          queue — see that helper's own doc comment). */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">At a Glance</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MetricCard label="Live Businesses" count={counts?.businessesPublic} href="/admin/businesses" />
          <MetricCard label="Upcoming Events" count={glance?.upcomingEvents} href="/admin/events?when=upcoming" />
          <MetricCard label="Venues" count={counts?.locations} href="/admin/locations" />
          <MetricCard label="Products" count={counts?.products} href="/admin/products" />
          <MetricCard label="Accounts" count={glance?.users} href="/admin/users" />
          <MetricCard label="Inquiries" count={glance?.inquiries} href="/admin/inquiries" />
          <MetricCard label="Orders" count={counts?.orders} href="/admin/orders" />
          <MetricCard
            label="Event Opportunities"
            count={eventOpportunityCount ?? undefined}
            href="/admin/appearances?linkage=standalone&when=upcoming"
          />
        </div>
      </section>

      {/* C. QUICK ADD — existing creation routes only. Where You'll Be,
          People, and Users creation remain reachable from their own list
          pages' own "+ New" buttons — trimmed from this dashboard shortcut
          list per this pass's exact four-item spec, not removed as
          destinations. */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Quick Add</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction href="/admin/businesses/new" label="Business" />
          <QuickAction href="/admin/events/new" label="Event" />
          <QuickAction href="/admin/locations/new" label="Venue" />
          <QuickAction href="/admin/products/new" label="Product" />
        </div>
      </section>

      {/* D. RECENT ACTIVITY — assembled from existing timestamps only
          (see getRecentActivity's own doc comment); omitted entirely if
          the helper can't run (no service-role access) rather than
          showing a misleading empty state. */}
      {recentActivity && (
        <section className="mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">No recent activity.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-1.5">
              {recentActivity.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-3.5 py-2.5 transition hover:border-black/10"
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

      {/* E. MANAGE */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Manage</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ManageCard letter="B" label="Businesses" description="Profiles, plan tier, and business access." href="/admin/businesses" />
          <ManageCard letter="E" label="Events" description="Event listings and vendor participation." href="/admin/events" />
          <ManageCard letter="U" label="Users" description="Consumer and vendor accounts." href="/admin/users" />
          <ManageCard letter="C" label="Claims" description="Business and event ownership claims." href="/admin/claims" />
          <ManageCard letter="W" label="Where You'll Be" description="Where and when businesses show up." href="/admin/appearances" />
          <ManageCard letter="Pr" label="Products" description="Marketplace product listings." href="/admin/products" />
          <ManageCard letter="Pe" label="People" description="Public person profiles." href="/admin/people" />
          <ManageCard letter="V" label="Venues" description="Venues and places businesses appear." href="/admin/locations" />
        </div>
      </section>

      {/* F. SITE & DISCOVERY */}
      <section className="mt-6 mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Site &amp; Discovery</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ManageCard letter="Ca" label="Categories" description="Homepage category controls." href="/admin/categories" />
          <ManageCard letter="Ma" label="Markets" description="Findmi Markets, consumer Area names, and areas included." href="/admin/markets" />
          <ManageCard letter="Mr" label="Market Requests" description="Geography consumers/businesses/events have asked for." href="/admin/market-requests" />
          <ManageCard letter="S" label="Site Editor" description="Homepage, navigation, and site content." href="/admin/site" />
        </div>
      </section>
    </div>
  );
}
