import Link from "next/link";
import type { ReactNode } from "react";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { DashboardAppearance, NeedsAttentionItem } from "@/lib/business-dashboard";
import { formatTime } from "@/lib/format";
import { Chip } from "../../../owner-ui";
import { SparkGlyph } from "./BusinessAppShell";
import Greeting from "./Greeting";
import AddToPresence from "./AddToPresence";
import type { BusinessOpportunityItem } from "@/lib/opportunity-listings";
import BusinessOpportunityCard from "@/components/opportunities/BusinessOpportunityCard";
import { GoalGlyph } from "@/components/opportunities/OpportunityGlyphs";

// Same zone lib/format.ts formats every owner/public time in.
const APP_TIMEZONE = "America/New_York";

/** /account V2, Pass 1 — Business Home: an operating overview, not an
 * analytics dashboard. Every section is built only from data this page
 * already loads (no new query, metric or notification); a section with
 * nothing truthful to say is omitted instead of rendered empty.
 *
 * Business Overview Information-Hierarchy pass — render order is now,
 * after Greeting/Quick Actions: Happening Now, Needs Attention, Coming
 * Up, pending Invitation/Order tiles, Performance, Opportunities, Your
 * Findmi Link. Opportunities (recommendations/Explore/Goals) moved below
 * Performance — its own empty state (Explore Opportunities / Tell Findmi
 * What You Need) was previously the first substantive section, outranking
 * the business's own live/attention/schedule/performance state. Same
 * component, same props, same internal logic — presentation order only. */

export interface HomeMetric {
  value: number;
  changeLabel: string | null;
}

