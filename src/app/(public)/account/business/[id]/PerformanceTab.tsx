import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import {
  OWNER_PERFORMANCE_RANGES,
  type OwnerPerformanceData,
  type OwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import type { BusinessFollowerSummary } from "@/lib/business-followers";
import SupabaseImage from "@/components/SupabaseImage";
import { Panel, RowList, Row, Stat } from "../../owner-ui";

// Findmi Owner Product visual system (Sept 2026) — Analytics is
// presentational-only here: every number comes pre-aggregated from
// lib/analytics/ownerPerformance.ts, this file never touches
// analytics_events. What changed is the language: headline numbers are
// a bounded Panel (a real KPI strip, not text floating on the canvas),
// every breakdown is its own bounded Panel (a real report, not a stack
// of dividers), and the trend chart gets an actual filled area instead
// of bare bars.
const RANGE_TABS: { value: OwnerPerformanceRange; label: string }[] = OWNER_PERFORMANCE_RANGES.map((v) => ({
  value: v,
  label: v === "all" ? "All Time" : `${v} Days`,
}));

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** Only the nonzero metrics, joined into one compact line — "1
 * impression" alone when everything else is zero, never a noisy string
 * of zeros. */
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
  /** Already fetched unconditionally by page.tsx; threaded through as a
   * plain prop for the Audience section rather than expanding
   * ownerPerformance.ts's own query/aggregation. */
  followerSummary: BusinessFollowerSummary;
}) {
  const nonZeroTrendPoints = data.trend.points.filter((p) => p.value > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Panel — range control as the header's own meta slot (one
          bounded surface answering "how is it going," not a floating
          control above floating numbers), headline Stats inside. */}
      <Panel
        meta={
          <div className="flex gap-0.5 rounded-lg bg-black/[0.03] p-0.5">
            {RANGE_TABS.map((r) => {
              const active = r.value === range;
              return (
                <Link
                  key={r.value}
                  href={`${basePath}?tab=performance&range=${r.value}`}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                    active ? "bg-white text-ink shadow-sm" : "text-ink/40 hover:text-ink/70"
                  }`}
                >
                  {r.label}
                </Link>
              );
            })}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-4 py-1">
          <Stat value={data.headline.impressions.value.toLocaleString()} label="Impressions" tone={data.headline.impressions.changeLabel?.startsWith("+") ? "up" : "default"} />
          <Stat value={data.headline.profileViews.value.toLocaleString()} label="Profile Views" tone={data.headline.profileViews.changeLabel?.startsWith("+") ? "up" : "default"} />
          <Stat value={data.headline.actionsTaken.value.toLocaleString()} label="Actions" tone={data.headline.actionsTaken.changeLabel?.startsWith("+") ? "up" : "default"} />
        </div>
      </Panel>

      {data.isEmpty ? (
        <Panel padded={false}>
          <div className="px-4 py-5">
            <p className="text-[13px] font-bold text-ink">Your performance starts here</p>
            <p className="mt-1.5 text-[13px] text-ink/55">
              Findmi is now measuring how people discover and interact with {businessName}. Activity will appear here
              as people find your Business, view your profile and take actions.
            </p>
          </div>
        </Panel>
      ) : (
        // A real 2-region composition at desktop: the trend/actions/
        // discovery/appearance/product breakdowns form the wide main
        // column; Audience and QR Analytics become a self-sized rail
        // beside it. Mobile stacks in the same DOM order.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start lg:gap-4">
          <div className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2">
            {/* ── Trend ── */}
            {nonZeroTrendPoints.length > 0 && (
              <Panel title={`${data.trend.metricLabel} Over Time`}>
                {nonZeroTrendPoints.length === 1 ? (
                  <Stat value={nonZeroTrendPoints[0].value.toLocaleString()} label={nonZeroTrendPoints[0].label} />
                ) : (
                  <TrendChart points={data.trend.points} />
                )}
              </Panel>
            )}

            {/* ── Actions — meaningful things a visitor DID (Save, Follow,
                Directions, Share, RSVP, etc.). Zero-value items already
                filtered out server-side. ── */}
            {data.secondaryActions.length > 0 && (
              <Panel title="Actions">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                  {data.secondaryActions.map((item) => (
                    <Stat key={item.label} value={item.count.toLocaleString()} label={item.label} />
                  ))}
                </div>
              </Panel>
            )}

            {/* ── Link Clicks — OUTBOUND clicks to the Business's own
                channels, never "how people reached you". ── */}
            {data.contactChannels.length > 0 && (
              <Panel title="Link Clicks" padded={false}>
                <RowList>
                  {data.contactChannels.map((c) => (
                    <Row key={c.channel} label={c.label} value={c.count.toLocaleString()} />
                  ))}
                </RowList>
              </Panel>
            )}

            {/* ── Discovery Sources — WHERE Findmi displayed this
                Business/content inside Findmi. ── */}
            {data.discoverySources.length > 0 && (
              <Panel title="Discovery Sources" meta={<span className="text-[11px] text-ink/40">Where you appeared</span>} padded={false}>
                <RowList>
                  {data.discoverySources.map((s) => (
                    <Row
                      key={s.label}
                      label={s.label}
                      value={
                        <span className="flex flex-col items-end">
                          <span>
                            {plural(s.impressions, "impression")}
                            {s.clicks > 0 && ` · ${plural(s.clicks, "click")}`}
                          </span>
                          {s.clickRate !== null && <span className="text-[10px] font-normal text-ink/35">{Math.round(s.clickRate * 100)}% click rate</span>}
                        </span>
                      }
                    />
                  ))}
                </RowList>
              </Panel>
            )}

            {/* ── Appearance Analytics — first-class, never folded into
                Event reporting. An impression only means a consumer SAW
                the Appearance on Findmi, never that they physically
                attended (known limitation, unchanged). ── */}
            {data.appearances.length > 0 && (
              <Panel title="Appearance Analytics" meta={<span className="text-[11px] text-ink/40">Which stops are getting attention</span>} padded={false}>
                <RowList>
                  {data.appearances.map((a) => {
                    const metricLine = compactMetricLine([
                      { count: a.impressions, word: "impression" },
                      { count: a.clicks, word: "click" },
                      { count: a.directions, word: "direction" },
                      { count: a.saves, word: "save" },
                      { count: a.qrScans, word: "QR scan" },
                    ]);
                    return (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-2.5">
                        <div className="min-w-0 max-w-full">
                          <p className="truncate text-[13px] font-semibold text-ink">{a.title}</p>
                          <p className="mt-0.5 truncate text-[11px] text-ink/40">
                            {formatDateShort(a.startAt)}
                            {a.eventName && ` · ${a.eventName}`}
                            {a.location && ` · ${a.location}`}
                          </p>
                        </div>
                        {metricLine && <p className="max-w-full shrink-0 text-[12px] font-semibold text-ink/60">{metricLine}</p>}
                      </div>
                    );
                  })}
                </RowList>
              </Panel>
            )}

            {/* ── Product Analytics ── */}
            {data.products.length > 0 && (
              <Panel title="Product Analytics" padded={false}>
                <RowList>
                  {data.products.map((p) => {
                    const metricLine = compactMetricLine([
                      { count: p.impressions, word: "impression" },
                      { count: p.views, word: "view" },
                      { count: p.cardClicks, word: "card click" },
                      { count: p.externalClicks, word: "shop click" },
                      { count: p.saves, word: "save" },
                    ]);
                    return <Row key={p.id} label={p.name} value={metricLine || "—"} />;
                  })}
                </RowList>
              </Panel>
            )}
          </div>

          <div className="flex flex-col gap-4 lg:col-start-3">
            {/* ── Audience — Followers folded in as a compact, deliberately
                quieter secondary section. ── */}
            {followerSummary.totalCount > 0 && (
              <Panel title="Audience">
                <Stat value={followerSummary.totalCount.toLocaleString()} label="Followers" />
                <p className="mt-2 text-[11px] text-ink/40">
                  {followerSummary.accountCount} with a Findmi account
                  {followerSummary.legacyCount > 0 && ` · ${followerSummary.legacyCount} email-only`}
                </p>
                {followerSummary.profiles.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-black/[0.05] pt-3">
                    {followerSummary.profiles.map((p) => (
                      <Link key={p.username} href={`/user/${p.username}`} className="flex items-center gap-2.5 transition hover:opacity-70">
                        <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-mist">
                          {p.avatar_url && (
                            <SupabaseImage src={p.avatar_url} alt={p.display_name ?? p.username} fill sizes="24px" className="object-cover" />
                          )}
                        </div>
                        <p className="truncate text-[13px] font-medium text-ink">{p.display_name || `@${p.username}`}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {/* ── QR Analytics — never a causal-conversion claim. ── */}
            {data.qr && (
              <Panel title="QR Analytics">
                <div className="grid grid-cols-3 gap-2">
                  <Stat value={data.qr.totalScans.toLocaleString()} label="Scans" />
                  <Stat value={data.qr.uniqueSessions.toLocaleString()} label="Visitors" />
                  <Stat value={data.qr.actionsFromQr.toLocaleString()} label="Actions" />
                </div>
                {data.qrCampaigns.length > 0 && (
                  <div className="mt-3 flex flex-col divide-y divide-black/[0.05] border-t border-black/[0.05]">
                    {data.qrCampaigns.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-ink">{c.name}</p>
                          {c.placement && <p className="text-[11px] text-ink/40">{c.placement}</p>}
                        </div>
                        <p className="shrink-0 text-right text-[11px] text-ink/50">
                          {c.scans.toLocaleString()} scans
                          <br />
                          {c.uniqueVisitors.toLocaleString()} visitors
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A real filled-area trend chart (not bare bars) — still a plain,
 * dependency-free inline SVG, still readable at a glance on a ~390px
 * screen. Only rendered once there are 2+ non-zero buckets to actually
 * compare (a single-bucket trend renders as a Stat instead). */
function TrendChart({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 300;
  const height = 88;
  const stepX = width / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => ({ x: i * stepX, y: height - (p.value / max) * (height - 8) - 4 }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${height} L0,${height} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label={`${points.length}-point trend`}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14B0BC" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#14B0BC" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} fill="none" stroke="#14B0BC" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={points[i].value > 0 ? 2.2 : 0} className="fill-findmi" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] font-medium text-ink/35">
        <span>{points[0]?.label}</span>
        {points.length > 1 && <span>{points[points.length - 1]?.label}</span>}
      </div>
    </div>
  );
}
