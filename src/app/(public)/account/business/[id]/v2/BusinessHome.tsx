import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { HomeActivity, NeedsAttentionItem } from "@/lib/business-dashboard";
import { formatTime } from "@/lib/format";
import { Chip } from "../../../owner-ui";
import { SparkGlyph } from "./BusinessAppShell";
import type { BusinessOpportunityItem } from "@/lib/opportunity-listings";
import BusinessOpportunityCard from "@/components/opportunities/BusinessOpportunityCard";
import { GoalGlyph } from "@/components/opportunities/OpportunityGlyphs";
import { businessCreateActions, orderedCreateActions } from "./createActions";
import CreateActionIcon from "./CreateActionIcon";
import AddToPresence from "./AddToPresence";
import HomeSectionNav, { type HomeSectionNavItem } from "./HomeSectionNav";

// Same zone lib/format.ts formats every owner/public time in.
const APP_TIMEZONE = "America/New_York";

/** Business Home — the command center for ONE Business: a summary /
 * control surface, never a second management interface (Findmi Here,
 * Products, Opportunities, More, the Event Manager and Performance keep
 * the depth). Built only from data the page already loads; a section with
 * nothing truthful to say is omitted, never rendered empty.
 *
 * Final Command Center UX pass — locked top-to-bottom hierarchy:
 *   A. Business header / status — identity + Free/Pro in the shell's
 *      context bar; here only publication status + View Public Profile
 *   B. Sticky Home section rail — Overview · Attention N · Schedule ·
 *      Create · Performance (in-page anchors only; HomeSectionNav)
 *   C. Needs Attention   — conditional; what / why / action
 *   D. Happening Now     — conditional; live Appearances + hosted Events
 *   E. Coming Up         — Appearances + hosted Events, one per Event
 *                          (B2 buildHomeComingUp), compact, See All
 *   F. Create on Findmi  — horizontal action rail from ./createActions;
 *                          View All opens the existing "+" sheet
 *   G. Opportunities For You — existing recommendations, else Explore /
 *                          Tell Findmi Your Goals
 *   H. Performance       — existing metrics, existing Free/Pro gating
 *   I. Public Profile    — the Findmi link as a compact utility row
 * Sections never reorder; conditional ones simply disappear. */

export interface HomeMetric {
  value: number;
  changeLabel: string | null;
}

export type HomePublicationStatus = "draft" | "pending_review" | "live" | "paused" | "rejected";

/** `line` only where the status needs explaining; Live needs none. */
const STATUS_COPY: Record<HomePublicationStatus, { label: string; tone: "aqua" | "amber" | "neutral"; line: string | null }> = {
  live: { label: "Live", tone: "aqua", line: null },
  pending_review: { label: "Pending Review", tone: "amber", line: "Visible to you now, live in discovery after Findmi reviews it." },
  draft: { label: "Draft", tone: "neutral", line: "Not visible on Findmi yet." },
  paused: { label: "Paused", tone: "neutral", line: "Hidden from Findmi discovery for now." },
  rejected: { label: "Not Approved", tone: "amber", line: "Not visible on Findmi. Contact Findmi with any questions." },
};

/** Clears the 48px header + 44px section rail (+ breathing room). */
const SECTION_CLASS = "scroll-mt-[104px]";

/** Horizontal rail (phones) — runs to the screen edge, snap-scrolling,
 * same treatment as Account Home's rails; the page itself never scrolls
 * sideways. */
const RAIL_CLASS =
  "-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden";