export default function BusinessHome({
  basePath,
  businessId,
  businessName,
  pro,
  todayAppearances,
  upcomingAppearances,
  needsAttention,
  metrics,
  metricsRangeLabel,
  pendingInvitationCount,
  newOrderCount,
  businessHandle,
  updateHandleAction,
  opportunityItems,
}: {
  basePath: string;
  businessId: string;
  businessName: string;
  pro: boolean;
  todayAppearances: DashboardAppearance[];
  upcomingAppearances: DashboardAppearance[];
  needsAttention: NeedsAttentionItem[];
  metrics: { profileViews: HomeMetric; actionsTaken: HomeMetric; qrScans: HomeMetric; followers: number } | null;
  metricsRangeLabel: string | null;
  pendingInvitationCount: number;
  newOrderCount: number;
  businessHandle: string | null;
  updateHandleAction: (formData: FormData) => void | Promise<void>;
  /** This Business's own commercial Opportunities (Business-safe items). */
  opportunityItems: BusinessOpportunityItem[];
}) {
  const liveNow = todayAppearances.filter((a) => a.temporal.live);
  const laterToday = todayAppearances.filter((a) => !a.temporal.live);
  const comingUp = [...laterToday, ...upcomingAppearances].slice(0, 4);

  return (
    <div className="flex flex-col gap-7">
      <header>
        <Greeting />
        <p className="mt-0.5 text-body text-muted">Here&rsquo;s what&rsquo;s happening with {businessName}.</p>
      </header>

      {/* Quick actions — Pass A: one intent-based activity entry (+ Add:
          host / go / add a location) instead of competing Event vs
          Appearance vs Location buttons; Product stays separate. */}
      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        <AddToPresence basePath={basePath} businessId={businessId} variant="chip" />
        <QuickAction href={`${basePath}?tab=products&compose=1`} icon={<NavIcon name="tag" className="h-[18px] w-[18px]" />} label="Product" />
      </nav>

      {liveNow.length > 0 && (
        <section aria-labelledby="happening-now">
          <h2 id="happening-now" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            </span>
            Happening Now
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {liveNow.map((a) => (
              <LiveCard key={a.id} appearance={a} />
            ))}
          </div>
        </section>
      )}

      {needsAttention.length > 0 && (
        <section aria-labelledby="needs-attention">
          <div className="flex items-center gap-2">
            <h2 id="needs-attention" className="font-display text-section-title font-bold text-primary">
              Needs Attention
            </h2>
            <Chip tone="amber">{needsAttention.length}</Chip>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
            {needsAttention.map((item) => (
              <li key={item.id}>
                <Link href={item.actionHref} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 text-body text-secondary">{item.message}</span>
                  <span className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent">
                    {item.actionLabel}
                    <ChevronIcon direction="right" className="h-3 w-3" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="coming-up">
        <SectionTitle id="coming-up" title="Coming Up" href={`${basePath}?tab=findmi-here`} linkLabel="See All" />
        {comingUp.length > 0 ? (
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
            {comingUp.map((a) => (
              <li key={a.id}>
                <UpcomingRow appearance={a} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted">
            Nothing scheduled yet. Use <span className="font-semibold text-secondary">+ Add</span> to add where your
            business is showing up.
          </p>
        )}
      </section>

      {(pendingInvitationCount > 0 || newOrderCount > 0) && (
        <section className="grid gap-2 sm:grid-cols-2">
          {pendingInvitationCount > 0 && (
            <Link
              href={`${basePath}?tab=opportunities`}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3.5 transition hover:border-black/15"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <SparkGlyph className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">
                  {pendingInvitationCount} Event Invitation{pendingInvitationCount === 1 ? "" : "s"}
                </span>
                <span className="block text-metadata text-muted">Waiting for your response</span>
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
            </Link>
          )}
          {newOrderCount > 0 && (
            <Link
              href={`${basePath}?tab=orders`}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3.5 transition hover:border-black/15"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <NavIcon name="cart" className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">
                  {newOrderCount} New Order{newOrderCount === 1 ? "" : "s"}
                </span>
                <span className="block text-metadata text-muted">Ready to confirm</span>
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
            </Link>
          )}
        </section>
      )}

      {metrics && (
        <section aria-labelledby="performance-snapshot">
          <SectionTitle
            id="performance-snapshot"
            title="Performance"
            href={`${basePath}?tab=performance`}
            linkLabel={pro ? "View Performance" : "Unlock Full Analytics"}
          />
          {metricsRangeLabel && <p className="mt-0.5 text-metadata text-subtle">{metricsRangeLabel}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile label="Profile Views" metric={metrics.profileViews} pro={pro} />
            <MetricTile label="Actions" metric={metrics.actionsTaken} pro={pro} />
            <MetricTile label="QR Scans" metric={metrics.qrScans} pro={pro} />
            <MetricTile label="Followers" metric={{ value: metrics.followers, changeLabel: null }} pro={pro} />
          </div>
        </section>
      )}

      <HomeOpportunities basePath={basePath} items={opportunityItems} />

      {/* Your Findmi link — previously only on the old Overview; kept on
          Home so the handle editor stays reachable. */}
      <section aria-labelledby="findmi-link">
        <h2 id="findmi-link" className="font-display text-section-title font-bold text-primary">
          Your Findmi Link
        </h2>
        <div className="mt-2">
          <FindmiUrlCard entityType="business" entityId={businessId} entityLabel={businessName} currentHandle={businessHandle} action={updateHandleAction} quiet />
        </div>
      </section>
    </div>
  );
}

/** Home's Opportunities section — directly under the greeting/actions.
 * With recommendations: ONE compact preview of the most current
 * relationship (a new Recommendation first, then Confirmed, then
 * Interested) plus an "N New" count; View All opens Opportunities. Without:
 * a productive Explore card and a Tell Findmi What You Need action, never a
 * bare empty box. */
function HomeOpportunities({ basePath, items }: { basePath: string; items: BusinessOpportunityItem[] }) {
  const newOnes = items.filter((i) => i.view.group === "for_you");
  const top = newOnes[0] ?? items.find((i) => i.view.group === "confirmed") ?? items.find((i) => i.view.group === "interested") ?? null;
  return (
    <section aria-labelledby="home-opportunities">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-opportunities" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
          Opportunities
          {newOnes.length > 0 && <Chip tone="aqua">{newOnes.length} New</Chip>}
        </h2>
        <Link href={`${basePath}?tab=opportunities`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          View All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>
      {top ? (
        <>
          <p className="mt-0.5 text-metadata text-muted">Opportunities Findmi recommends for your Business.</p>
          <div className="mt-3 sm:max-w-md">
            <BusinessOpportunityCard item={top.view} place={top.place} href={`${basePath}/opportunities/${top.view.recipientId}`} compact />
          </div>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-metadata text-muted">Find new ways to grow your Business.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Link
              href={`${basePath}?tab=opportunities&view=explore`}
              className="group flex flex-col justify-between gap-3 rounded-2xl border border-findmi/20 bg-findmi-50/60 p-4 transition hover:border-findmi/40"
            >
              <span className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-findmi-700 shadow-sm">
                  <SparkGlyph className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-card-title font-semibold text-primary">Explore Opportunities</span>
                  <span className="mt-0.5 block text-metadata text-secondary">Discover activations, pop-ups, sampling, vending, partnerships and more.</span>
                </span>
              </span>
              <span className="flex h-10 w-fit items-center gap-1.5 rounded-xl bg-findmi px-4 text-button font-bold text-white transition group-hover:bg-findmi-600">
                Browse Opportunities
                <span aria-hidden="true">→</span>
              </span>
            </Link>
            <Link
              href={`${basePath}/opportunities/goals/new`}
              className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white p-4 transition hover:border-black/15"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <GoalGlyph className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">Tell Findmi What You Need</span>
                <span className="mt-0.5 block text-metadata text-muted">Share your goals and we&rsquo;ll surface relevant Opportunities.</span>
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-black/[0.08] bg-white pl-3 pr-4 text-button font-semibold text-primary shadow-sm transition hover:border-black/15 active:scale-[0.98]"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-findmi text-white">
        <PlusGlyph className="h-3.5 w-3.5" />
      </span>
      <span className="text-ink/45">{icon}</span>
      {label}
    </Link>
  );
}

function SectionTitle({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-section-title font-bold text-primary">
        {title}
      </h2>
      <Link href={href} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
        {linkLabel}
        <ChevronIcon direction="right" className="h-3 w-3" />
      </Link>
    </div>
  );
}

function placeLine(a: DashboardAppearance): string | null {
  return a.venueName ?? a.geographyLabel ?? ([a.city, a.state].filter(Boolean).join(", ") || null);
}

function LiveCard({ appearance: a }: { appearance: DashboardAppearance }) {
  const place = placeLine(a);
  return (
    <Link
      href={a.managementHref}
      className="flex overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-sm transition hover:border-black/15 active:scale-[0.99]"
    >
      <div className="relative w-24 shrink-0 bg-black/[0.04] sm:w-32">
        {a.flyerImageUrl ? (
          <SupabaseImage src={a.flyerImageUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/20">
            <NavIcon name="calendar" className="h-7 w-7" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 p-3.5">
        <p className="text-label font-bold uppercase text-red-600">Live · until {formatTime(a.endAt)}</p>
        <p className="mt-1 line-clamp-2 font-display text-card-title-lg font-semibold leading-snug text-primary">{a.title}</p>
        {place && <p className="mt-0.5 truncate text-metadata text-muted">{place}</p>}
        <p className="flex items-center gap-1 mt-2 text-metadata font-bold text-accent">
          Manage
          <ChevronIcon direction="right" className="h-3 w-3" />
        </p>
      </div>
    </Link>
  );
}

function UpcomingRow({ appearance: a }: { appearance: DashboardAppearance }) {
  const place = placeLine(a);
  const pendingStatus = a.participationStatus && a.participationStatus !== "approved";
  return (
    <Link href={a.managementHref} className="flex items-center gap-3 py-3">
      <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-black/[0.04] py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {new Date(a.startAt).toLocaleDateString("en-US", { month: "short", timeZone: APP_TIMEZONE })}
        </span>
        <span className="font-display text-lg font-bold leading-none text-primary">{new Date(a.startAt).toLocaleDateString("en-US", { day: "numeric", timeZone: APP_TIMEZONE })}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-card-title font-semibold text-primary">{a.title}</span>
        <span className="block truncate text-metadata text-muted">
          {a.temporal.label} · {formatTime(a.startAt)}–{formatTime(a.endAt)}
          {place ? ` · ${place}` : ""}
        </span>
      </span>
      {pendingStatus ? (
        <Chip tone="amber">{a.statusLabel}</Chip>
      ) : (
        <ChevronIcon direction="right" className="h-3.5 w-3.5 shrink-0 text-ink/25" />
      )}
    </Link>
  );
}

function MetricTile({ label, metric, pro }: { label: string; metric: HomeMetric; pro: boolean }) {
  const change = pro ? metric.changeLabel : null;
  const up = change?.startsWith("+");
  return (
    <div className="rounded-2xl bg-black/[0.03] px-3.5 py-3">
      <p className="font-display text-stat font-bold leading-none text-primary tabular-nums">{metric.value.toLocaleString()}</p>
      <p className="mt-1.5 text-metadata font-medium text-muted">{label}</p>
      {change && <p className={`mt-0.5 text-microcopy font-bold ${up ? "text-accent" : "text-subtle"}`}>{change}</p>}
    </div>
  );
}

function PlusGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
