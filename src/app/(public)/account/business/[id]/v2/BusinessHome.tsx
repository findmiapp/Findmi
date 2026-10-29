import { Suspense } from "react";
import Link from "next/link";
import SupabaseImage from "@/components/SupabaseImage";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import FindmiUrlCard from "@/components/FindmiUrlCard";
import type { HomeActivity, NeedsAttentionItem } from "@/lib/business-dashboard";
import type { GrowthSummary } from "@/lib/growth";
import type { FollowUp } from "@/lib/business-follow-ups";
import type { BusinessRequest } from "@/lib/business-requests";
import type { OwnerPerformanceRange } from "@/lib/analytics/ownerPerformance";
import { formatDateShort, formatTime } from "@/lib/format";
import { Chip } from "../../../owner-ui";
import { managerHref } from "@/lib/manager-links";
import ManagementCards from "./ManagementCards";
import HomeSectionNav, { type HomeSectionNavItem } from "./HomeSectionNav";
import NeedsAttentionBar from "./NeedsAttentionBar";
import GrowthPanel from "./GrowthPanel";
import { HomeInboxRows, HomeInboxSkeleton } from "./HomeInbox";
import { HomePerformanceSkeleton, HomePerformanceTiles } from "./HomePerformance";

/** Business Home — the operating dashboard for ONE Business: a summary /
 * control surface, never a second management interface (Findmi Here,
 * Moments, Performance, Growth, More, the Event Manager keep the depth).
 * Built only from real Findmi data; nothing is invented to fill a module.
 *
 * Business Manager Overview — locked top-to-bottom hierarchy, each block
 * answering one question:
 *   A. Business status       — publication status + Manage / View Public Profile
 *   B. Section rail          — Overview · Our Schedule · Opportunities ·
 *                              Performance (sticky, in-page anchors)
 *   C. Create & Manage       — WHAT CAN I CREATE / MANAGE: landscape cards,
 *                              + Add / View All each (ManagementCards)
 *   D. Coming Up             — WHAT'S HAPPENING NEXT: Happening Now (only when
 *                              live), then a chronological rail, one card per
 *                              Event / standalone Appearance
 *   E. Inbox / Follow-Ups    — WHAT NEEDS MY ATTENTION: Needs Attention bar +
 *                              one ranked list of Follow-Ups, Inbox threads and
 *                              Requests (lib/home-inbox.ts)
 *   F. Growth Manager        — HOW CAN I GROW: Goals · Opportunities · Ideas
 *   G. Performance           — HOW AM I PERFORMING: four headline metrics
 *   H. Public Profile Link   — a utility row (the Findmi link / handle)
 * Sections never reorder. E's list and G's tiles each stream in behind their
 * own Suspense boundary (sized like the module), so the shell, Create & Manage
 * and Coming Up never wait on the Inbox or the analytics read, and a failure
 * in either stays inside its module. */

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
  followUps,
  inboxExpanded = false,
  performanceRange,
  followers,
  businessHandle,
  updateHandleAction,
  growth,
}: {
  basePath: string;
  businessId: string;
  businessName: string;
  businessSlug: string | null;
  publicationStatus: HomePublicationStatus;
  pro: boolean;
  /** Happening Now — every live Appearance group / hosted Event (lib/business-dashboard.ts buildHomeComingUp). */
  liveActivities: HomeActivity[];
  /** Next not-yet-live items, chronological, one per Event / standalone Appearance. */
  comingUp: HomeActivity[];
  needsAttention: NeedsAttentionItem[];
  /** Requests — sent TO this Business, waiting on it (lib/business-requests.ts). */
  requests: BusinessRequest[];
  /** Follow-Ups — already ordered (lib/business-follow-ups.ts buildFollowUps). */
  followUps: FollowUp[];
  /** `?inbox=all`: every ranked Inbox / Follow-Ups row instead of the first few. */
  inboxExpanded?: boolean;
  /** The Performance range Home summarizes (the Performance page's default). */
  performanceRange: OwnerPerformanceRange;
  /** Follower total (getBusinessFollowerSummary). */
  followers: number;
  businessHandle: string | null;
  updateHandleAction: (formData: FormData) => void | Promise<void>;
  /** The one Growth summary (lib/growth.ts) — goals, preferences, matches. */
  growth: GrowthSummary;
}) {
  const liveNow = liveActivities;
  const status = STATUS_COPY[publicationStatus] ?? STATUS_COPY.draft;
  const publicHref = businessSlug ? `/business/${businessSlug}` : null;
  const navItems: HomeSectionNavItem[] = [
    { id: "overview", label: "Overview" },
    { id: "home-schedule", label: "Our Schedule" },
    { id: "home-growth", label: "Opportunities" },
    { id: "home-performance", label: "Performance" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* A. Status — identity + Free/Pro live in the context bar above. */}
      <section aria-label="Business status" className="-mb-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Chip tone={status.tone}>{status.label}</Chip>
          {/* Two different actions, never merged: Manage Profile edits what
              customers see; View Public Profile shows it. */}
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href={managerHref(businessId, "profile")}
              className="flex h-9 items-center rounded-full border border-findmi-200 bg-white px-3.5 text-metadata font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
            >
              Manage Profile
            </Link>
            {publicHref && (
              <Link href={publicHref} className="flex shrink-0 items-center gap-1 text-metadata font-bold text-accent hover:underline">
                {publicationStatus === "live" ? "View Public Profile" : "Preview"}
                <ChevronIcon direction="right" className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
        {status.line && <p className="mt-1 text-metadata text-muted">{status.line}</p>}
      </section>

      {/* B. Create & Manage — the persistent management launcher (Events,
          Locations, Products, QR Codes, Moments, Targets), each with + Add
          (canonical creation flow) and View All. It sits ABOVE the section
          rail: the rail chooses the view, the launcher is always there. */}
      <ManagementCards businessId={businessId} />

      {/* C. Sticky in-page section rail (the existing manager section nav). */}
      <HomeSectionNav items={navItems} />

      {/* D. Schedule — Happening Now (only when live), then Coming Up. */}
      <div id="home-schedule" className={`-mt-1 flex flex-col gap-4 ${SECTION_CLASS}`}>
        {liveNow.length > 0 && (
          <section aria-labelledby="happening-now">
            <h2 id="happening-now" className="flex items-center gap-2 font-display text-section-title font-bold text-primary">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
              </span>
              Happening Now
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {liveNow.map((a) => (
                <LiveCard key={a.key} activity={a} />
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="coming-up">
          <SectionTitle id="coming-up" title="Coming Up" href={`${basePath}?tab=findmi-here`} linkLabel="See All" />
          {comingUp.length > 0 ? (
            <ul className="-mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
              {comingUp.map((item) => (
                <li key={item.key} data-coming-up-card className="w-[64%] min-w-0 shrink-0 snap-start sm:w-[40%] lg:w-[calc((100%-1rem)/3)]">
                  <UpcomingCard activity={item} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 flex items-center gap-2.5 rounded-2xl border border-dashed border-black/15 px-3 py-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-findmi-50 text-findmi-700">
                <NavIcon name="calendar" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-snug text-primary">{liveNow.length > 0 ? "Nothing else scheduled yet" : "Nothing scheduled yet"}</span>
                <span className="block text-metadata leading-snug text-muted">Add an Event you&rsquo;re hosting or appearing at.</span>
              </span>
              <Link
                href={managerHref(businessId, "add-event")}
                className="flex h-9 shrink-0 items-center rounded-full border border-findmi-200 bg-findmi-50 px-3 text-metadata font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                + Add Event
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* E. Inbox / Follow-Ups — what needs attention, as ONE operational
          panel: the compact Needs Attention row (renders nothing at zero) is
          synchronous; the ranked rows stream in below it, inside the same
          container. */}
      <section id="home-inbox" aria-labelledby="home-inbox-title" className={SECTION_CLASS}>
        <SectionTitle id="home-inbox-title" title="Inbox / Follow-Ups" href={managerHref(businessId, "inbox")} linkLabel="View All" />
        <div data-inbox-panel className="mt-2 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
          <NeedsAttentionBar items={needsAttention} />
          <Suspense fallback={<HomeInboxSkeleton />}>
            <HomeInboxRows businessId={businessId} basePath={basePath} followUps={followUps} requests={requests} expanded={inboxExpanded} />
          </Suspense>
        </div>
      </section>

      {/* F. Growth Manager — Goals · Opportunities · Ideas. */}
      <GrowthPanel basePath={basePath} summary={growth} />

      {/* G. Performance — existing metrics; trends + full Analytics stay Pro. */}
      <section id="home-performance" aria-labelledby="performance-snapshot" className={SECTION_CLASS}>
        <SectionTitle
          id="performance-snapshot"
          title="Performance"
          href={managerHref(businessId, "performance")}
          linkLabel={pro ? "View All" : "Unlock Full Analytics"}
        />
        <Suspense fallback={<HomePerformanceSkeleton />}>
          <HomePerformanceTiles businessId={businessId} range={performanceRange} followers={followers} />
        </Suspense>
      </section>

      {/* H. Public Profile — ONE compact utility panel: the Findmi link with
          its Copy Link / Change, plus Manage Profile and Photos. */}
      <section aria-labelledby="findmi-link" className="rounded-2xl border border-black/[0.07] bg-white px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="findmi-link" className="flex items-center gap-1.5 text-[14px] font-semibold leading-snug text-primary">
            <NavIcon name="storefront" className="h-4 w-4 text-findmi-700" />
            Public Profile
          </h2>
          <div className="flex shrink-0 items-center gap-3">
            <Link href={managerHref(businessId, "profile")} className="text-metadata font-semibold text-accent hover:underline">
              Manage Profile
            </Link>
            <Link href={managerHref(businessId, "gallery")} className="text-metadata font-semibold text-accent hover:underline">
              Photos
            </Link>
          </div>
        </div>
        <div className="mt-1">
          <FindmiUrlCard entityType="business" entityId={businessId} entityLabel={businessName} currentHandle={businessHandle} action={updateHandleAction} compact />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ id, title, href, linkLabel }: { id: string; title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-display text-section-title font-bold leading-tight text-primary">
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

/** One Coming Up card: date · time, title, place, and what kind of activity it
 * is. A multi-date Event is ONE card at its next date, with the rest counted
 * ("+ N More Dates" — every date is under See All). */
function UpcomingCard({ activity: a }: { activity: HomeActivity }) {
  return (
    <Link
      href={a.href}
      className="flex h-full items-center gap-2.5 rounded-2xl border border-black/[0.07] bg-white p-2 transition hover:border-black/15 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
    >
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/[0.04] text-ink/25">
        {a.imageUrl ? <SupabaseImage src={a.imageUrl} alt="" fill sizes="48px" className="object-cover" /> : <NavIcon name="calendar" className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold leading-tight text-findmi-700">
          {formatDateShort(a.startAt)} · {formatTime(a.startAt)}
        </span>
        <span className="mt-0.5 block truncate text-[14px] font-semibold leading-snug text-primary">{a.title}</span>
        {a.place && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] leading-snug text-muted">
            <NavIcon name="pin" className="h-3 w-3 shrink-0" />
            <span className="truncate">{a.place}</span>
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase leading-tight tracking-wide">
          <span className="shrink-0 text-subtle">{a.kind === "hosted_event" ? "Hosting" : "Appearing"}</span>
          {a.moreDates > 0 && <span className="truncate normal-case tracking-normal text-findmi-700">{a.moreDates === 1 ? "+ 1 More Date" : `+ ${a.moreDates} More Dates`}</span>}
        </span>
        {a.pendingLabel && (
          <span className="mt-0.5 block">
            <Chip tone="amber">{a.pendingLabel}</Chip>
          </span>
        )}
      </span>
      <ChevronIcon direction="right" className="hidden h-3 w-3 shrink-0 text-ink/25 min-[380px]:block" />
    </Link>
  );
}
