import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import {
  OWNER_PERFORMANCE_RANGES,
  type OwnerPerformanceData,
  type OwnerPerformanceMetric,
  type OwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import type { BusinessFollowerSummary } from "@/lib/business-followers";
import SupabaseImage from "@/components/SupabaseImage";

// Findmi Owner Performance V1 (Phase 3.1 mobile/semantics correction) —
// presentational-only. Every number here comes pre-aggregated from
// lib/analytics/ownerPerformance.ts; this file never touches
// analytics_events itself. Deliberately terse, mobile-first (max-w-md,
// same as every other tab on this page — see page.tsx's own wrapper):
// the owner should read the top of this tab in seconds, not scroll a
// dashboard. No chart library — the one trend below is a plain inline
// SVG bar row, with a compact single-point fallback (section 8).
const cardClass = "rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6";
const sectionLabelClass = "text-xs font-bold uppercase tracking-wide text-ink/40";

const RANGE_TABS: { value: OwnerPerformanceRange; label: string }[] = [
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
  { value: "90", label: "90 Days" },
  { value: "all", label: "All Time" },
];

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Only the nonzero metrics, joined into one compact line — "1
 * impression" alone when everything else is zero, never a noisy string
 * of zeros (task section 7). */
function compactMetricLine(parts: { count: number; word: string }[]): string {
  return parts
    .filter((p) => p.count > 0)
    .map((p) => plural(p.count, p.word))
    .join(" · ");
}

export default function PerformanceTab({
  data,
  basePath,
  range,
  businessName,
  followerSummary,
}: {
  data: OwnerPerformanceData;
  basePath: string;
  range: OwnerPerformanceRange;
  businessName: string;
  /** Owner Shell V3, Section 7 — already fetched unconditionally by
   * page.tsx (previously shown in Overview's own "Performance Snapshot"
   * Followers tile); threaded through as a plain prop rather than
   * expanding ownerPerformance.ts's own query/aggregation, since this
   * pass's own instruction is "without adding queries or complexity." */
  followerSummary: BusinessFollowerSummary;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Section 10 — the tab strip above already establishes "you're on
          Performance"; a second standalone "PERFORMANCE" label here was
          redundant. The range selector is now the first thing shown. */}
      <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {RANGE_TABS.map((r) => (
          <Link
            key={r.value}
            href={`${basePath}?tab=performance&range=${r.value}`}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              r.value === range ? "bg-findmi text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.07]"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {/* Headline always renders, even at zero, so Analytics never looks
          like a dead/broken page. Owner Shell V3, Section 10 — no funnel-
          stage eyebrows (Discovery/Interest/Action): just the plain
          numbers a Business owner actually asked for. */}
      <div className={cardClass}>
        <p className={sectionLabelClass}>{data.rangeLabel}</p>
        <div className="mt-3 flex flex-col gap-4">
          <HeadlineRow label="Impressions" metric={data.headline.impressions} />
          <HeadlineRow label="Profile Views" metric={data.headline.profileViews} />
          <HeadlineRow label="Actions" metric={data.headline.actionsTaken} />
        </div>
      </div>

      {data.isEmpty ? (
        <div className={cardClass}>
          <p className="text-sm font-semibold text-ink">Your performance starts here</p>
          <p className="mt-1.5 text-sm text-ink/60">
            Findmi is now measuring how people discover and interact with {businessName}. Activity will appear here
            as people find your Business, view your profile and take actions — directions, website/social clicks,
            saves, follows, products and QR activity.
          </p>
          <p className="mt-2 text-xs font-semibold text-ink/40">No activity recorded in this period yet.</p>
        </div>
      ) : (
        <>
          {/* ── Trend ── */}
          <ProfileViewsTrend data={data} />

          {/* ── Actions — meaningful things a visitor DID (Save, Follow,
              Directions, Share, RSVP, etc.) — compact grid, zero-value
              items already filtered out server-side (progressive
              disclosure). ── */}
          {data.secondaryActions.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Actions</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {data.secondaryActions.map((item) => (
                  <MetricTile key={item.label} label={item.label} value={item.count} />
                ))}
              </div>
            </div>
          )}

          {/* ── Link Clicks — OUTBOUND clicks to your own channels
              (Website/Instagram/Facebook/TikTok/Phone/Email). Owner Shell
              V3, Section 10: this is never "how people reached you" —
              these are clicks AWAY from Findmi, after someone was already
              looking at your Business here. ── */}
          {data.contactChannels.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Link Clicks</p>
              <div className="mt-3 flex flex-col gap-2">
                {data.contactChannels.map((c) => (
                  <BarRow key={c.channel} label={c.label} value={c.count} max={data.contactChannels[0].count} />
                ))}
              </div>
            </div>
          )}

          {/* ── Audience (Owner Shell V3, Section 7) — Followers folded
              in as a compact secondary section, reusing the exact data
              (and privacy rule: only named for the subset with a public
              Findmi profile) the old standalone Followers tab already
              showed. No new query — followerSummary is passed straight
              through from page.tsx, which already fetched it for every
              tab render. ── */}
          {followerSummary.totalCount > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Audience</p>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
                {plural(followerSummary.totalCount, "Follower")}
              </p>
              <p className="mt-0.5 text-xs text-ink/45">
                {followerSummary.accountCount} with a Findmi account
                {followerSummary.legacyCount > 0 && ` · ${followerSummary.legacyCount} email-only (legacy)`}
              </p>
              {followerSummary.profiles.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {followerSummary.profiles.map((p) => (
                    <Link
                      key={p.username}
                      href={`/user/${p.username}`}
                      className="flex items-center gap-2.5 rounded-xl border border-black/5 p-2 transition hover:bg-black/[0.02]"
                    >
                      <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-mist">
                        {p.avatar_url && (
                          <SupabaseImage src={p.avatar_url} alt={p.display_name ?? p.username} fill sizes="32px" className="object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{p.display_name || `@${p.username}`}</p>
                        {p.display_name && <p className="truncate text-xs text-ink/45">@{p.username}</p>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Discovery Sources — WHERE Findmi displayed this Business/
              content inside Findmi. See Appearance Analytics below for
              WHICH Appearance (Section 14 — orthogonal questions about
              the same raw event, never double-counted into each other). ── */}
          {data.discoverySources.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Discovery Sources</p>
              <p className="mt-0.5 text-xs text-ink/45">Where you appeared across Findmi.</p>
              <div className="mt-3 flex flex-col gap-3">
                {data.discoverySources.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{s.label}</p>
                      <p className="text-xs text-ink/45">
                        {plural(s.impressions, "impression")}
                        {s.clicks > 0 && ` · ${plural(s.clicks, "click")}`}
                      </p>
                    </div>
                    {s.clickRate !== null && (
                      <span className="shrink-0 rounded-full bg-findmi-50 px-2.5 py-1 text-[11px] font-bold text-findmi-700">
                        {Math.round(s.clickRate * 100)}% Click Rate
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Appearance Analytics — first-class, never folded into
              Event reporting. An impression only means a consumer SAW
              the Appearance on Findmi, never that they physically
              attended (Phase 3.1's own known-limitation note: The Native
              Rose's current Appearance impressions honestly resolve as
              far as "Appearance Discovery" in Discovery Sources above —
              see ownerPerformance.ts; not changed this pass). ── */}
          {data.appearances.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Appearance Analytics</p>
              <p className="mt-0.5 text-xs text-ink/45">See which upcoming stops are getting attention.</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {data.appearances.map((a) => {
                  const metricLine = compactMetricLine([
                    { count: a.impressions, word: "impression" },
                    { count: a.clicks, word: "click" },
                    { count: a.directions, word: "direction" },
                    { count: a.saves, word: "save" },
                    { count: a.qrScans, word: "QR scan" },
                  ]);
                  return (
                    <div key={a.id} className="rounded-2xl border border-black/5 p-3">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <p className="text-xs text-ink/45">
                        {formatDateShort(a.startAt)}
                        {a.eventName && ` · ${a.eventName}`}
                        {a.location && ` · ${a.location}`}
                      </p>
                      {metricLine && <p className="mt-1 text-xs text-ink/60">{metricLine}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Product Analytics ── */}
          {data.products.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Product Analytics</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {data.products.map((p) => {
                  const metricLine = compactMetricLine([
                    { count: p.impressions, word: "impression" },
                    { count: p.views, word: "view" },
                    { count: p.cardClicks, word: "card click" },
                    { count: p.externalClicks, word: "shop click" },
                    { count: p.saves, word: "save" },
                  ]);
                  return (
                    <div key={p.id} className="rounded-2xl border border-black/5 p-3">
                      <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                      {metricLine && <p className="mt-1 text-xs text-ink/60">{metricLine}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── QR Analytics — never a causal-conversion claim. ── */}
          {data.qr && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>QR Analytics</p>
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                <MetricTile label="QR Scans" value={data.qr.totalScans} />
                <MetricTile label="Unique Visitors" value={data.qr.uniqueSessions} />
                <MetricTile label="Actions From QR Visitors" value={data.qr.actionsFromQr} />
              </div>

              {data.qrCampaigns.length > 0 && (
                <div className="mt-4 flex flex-col gap-2.5 border-t border-black/5 pt-4">
                  {data.qrCampaigns.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                        {c.placement && <p className="text-xs text-ink/45">{c.placement}</p>}
                      </div>
                      <p className="shrink-0 text-right text-xs text-ink/60">
                        {c.scans.toLocaleString()} scans
                        <br />
                        {c.uniqueVisitors.toLocaleString()} visitors · {c.actions.toLocaleString()} actions
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HeadlineRow({ label, metric }: { label: string; metric: OwnerPerformanceMetric }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="font-display text-3xl font-bold tracking-tight text-ink">{metric.value.toLocaleString()}</p>
        <p className="text-sm text-ink/50">{label}</p>
      </div>
      {metric.changeLabel && (
        <p
          className={`mt-0.5 text-xs font-semibold ${
            metric.changeLabel.startsWith("+") ? "text-findmi-700" : metric.changeLabel.startsWith("-") ? "text-ink/50" : "text-ink/40"
          }`}
        >
          {metric.changeLabel}
        </p>
      )}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-black/[0.03] px-3 py-2.5">
      <p className="font-display text-lg font-bold tracking-tight text-ink">{value.toLocaleString()}</p>
      <p className="text-[11px] text-ink/50">{label}</p>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <p className="w-20 shrink-0 truncate text-xs font-semibold text-ink/70">{label}</p>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.04]">
        <div className="h-full rounded-full bg-findmi" style={{ width: `${pct}%` }} />
      </div>
      <p className="w-8 shrink-0 text-right text-xs font-semibold text-ink/60">{value}</p>
    </div>
  );
}

/** Section 8 — a bar-chart trend with only one non-zero bucket renders as
 * one bar filling the whole plot width (barWidth = 100 / points.length,
 * so a short/no-activity window looks like a rendering defect, not a
 * chart). Below two non-zero points, show a compact single-value state
 * instead; the normal bar row only renders once there's a real trend to
 * show. Zero non-zero points is handled upstream (the whole card is
 * omitted by its own caller when every bucket is zero). */
function ProfileViewsTrend({ data }: { data: OwnerPerformanceData }) {
  const nonZero = data.trend.points.filter((p) => p.value > 0);
  if (nonZero.length === 0) return null;

  return (
    <div className={cardClass}>
      <p className={sectionLabelClass}>{data.trend.metricLabel} Over Time</p>
      {nonZero.length === 1 ? (
        <div className="mt-2">
          <p className="font-display text-2xl font-bold tracking-tight text-ink">{plural(nonZero[0].value, "profile view")}</p>
          <p className="text-xs text-ink/45">{nonZero[0].label}</p>
        </div>
      ) : (
        <TrendBars points={data.trend.points} />
      )}
    </div>
  );
}

/** No chart library — a plain, dependency-free inline SVG bar row.
 * Deliberately simple: readable at a glance on a ~390px screen, not a
 * zoomable/hoverable analytics widget. Only rendered by ProfileViewsTrend
 * once there are 2+ non-zero buckets to actually compare. */
function TrendBars({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 100;
  const height = 40;
  const barWidth = width / points.length;
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label={`${points.length}-point trend`}>
        {points.map((p, i) => {
          const barHeight = (p.value / max) * (height - 4);
          return (
            <rect
              key={i}
              x={i * barWidth + barWidth * 0.15}
              y={height - barHeight}
              width={barWidth * 0.7}
              height={Math.max(barHeight, p.value > 0 ? 1.5 : 0)}
              rx={0.8}
              className="fill-findmi"
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink/40">
        <span>{points[0]?.label}</span>
        {points.length > 1 && <span>{points[points.length - 1]?.label}</span>}
      </div>
    </div>
  );
}
