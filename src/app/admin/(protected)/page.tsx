import Link from "next/link";
import { getDashboardCounts } from "@/lib/admin/queries";
import { getDashboardGlance, getDashboardNeedsAttention } from "@/lib/admin/dashboard-queries";

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

interface AttentionItem {
  label: string;
  count: number;
  href: string;
}

function AttentionCard({ label, count, href }: AttentionItem) {
  const needsAction = count > 0;
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition hover:shadow-sm ${
        needsAction ? "border-amber-300 bg-amber-50" : "border-black/5 bg-white hover:border-black/10"
      }`}
    >
      <span className={`text-sm font-medium ${needsAction ? "text-amber-800" : "text-ink/60"}`}>{label}</span>
      <span
        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold ${
          needsAction ? "bg-amber-400 text-white" : "bg-black/[0.06] text-ink/40"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function MetricCard({ label, count, href, detail }: { label: string; count: number | undefined; href?: string; detail?: string }) {
  const content = (
    <>
      <p className="font-display text-2xl font-semibold text-ink">{count ?? "—"}</p>
      <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      {detail && <p className="text-xs text-ink/45">{detail}</p>}
    </>
  );
  const className = "rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/10 hover:shadow-sm";
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Onboarding UX Polish pass — Business Reviews. Distinct from the plain
 * label+badge AttentionCard rows below it: this one has its own
 * description + explicit CTA button, per this pass's exact requested
 * copy, so it stays visually prominent as its own thing rather than
 * blending into the generic Needs Attention row. Always renders (not
 * conditional on count > 0) — the zero state is its own quiet copy/color,
 * never a misleading "0 awaiting review" phrased as if there's an action
 * to take. */
function BusinessReviewCard({ count, href }: { count: number; href: string }) {
  const needsAction = count > 0;
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        needsAction ? "border-amber-300 bg-amber-50" : "border-black/5 bg-white"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-bold ${needsAction ? "text-amber-800" : "text-ink"}`}>Business Reviews</p>
        <p className={`mt-0.5 text-sm font-semibold ${needsAction ? "text-amber-800" : "text-ink/50"}`}>
          {needsAction ? `${count} awaiting review` : "No businesses awaiting review"}
        </p>
        <p className={`mt-0.5 text-xs ${needsAction ? "text-amber-900/70" : "text-ink/40"}`}>
          Review new businesses submitted by members.
        </p>
      </div>
      <Link
        href={href}
        className={`inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
          needsAction
            ? "bg-amber-400 text-white hover:bg-amber-500"
            : "border border-black/10 text-ink/60 hover:border-black/20"
        }`}
      >
        Review Businesses
      </Link>
    </div>
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

export default async function AdminDashboardPage() {
  const [counts, needsAttention, glance] = await Promise.all([
    getDashboardCounts(),
    getDashboardNeedsAttention(),
    getDashboardGlance(),
  ]);

  const attentionItems: AttentionItem[] = needsAttention
    ? [
        { label: "Pending Claims", count: needsAttention.pendingClaims, href: "/admin/claims?status=pending" },
        { label: "Pending Event Applications", count: needsAttention.pendingEventApplications, href: "/admin/events?pending=1" },
        { label: "Onboarding Awaiting Review", count: needsAttention.pendingOnboardingReview, href: "/admin/onboarding?view=pending_review" },
      ]
    : [];
  const attentionTotal = attentionItems.reduce((sum, i) => sum + i.count, 0);

  return (
    <div>
      {/* A. HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">FindMi Admin</h1>
          <p className="mt-1 text-sm text-ink/60">Manage the platform, listings and activity.</p>
        </div>
        <a
          href="#quick-actions"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          + Add New
        </a>
      </div>

      {!counts && (
        <p className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Server-side Supabase access isn&rsquo;t configured (missing SUPABASE_SERVICE_ROLE_KEY). Counts can&rsquo;t
          load, and writes will fail until it&rsquo;s set.
        </p>
      )}

      {/* A2. BUSINESS REVIEWS — Onboarding UX Polish pass. Near the top,
          its own prominent card, ahead of the generic Needs Attention
          row — new member-created/claimed businesses awaiting founder
          review. Reuses the existing Admin Businesses list + its
          Pending Review filter (added in the prior pass) rather than a
          second moderation screen. */}
      {needsAttention && (
        <section className="mt-6">
          <BusinessReviewCard
            count={needsAttention.pendingBusinessReviews}
            href="/admin/businesses?published=pending_review"
          />
        </section>
      )}

      {/* B. NEEDS ATTENTION */}
      {needsAttention && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Needs Attention</h2>
            {attentionTotal === 0 && <span className="text-xs text-ink/40">All caught up</span>}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {attentionItems.map((item) => (
              <AttentionCard key={item.label} {...item} />
            ))}
          </div>
        </section>
      )}

      {/* C. AT A GLANCE */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">At a Glance</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Businesses"
            count={counts?.businesses}
            href="/admin/businesses"
            detail={counts ? `${counts.businessesPublic} public` : undefined}
          />
          <MetricCard label="Users" count={glance?.users} href="/admin/users" />
          <MetricCard label="Pro Businesses" count={glance?.proBusinesses} href="/admin/businesses" />
          <MetricCard label="Free Businesses" count={glance?.freeBusinesses} href="/admin/businesses" />
          <MetricCard label="Upcoming Events" count={glance?.upcomingEvents} href="/admin/events?when=upcoming" />
          <MetricCard label="Appearances" count={counts?.appearances} href="/admin/appearances" />
        </div>
      </section>

      {/* D. QUICK ACTIONS */}
      <section id="quick-actions" className="mt-6 scroll-mt-20">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Quick Actions</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction href="/admin/businesses/new" label="Business" />
          <QuickAction href="/admin/events/new" label="Event" />
          <QuickAction href="/admin/appearances/new" label="Appearance" />
          <QuickAction href="/admin/products/new" label="Product" />
          <QuickAction href="/admin/people/new" label="Person" />
          <QuickAction href="/admin/locations/new" label="Location" />
          <QuickAction href="/admin/users/new" label="User" />
        </div>
      </section>

      {/* E. MANAGE */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Manage</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ManageCard letter="B" label="Businesses" description="Profiles, plan tier, and business access." href="/admin/businesses" />
          <ManageCard letter="E" label="Events" description="Event listings and vendor participation." href="/admin/events" />
          <ManageCard letter="U" label="Users" description="Consumer and vendor accounts." href="/admin/users" />
          <ManageCard letter="C" label="Claims" description="Business and event ownership claims." href="/admin/claims" />
          <ManageCard letter="A" label="Appearances" description="Where and when businesses show up." href="/admin/appearances" />
          <ManageCard letter="Pr" label="Products" description="Marketplace product listings." href="/admin/products" />
          <ManageCard letter="Pe" label="People" description="Public person profiles." href="/admin/people" />
          <ManageCard letter="L" label="Locations" description="Venues and places businesses appear." href="/admin/locations" />
        </div>
      </section>

      {/* F. SITE & DISCOVERY */}
      <section className="mt-6 mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-ink/40">Site &amp; Discovery</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ManageCard letter="Ca" label="Categories" description="Homepage category controls." href="/admin/categories" />
          <ManageCard letter="S" label="Site Editor" description="Homepage, navigation, and site content." href="/admin/site" />
        </div>
      </section>
    </div>
  );
}
