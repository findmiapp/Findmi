import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { HomeActivity, NeedsAttentionItem } from "@/lib/business-dashboard";
import { MomentGlyph } from "@/components/opportunities/OpportunityGlyphs";
import { businessCreateActions, createOnFindmiActions, type BusinessCreateIcon } from "./createActions";
import { formatTime } from "@/lib/format";
import { Chip } from "../../../owner-ui";
import { SparkGlyph } from "./BusinessAppShell";
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
 * B1 Business Command Center — the hierarchy for ONE Business is:
 *   A. Status        — publication status + public profile link (name,
 *                      logo and Free/Pro already sit in the shell's
 *                      context bar directly above, never repeated here)
 *   B. Create on Findmi — the primary action area: Where I'll Be, Host an
 *                      Event, Add To Product Catalog, At a Location, Create
 *                      A QR Code — each an EXISTING Business-scoped flow
 *   C. Needs Attention — only when something is actionable (existing
 *                      rules + pending Event Invitations, which used to be
 *                      a separate tile; new Orders were already an item)
 *   D. Coming Up     — Happening Now cards, then up to 4 upcoming rows;
 *                      Appearances AND hosted Events, one item per Event
 *                      (B2 — lib/business-dashboard.ts buildHomeComingUp)
 *   E. Opportunities — compact entry point (existing data only)
 *   F. Performance   — existing snapshot, existing Free/Pro gating
 *   then Your Findmi Link (the handle editor). */

export interface HomeMetric {
  value: number;
  changeLabel: string | null;
}

export type HomePublicationStatus = "draft" | "pending_review" | "live" | "paused" | "rejected";

