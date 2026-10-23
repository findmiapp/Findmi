import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { HomeActivity, NeedsAttentionItem } from "@/lib/business-dashboard";
import type { BusinessMoment } from "@/lib/business-moments";
import type { GrowthSummary } from "@/lib/growth";
import { FOLLOW_UPS_INITIAL_LIMIT, type FollowUp } from "@/lib/business-follow-ups";
import { REQUESTS_INITIAL_LIMIT, type BusinessRequest } from "@/lib/business-requests";
import { formatTime } from "@/lib/format";
import { Chip } from "../../../owner-ui";
import { businessCreateActions } from "./createActions";
import CreateActionIcon from "./CreateActionIcon";
import AddToPresence from "./AddToPresence";
import HomeSectionNav, { type HomeSectionNavItem } from "./HomeSectionNav";
import NeedsAttentionBar from "./NeedsAttentionBar";
import GrowthPanel from "./GrowthPanel";
import { MomentsStrip } from "./MomentsView";

// Same zone lib/format.ts formats every owner/public time in.
const APP_TIMEZONE = "America/New_York";

/** Business Home — the command center for ONE Business: a summary /
 * control surface, never a second management interface (Findmi Here,
 * Moments, Performance, Growth, More, the Event Manager keep the depth).
 * Built only from data the page already loads; a section with nothing
 * truthful to say is omitted, never rendered empty.
 *
 * Business Manager redesign — locked top-to-bottom hierarchy, each block
 * answering one question:
 *   A. Business status          — publication status + View Public Profile
 *   B. Sticky Home section rail — Overview · Schedule · Growth ·
 *                                 Performance · Create (in-page anchors)
 *   C. Needs Attention          — exceptions this Business can fix; a compact,
 *                                 collapsed status bar; absent at zero
 *   C2. Requests                — conditional; sent TO this Business and waiting
 *                                 on it (lib/business-requests.ts)
 *   D. Follow-Ups               — conditional; this Business's own Target
 *                                 follow-ups (lib/business-follow-ups.ts)
 *   E. Happening Now            — conditional; live Appearances + hosted Events
 *   F. Coming Up                — WHAT'S HAPPENING: image-forward rows, one
 *                                 per Event (multi-date summarized), See All
 *   G. Recent Moments           — conditional; latest Moments, See All
 *   H. Growth                   — HOW CAN FINDMI HELP US GROW: the compact
 *                                 mini-dashboard / setup state
 *   I. Performance              — HOW IS IT PERFORMING (existing metrics)
 *   J. Quick Create             — a few high-value actions + the full "+" sheet
 *   K. Public Profile           — the Findmi link as a utility row
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
  requests,
  requestsExpanded = false,
  followUps,
  followUpsExpanded = false,
  metrics,
  metricsRangeLabel,
  businessHandle,
  updateHandleAction,
  growth,
  recentMoments,
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
  /** Requests — sent TO this Business, waiting on it (lib/business-requests.ts). */
  requests: BusinessRequest[];
  /** `?requests=all`: every Request instead of the first three. */
  requestsExpanded?: boolean;
  /** Follow-Ups — already ordered (lib/business-follow-ups.ts buildFollowUps). */
  followUps: FollowUp[];
  /** `?followups=all`: every Follow-Up instead of the first three. */
  followUpsExpanded?: boolean;
  metrics: { profileViews: HomeMetric; actionsTaken: HomeMetric; qrScans: HomeMetric; followers: number } | null;
  metricsRangeLabel: string | null;
  businessHandle: string | null;
  updateHandleAction: (formData: FormData) => void | Promise<void>;
  /** The one Growth summary (lib/growth.ts) — goals, preferences, matches. */
  growth: GrowthSummary;
  /** Latest Moments posted as this Business (empty = the strip is omitted). */
  recentMoments: BusinessMoment[];
}) {
  const liveNow = liveActivities;
  const status = STATUS_COPY[publicationStatus] ?? STATUS_COPY.draft;
  const create = businessCreateActions(basePath, businessId);
  const publicHref = businessSlug ? `/business/${businessSlug}` : null;
  // Needs Attention is a status bar, not a destination — it has no rail entry.
  const navItems: HomeSectionNavItem[] = [
    { id: "overview", label: "Overview" },
    { id: "home-schedule", label: "Schedule" },
    { id: "home-growth", label: "Growth" },
    ...(metrics ? [{ id: "home-performance", label: "Performance" }] : []),
    { id: "home-create", label: "Create" },
  ];
  // Quick Create — the four highest-value actions; everything else (a
  // Location, the rest) lives in the existing full sheet via View All.
  const quick = [create.where, create.event, create.product, create.qr];

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

      {/* C. Needs Attention — exceptions only; renders nothing at zero. */}
      <NeedsAttentionBar items={needsAttention} />

      {/* C2. Requests — only when something sent to this Business waits on it. */}
      <RequestsSection basePath={basePath} items={requests} expanded={requestsExpanded} />

      {/* D. Follow-Ups — only when this Business has any. */}
      <FollowUpsSection basePath={basePath} items={followUps} expanded={followUpsExpanded} />

      {/* E + F. Schedule — Happening Now (only when live), then Coming Up. */}
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
            <ul className="mt-2.5 flex flex-col gap-2">
              {comingUp.map((item) => (
                <li key={item.key}>
                  <UpcomingRow activity={item} />
                </li>
              ))}
            </ul>
          ) : (
            // Compact: Quick Create below already offers Where I'll Be / Host An Event.
            <p className="mt-2 text-body text-muted">{liveNow.length > 0 ? "Nothing else scheduled yet." : "Nothing scheduled yet."}</p>
          )}
        </section>
      </div>

      {/* G. Recent Moments — only when this Business has posted some. */}
      <MomentsStrip basePath={basePath} moments={recentMoments} />

      {/* H. Growth — the compact mini-dashboard, or the setup state. */}
      <GrowthPanel basePath={basePath} summary={growth} />

      {/* I. Performance — existing metrics; trends + full Analytics stay Pro. */}
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
            <div className="mt-2.5 grid grid-cols-4 gap-1.5">
              <MetricTile label="Views" metric={metrics.profileViews} pro={pro} />
              <MetricTile label={metrics.actionsTaken.value === 1 ? "Action" : "Actions"} metric={metrics.actionsTaken} pro={pro} />
              <MetricTile label="Scans" metric={metrics.qrScans} pro={pro} />
              <MetricTile label="Followers" metric={{ value: metrics.followers, changeLabel: null }} pro={pro} />
            </div>
          )}
        </section>
      )}

      {/* J. Quick Create — a few high-value actions, then the full sheet. */}
      <section id="home-create" aria-labelledby="quick-create" className={SECTION_CLASS}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="quick-create" className="font-display text-section-title font-bold text-primary">
            Quick Create
          </h2>
          <AddToPresence basePath={basePath} businessId={businessId} variant="link" label="View All" />
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quick.map((action) => (
            <li key={action.key} className="min-w-0">
              <Link
                href={action.href}
                className="flex h-12 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-3 text-button font-semibold text-primary transition hover:border-findmi/40 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                <span className="shrink-0 text-findmi-700">
                  <CreateActionIcon icon={action.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 truncate">{quickLabel(action.key, action.label)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* K. Public Profile — a utility row, not an operational section. */}
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

const FOLLOW_UP_META_TONE: Record<NonNullable<FollowUp["due"]>, string> = {
  overdue: "font-semibold text-amber-700",
  today: "font-semibold text-findmi-700",
  soon: "text-muted",
  later: "text-muted",
};

/** Follow-Ups — this Business's own Target next steps (private to it), never a
 * task list: each row opens the relationship that owns it. Absent when there
 * are none (no heading, no empty state). First three, then See All (URL state). */
function FollowUpsSection({ basePath, items, expanded }: { basePath: string; items: FollowUp[]; expanded: boolean }) {
  if (items.length === 0) return null;
  const more = items.length > FOLLOW_UPS_INITIAL_LIMIT;
  const shown = expanded ? items : items.slice(0, FOLLOW_UPS_INITIAL_LIMIT);
  return (
    <section id="home-follow-ups" aria-labelledby="home-follow-ups-title" className={SECTION_CLASS}>
      {more ? (
        <SectionTitle
          id="home-follow-ups-title"
          title="Follow-Ups"
          href={expanded ? `${basePath}#home-follow-ups` : `${basePath}?followups=all#home-follow-ups`}
          linkLabel={expanded ? "Show Less" : `See All ${items.length}`}
        />
      ) : (
        <h2 id="home-follow-ups-title" className="font-display text-section-title font-bold text-primary">
          Follow-Ups
        </h2>
      )}
      <ul className="mt-2.5 flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="block rounded-2xl border border-black/[0.07] bg-white px-3.5 py-3 transition hover:border-black/15 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              <span className="block truncate text-card-title font-semibold text-primary">{item.title}</span>
              <span className={`line-clamp-2 block break-words text-metadata ${item.due ? FOLLOW_UP_META_TONE[item.due] : "text-muted"}`}>{item.meta}</span>
              {item.detail && <span className="mt-0.5 line-clamp-2 block break-words text-body text-secondary">{item.detail}</span>}
              <span className="mt-1.5 flex items-center gap-1 text-metadata font-bold text-accent">
                Open Relationship
                <ChevronIcon direction="right" className="h-3 w-3" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Requests — Opportunities, Event invitations and new orders waiting on this
 * Business. A projection of the records that own them (nothing stored): a row
 * disappears once the Business responds. Absent when there are none (no
 * heading, no empty state). First three, then See All (URL state). */
function RequestsSection({ basePath, items, expanded }: { basePath: string; items: BusinessRequest[]; expanded: boolean }) {
  if (items.length === 0) return null;
  const more = items.length > REQUESTS_INITIAL_LIMIT;
  const shown = expanded ? items : items.slice(0, REQUESTS_INITIAL_LIMIT);
  return (
    <section id="home-requests" aria-labelledby="home-requests-title" className={SECTION_CLASS}>
      {more ? (
        <SectionTitle
          id="home-requests-title"
          title="Requests"
          href={expanded ? `${basePath}#home-requests` : `${basePath}?requests=all#home-requests`}
          linkLabel={expanded ? "Show Less" : `See All ${items.length}`}
        />
      ) : (
        <h2 id="home-requests-title" className="font-display text-section-title font-bold text-primary">
          Requests
        </h2>
      )}
      <ul className="mt-2.5 flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="block rounded-2xl border border-black/[0.07] bg-white px-3.5 py-3 transition hover:border-black/15 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              <span className="block truncate text-card-title font-semibold text-primary">{item.title}</span>
              <span className="line-clamp-2 block break-words text-metadata font-semibold text-findmi-700">{item.meta}</span>
              {item.detail && <span className="mt-0.5 line-clamp-2 block break-words text-body text-secondary">{item.detail}</span>}
              <span className="mt-1.5 flex items-center gap-1 text-metadata font-bold text-accent">
                {item.actionLabel}
                <ChevronIcon direction="right" className="h-3 w-3" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Short chip labels so four actions fit a 360px two-column grid. The
 * full labels stay in the "+" sheet (createActions is the one definition). */
function quickLabel(key: string, fallback: string): string {
  return ({ where: "Where I\u2019ll Be", event: "Host An Event", product: "Add Product", qr: "Create QR" } as Record<string, string>)[key] ?? fallback;
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
  const month = new Date(a.startAt).toLocaleDateString("en-US", { month: "short", timeZone: APP_TIMEZONE });
  const day = new Date(a.startAt).toLocaleDateString("en-US", { day: "numeric", timeZone: APP_TIMEZONE });
  return (
    <Link
      href={a.href}
      className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white p-2 transition hover:border-black/15 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
    >
      {/* Real imagery when the Event / Location has any; otherwise the date
          block itself carries the row. */}
      <span className="relative flex h-14 w-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl bg-black/[0.04]">
        {a.imageUrl ? (
          <>
            <SupabaseImage src={a.imageUrl} alt="" fill sizes="56px" className="object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-white">
              {month} {day}
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{month}</span>
            <span className="font-display text-xl font-bold leading-none text-primary">{day}</span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-card-title font-semibold text-primary">{a.title}</span>
        <span className="block truncate text-metadata text-muted">
          {a.kind === "hosted_event" ? "Hosting · " : ""}
          {a.temporal.label} · {formatTime(a.startAt)}
          {a.endAt ? `\u2013${formatTime(a.endAt)}` : ""}
        </span>
        {a.place && <span className="block truncate text-metadata text-muted">{a.place}</span>}
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
    <div className="min-w-0 rounded-xl bg-black/[0.03] px-2.5 py-2.5">
      <p className="font-display text-xl font-bold leading-none text-primary tabular-nums">{metric.value.toLocaleString()}</p>
      <p className="mt-1 truncate text-metadata font-medium text-muted">{label}</p>
      {change && <p className={`mt-0.5 text-microcopy font-bold ${up ? "text-accent" : "text-subtle"}`}>{change}</p>}
    </div>
  );
}