export default function BusinessHome({
  basePath,
  businessId,
  businessName,
  businessSlug,
  publicationStatus,
  pro,
  liveActivities,
  comingUp,
  needsAttention,
  metrics,
  metricsRangeLabel,
  pendingInvitationCount,
  pendingInvitationNames,
  businessHandle,
  updateHandleAction,
  opportunityItems,
}: {
  basePath: string;
  businessId: string;
  businessName: string;
  businessSlug: string | null;
  publicationStatus: HomePublicationStatus;
  pro: boolean;
  /** Happening Now — every live Appearance group / hosted Event (lib/business-dashboard.ts buildHomeComingUp). */
  liveActivities: HomeActivity[];
  /** Next few not-yet-live items, chronological, one per Event / standalone Appearance. */
  comingUp: HomeActivity[];
  needsAttention: NeedsAttentionItem[];
  metrics: { profileViews: HomeMetric; actionsTaken: HomeMetric; qrScans: HomeMetric; followers: number } | null;
  metricsRangeLabel: string | null;
  pendingInvitationCount: number;
  /** Event names of the pending invitations (same list the count is from). */
  pendingInvitationNames?: string[];
  /** Already an item in needsAttention (buildNeedsAttentionItems) — kept
   * as a prop for callers; not rendered a second time. */
  newOrderCount: number;
  businessHandle: string | null;
  updateHandleAction: (formData: FormData) => void | Promise<void>;
  /** This Business's own commercial Opportunities (Business-safe items). */
  opportunityItems: BusinessOpportunityItem[];
}) {
  const liveNow = liveActivities;
  const status = STATUS_COPY[publicationStatus] ?? STATUS_COPY.draft;
  const create = businessCreateActions(basePath, businessId);
  // Pending Event Invitations join Needs Attention (they wait on this
  // Business's response). Routed to the Inbox's Event Invitations filter —
  // the canonical Event-participation destination, never the commercial
  // Opportunities tab.
  const invitedTo = pendingInvitationNames?.length === 1 ? pendingInvitationNames[0] : null;
  const attention: NeedsAttentionItem[] = [
    ...(pendingInvitationCount > 0
      ? [
          {
            id: "event-invitations",
            title: `Event Invitation${pendingInvitationCount === 1 ? "" : "s"}`,
            message: invitedTo
              ? `You\u2019re invited to participate in ${invitedTo}.`
              : `${pendingInvitationCount} Event invitations are waiting for your response.`,
            actionLabel: pendingInvitationCount === 1 ? "Review Invitation" : "Review Invitations",
            actionHref: "/account/messages?filter=opportunities",
          },
        ]
      : []),
    ...needsAttention,
  ];
  const publicHref = businessSlug ? `/business/${businessSlug}` : null;
  const navItems: HomeSectionNavItem[] = [
    { id: "overview", label: "Overview" },
    ...(attention.length > 0 ? [{ id: "home-attention", label: "Attention", count: attention.length }] : []),
    { id: "home-schedule", label: "Schedule" },
    { id: "home-create", label: "Create" },
    ...(metrics ? [{ id: "home-performance", label: "Performance" }] : []),
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* A. Status — identity + Free/Pro live in the context bar above. */}
      <section aria-label="Business status" className="-mb-3">
        <div className="flex items-center justify-between gap-3">
          <Chip tone={status.tone}>{status.label}</Chip>
          {publicHref && (
            <Link href={publicHref} className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent hover:underline">
              {publicationStatus === "live" ? "View Public Profile" : "Preview"}
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          )}
        </div>
        {status.line && <p className="mt-1 text-metadata text-muted">{status.line}</p>}
      </section>

      {/* B. Sticky in-page section rail. */}
      <HomeSectionNav items={navItems} />

      {/* C. Needs Attention — only when something is actionable. */}
      {attention.length > 0 && (
        <section id="home-attention" aria-labelledby="needs-attention" className={SECTION_CLASS}>
          <div className="flex items-center gap-2">
            <h2 id="needs-attention" className="font-display text-section-title font-bold text-primary">
              Needs Attention
            </h2>
            <Chip tone="amber">{attention.length}</Chip>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {attention.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.actionHref}
                  className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/40 px-3.5 py-3 transition hover:border-amber-300"
                >
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-card-title font-semibold text-primary">{item.title}</span>
                    <span className="mt-0.5 block text-metadata text-secondary">{item.message}</span>
                    <span className="mt-1.5 flex items-center gap-1 text-metadata font-bold text-accent">
                      {item.actionLabel}
                      <ChevronIcon direction="right" className="h-3 w-3" />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* D + E. Schedule — Happening Now (only when live), then Coming Up. */}
      <div id="home-schedule" className={`flex flex-col gap-7 ${SECTION_CLASS}`}>
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
                <LiveCard key={a.key} activity={a} />
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="coming-up">
          <SectionTitle id="coming-up" title="Coming Up" href={`${basePath}?tab=findmi-here`} linkLabel="See All" />
          {comingUp.length > 0 ? (
            <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
              {comingUp.map((item) => (
                <li key={item.key}>
                  <UpcomingRow activity={item} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2">
              <p className="text-body text-muted">
                {liveNow.length > 0 ? "Nothing else scheduled yet." : "Nothing scheduled yet."} Tell people where you&rsquo;ll be or host an Event.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[create.where, create.event].map((a) => (
                  <Link
                    key={a.key}
                    href={a.href}
                    className="flex h-10 items-center gap-2 rounded-full border border-black/[0.08] bg-white pl-2.5 pr-4 text-button font-semibold text-primary transition hover:border-findmi/40"
                  >
                    <span className="text-findmi-700">
                      <CreateActionIcon icon={a.icon} className="h-[18px] w-[18px]" />
                    </span>
                    {a.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* F. Create on Findmi — compact horizontal action rail. */}
      <section id="home-create" aria-labelledby="create-on-findmi" className={SECTION_CLASS}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="create-on-findmi" className="font-display text-section-title font-bold text-primary">
            Create on Findmi
          </h2>
          <AddToPresence basePath={basePath} businessId={businessId} variant="link" />
        </div>
        <ul className={`mt-3 ${RAIL_CLASS} lg:grid lg:grid-cols-3 lg:overflow-visible`}>
          {orderedCreateActions(basePath, businessId).map((action) => (
            <li key={action.key} className="w-[min(15.5rem,72vw)] shrink-0 snap-start lg:w-auto">
              <Link
                href={action.href}
                className="flex h-full min-h-[104px] flex-col gap-2 rounded-2xl border border-black/[0.07] bg-white p-3.5 shadow-sm transition hover:border-findmi/40 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-findmi-50 text-findmi-700">
                    <CreateActionIcon icon={action.icon} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 truncate text-card-title font-semibold text-primary">{action.label}</span>
                </span>
                <span className="line-clamp-2 text-metadata text-muted">{action.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* G. Opportunities For You — existing data only, never Pro-gated. */}
      <HomeOpportunities basePath={basePath} items={opportunityItems} />

      {/* H. Performance — existing metrics; trends + full Analytics stay Pro. */}
      {metrics && (
        <section id="home-performance" aria-labelledby="performance-snapshot" className={SECTION_CLASS}>
          <SectionTitle
            id="performance-snapshot"
            title="Performance"
            href={`${basePath}?tab=performance`}
            linkLabel={pro ? "View Performance" : "Unlock Full Analytics"}
          />
          {metricsRangeLabel && <p className="mt-0.5 text-metadata text-subtle">{metricsRangeLabel}</p>}
          {metrics.profileViews.value + metrics.actionsTaken.value + metrics.qrScans.value + metrics.followers === 0 ? (
            <p className="mt-2 text-body text-muted">
              No activity yet. Profile views, actions, QR scans and followers will appear here as people find your Business on Findmi.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricTile label="Profile Views" metric={metrics.profileViews} pro={pro} />
              <MetricTile label="Actions" metric={metrics.actionsTaken} pro={pro} />
              <MetricTile label="QR Scans" metric={metrics.qrScans} pro={pro} />
              <MetricTile label="Followers" metric={{ value: metrics.followers, changeLabel: null }} pro={pro} />
            </div>
          )}
        </section>
      )}

      {/* I. Public Profile — a utility row, not an operational section. */}
      <section aria-labelledby="findmi-link" className="border-t border-black/[0.06] pt-4">
        <h2 id="findmi-link" className="text-label font-bold uppercase text-subtle">
          Public Profile Link
        </h2>
        <div className="mt-1.5">
          <FindmiUrlCard entityType="business" entityId={businessId} entityLabel={businessName} currentHandle={businessHandle} action={updateHandleAction} compact />
        </div>
      </section>
    </div>
  );
}

/** Opportunities For You — a compact entry, not the Opportunities product.
 * With recommendations: the most current relationships (still-unanswered
 * first, then Confirmed, then Interested) — one card, or a short
 * horizontal collection when several real ones exist. Without: the
 * existing Explore Opportunities / Tell Findmi Your Goals actions. */
function HomeOpportunities({ basePath, items }: { basePath: string; items: BusinessOpportunityItem[] }) {
  const awaitingResponse = items.filter((i) => i.view.group === "for_you");
  const ranked = [
    ...awaitingResponse,
    ...items.filter((i) => i.view.group === "confirmed"),
    ...items.filter((i) => i.view.group === "interested"),
  ].slice(0, 3);
  return (
    <section id="home-opportunities" aria-labelledby="home-opportunities-title" className={SECTION_CLASS}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-opportunities-title" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
          Opportunities For You
          {awaitingResponse.length > 0 && <Chip tone="aqua">{awaitingResponse.length} Needs Response</Chip>}
        </h2>
        <Link href={`${basePath}?tab=opportunities`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          View All
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>
      {ranked.length === 1 ? (
        <div className="mt-3 sm:max-w-md">
          <BusinessOpportunityCard item={ranked[0].view} place={ranked[0].place} href={`${basePath}/opportunities/${ranked[0].view.recipientId}`} compact commercialOptions={ranked[0].options} />
        </div>
      ) : ranked.length > 1 ? (
        <ul className={`mt-3 ${RAIL_CLASS}`}>
          {ranked.map((top) => (
            <li key={top.view.recipientId} className="w-[min(18rem,80vw)] shrink-0 snap-start">
              <BusinessOpportunityCard item={top.view} place={top.place} href={`${basePath}/opportunities/${top.view.recipientId}`} compact commercialOptions={top.options} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
          <li>
            <Link href={`${basePath}?tab=opportunities&view=explore`} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <SparkGlyph className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">Explore Opportunities</span>
                <span className="block text-metadata text-muted">Activations, pop-ups, sampling, vending and more.</span>
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
            </Link>
          </li>
          <li>
            <Link href={`${basePath}/opportunities/goals/new`} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <GoalGlyph className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">Tell Findmi Your Goals</span>
                <span className="block text-metadata text-muted">So our team can recommend the right Opportunities.</span>
              </span>
              <ChevronIcon direction="right" className="h-4 w-4 shrink-0 text-ink/30" />
            </Link>
          </li>
        </ul>
      )}
    </section>
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

function LiveCard({ activity: a }: { activity: HomeActivity }) {
  return (
    <Link
      href={a.href}
      className="flex overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-sm transition hover:border-black/15 active:scale-[0.99]"
    >
      <div className="relative w-24 shrink-0 bg-black/[0.04] sm:w-32">
        {a.imageUrl ? (
          <SupabaseImage src={a.imageUrl} alt="" fill sizes="128px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink/20">
            <NavIcon name="calendar" className="h-7 w-7" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 p-3.5">
        <p className="text-label font-bold uppercase text-red-600">
          Live{a.endAt ? ` · until ${formatTime(a.endAt)}` : ""}
          {a.kind === "hosted_event" && <span className="text-subtle"> · Hosting</span>}
        </p>
        <p className="mt-1 line-clamp-2 font-display text-card-title-lg font-semibold leading-snug text-primary">{a.title}</p>
        {a.place && <p className="mt-0.5 truncate text-metadata text-muted">{a.place}</p>}
        <p className="flex items-center gap-1 mt-2 text-metadata font-bold text-accent">
          Manage
          <ChevronIcon direction="right" className="h-3 w-3" />
        </p>
      </div>
    </Link>
  );
}

function UpcomingRow({ activity: a }: { activity: HomeActivity }) {
  return (
    <Link href={a.href} className="flex items-center gap-3 py-3">
      <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-black/[0.04] py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {new Date(a.startAt).toLocaleDateString("en-US", { month: "short", timeZone: APP_TIMEZONE })}
        </span>
        <span className="font-display text-lg font-bold leading-none text-primary">{new Date(a.startAt).toLocaleDateString("en-US", { day: "numeric", timeZone: APP_TIMEZONE })}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-card-title font-semibold text-primary">{a.title}</span>
        <span className="block truncate text-metadata text-muted">
          {a.kind === "hosted_event" ? "Hosting · " : ""}
          {a.temporal.label} · {formatTime(a.startAt)}
          {a.endAt ? `–${formatTime(a.endAt)}` : ""}
          {a.place ? ` · ${a.place}` : ""}
        </span>
        {/* A multi-date Event is one row: its next date above, the rest
            summarized here (every date is under See All). */}
        {a.moreDates > 0 && (
          <span className="block truncate text-metadata font-semibold text-findmi-700">
            {a.moreDates === 1 ? "+ 1 More Date" : `+ ${a.moreDates} More Dates`}
          </span>
        )}
      </span>
      {a.pendingLabel ? (
        <Chip tone="amber">{a.pendingLabel}</Chip>
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