const STATUS_COPY: Record<HomePublicationStatus, { label: string; tone: "aqua" | "amber" | "neutral"; line: string }> = {
  live: { label: "Live", tone: "aqua", line: "Your Business is live on Findmi." },
  pending_review: { label: "Pending Review", tone: "amber", line: "Visible to you now, live in discovery after Findmi reviews it." },
  draft: { label: "Draft", tone: "neutral", line: "Not visible on Findmi yet." },
  paused: { label: "Paused", tone: "neutral", line: "Hidden from Findmi discovery for now." },
  rejected: { label: "Not Approved", tone: "amber", line: "Not visible on Findmi. Contact Findmi with any questions." },
};

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
  // Pending Event Invitations join Needs Attention (they wait on this
  // Business's response). Routed to the Inbox's Event Invitations filter —
  // the canonical Event-participation destination, never the commercial
  // Opportunities tab.
  const attention: NeedsAttentionItem[] = [
    ...(pendingInvitationCount > 0
      ? [
          {
            id: "event-invitations",
            message: `${pendingInvitationCount} Event Invitation${pendingInvitationCount === 1 ? "" : "s"} waiting for your response.`,
            actionLabel: "Respond",
            actionHref: "/account/messages?filter=opportunities",
          },
        ]
      : []),
    ...needsAttention,
  ];
  const publicHref = businessSlug ? `/business/${businessSlug}` : null;
  const moment = businessCreateActions(basePath, businessId).moment;

  return (
    <div className="flex flex-col gap-7">
      {/* A. Status — compact; identity lives in the context bar above.
          Chip + link on one line, the one-line explanation under it, so
          a long status (Pending Review) never squeezes beside the chip. */}
      <section aria-label="Business status">
        <div className="flex items-center justify-between gap-3">
          <Chip tone={status.tone}>{status.label}</Chip>
          {publicHref && (
            <Link href={publicHref} className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent hover:underline">
              {publicationStatus === "live" ? "View Public Profile" : "Preview"}
              <ChevronIcon direction="right" className="h-3 w-3" />
            </Link>
          )}
        </div>
        <p className="mt-1 text-metadata text-muted">{status.line}</p>
      </section>

      {/* B. Create on Findmi — the primary action area. */}
      <section aria-labelledby="create-on-findmi">
        <h2 id="create-on-findmi" className="font-display text-section-title font-bold text-primary">
          Create on Findmi
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {createOnFindmiActions(basePath, businessId).map((action, i) => (
            <li key={action.key} className={i === 0 ? "col-span-2 sm:col-span-1" : ""}>
              <Link
                href={action.href}
                className="flex h-full min-h-[56px] items-center gap-2.5 rounded-2xl border border-black/[0.07] bg-white px-3 py-2.5 transition hover:border-findmi/40 hover:bg-findmi-50/40 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                  <CreateIcon icon={action.icon} />
                </span>
                <span className="min-w-0 text-card-title font-semibold leading-snug text-primary">{action.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        {/* Secondary creation — the existing Moment composer with this
            Business prefilled; deliberately not a sixth primary tile. */}
        <Link
          href={moment.href}
          className="mt-2 inline-flex items-center gap-1.5 text-metadata font-semibold text-accent hover:underline"
        >
          <MomentGlyph className="h-4 w-4" />
          {moment.label}
        </Link>
      </section>

      {/* C. Needs Attention — omitted entirely when nothing is actionable. */}
      {attention.length > 0 && (
        <section aria-labelledby="needs-attention">
          <div className="flex items-center gap-2">
            <h2 id="needs-attention" className="font-display text-section-title font-bold text-primary">
              Needs Attention
            </h2>
            <Chip tone="amber">{attention.length}</Chip>
          </div>
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
            {attention.map((item) => (
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

      {/* D. Coming Up — anything live right now first, then the next few. */}
      <section aria-labelledby="coming-up">
        <SectionTitle id="coming-up" title="Coming Up" href={`${basePath}?tab=findmi-here`} linkLabel="See All" />
        {liveNow.length > 0 && (
          <div aria-labelledby="happening-now" className="mt-3">
            <p id="happening-now" className="flex items-center gap-2 text-label font-bold uppercase text-red-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
              </span>
              Happening Now
            </p>
            <div className="mt-2 flex flex-col gap-3">
              {liveNow.map((a) => (
                <LiveCard key={a.key} activity={a} />
              ))}
            </div>
          </div>
        )}
        {comingUp.length > 0 ? (
          <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
            {comingUp.map((item) => (
              <li key={item.key}>
                <UpcomingRow activity={item} />
              </li>
            ))}
          </ul>
        ) : (
          liveNow.length === 0 && (
            <p className="mt-2 text-body text-muted">
              Nothing scheduled yet. Add <span className="font-semibold text-secondary">Where I&rsquo;ll Be</span> or{" "}
              <span className="font-semibold text-secondary">Host an Event</span> above.
            </p>
          )
        )}
      </section>

      {/* E. Opportunities — compact entry point, existing data only. */}
      <HomeOpportunities basePath={basePath} items={opportunityItems} />

      {/* F. Performance — existing snapshot; trends and full Analytics stay Pro. */}
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

      {/* Your Findmi link — kept on Home so the handle editor stays reachable. */}
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
 * relationship (a still-unanswered Recommendation first, then Confirmed,
 * then Interested) plus a count of how many are awaiting a response; View
 * All opens Opportunities. Without: a productive Explore card and a Tell
 * Findmi What You Need action, never a bare empty box.
 *
 * Opportunities Cleanup Pass A — the count badge used to read "N New",
 * which measured "offered + open + no response yet," not "arrived since
 * you last looked" (there is no seen/viewed timestamp in the schema).
 * Relabeled to describe exactly what it counts. */
function HomeOpportunities({ basePath, items }: { basePath: string; items: BusinessOpportunityItem[] }) {
  const awaitingResponse = items.filter((i) => i.view.group === "for_you");
  const top = awaitingResponse[0] ?? items.find((i) => i.view.group === "confirmed") ?? items.find((i) => i.view.group === "interested") ?? null;
  return (
    <section aria-labelledby="home-opportunities">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-opportunities" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
          Opportunities
          {awaitingResponse.length > 0 && <Chip tone="aqua">{awaitingResponse.length} Needs Response</Chip>}
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
            <BusinessOpportunityCard item={top.view} place={top.place} href={`${basePath}/opportunities/${top.view.recipientId}`} compact commercialOptions={top.options} />
          </div>
        </>
      ) : (
        // B1 — compact when there's nothing recommended yet: two quiet
        // entry rows, not two large promo cards.
        <ul className="mt-2 flex flex-col divide-y divide-black/[0.06]">
          <li>
            <Link href={`${basePath}?tab=opportunities&view=explore`} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
                <SparkGlyph className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-card-title font-semibold text-primary">Explore Opportunities</span>
                <span className="block truncate text-metadata text-muted">Activations, pop-ups, sampling, vending and more.</span>
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
                <span className="block text-card-title font-semibold text-primary">Tell Findmi What You Need</span>
                <span className="block truncate text-metadata text-muted">So our team can recommend the right Opportunities.</span>
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

/** Findmi icon system for a creation action: NavIcon, plus the QR and
 * Moment marks the Business More menu / + Add sheet already use. */
function CreateIcon({ icon }: { icon: BusinessCreateIcon }) {
  if (icon === "qr") return <QrGlyph className="h-5 w-5" />;
  if (icon === "moment") return <MomentGlyph className="h-5 w-5" />;
  return <NavIcon name={icon} className="h-5 w-5" />;
}

/** Same QR mark as the Business More menu (24px / 1.8-stroke family). */
function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5z" fill="currentColor" />
    </svg>
  );
}
