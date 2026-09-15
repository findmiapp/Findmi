import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import {
  OWNER_PERFORMANCE_RANGES,
  type OwnerPerformanceData,
  type OwnerPerformanceMetric,
  type OwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";

// Findmi Owner Performance V1 — presentational-only. Every number here
// comes pre-aggregated from lib/analytics/ownerPerformance.ts; this file
// never touches analytics_events itself. Deliberately terse, mobile-first
// (max-w-md, same as every other tab on this page — see page.tsx's own
// wrapper): the owner should read the top of this tab in seconds, not
// scroll a dashboard. No chart library — the one trend below is a plain
// inline SVG bar row.
const cardClass = "rounded-3xl border border-black/5 bg-white p-5 shadow-sm sm:p-6";
const sectionLabelClass = "text-xs font-bold uppercase tracking-wide text-ink/40";

const RANGE_TABS: { value: OwnerPerformanceRange; label: string }[] = [
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
  { value: "90", label: "90 Days" },
  { value: "all", label: "All Time" },
];

export default function PerformanceTab({
  data,
  basePath,
  range,
}: {
  data: OwnerPerformanceData;
  basePath: string;
  range: OwnerPerformanceRange;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className={sectionLabelClass}>Performance</p>
        <div className="mt-2 flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
      </div>

      {data.isEmpty ? (
        <div className={cardClass}>
          <p className="text-sm font-semibold text-ink">No activity recorded yet.</p>
          <p className="mt-1.5 text-sm text-ink/50">
            Findmi Performance began recording activity when this feature launched — it can&rsquo;t show anything
            from before that. Check back after your Business has had some real visits, or try a longer date range
            above.
          </p>
        </div>
      ) : (
        <>
          {/* ── Headline — three primary stages, never twelve tiles. ── */}
          <div className={cardClass}>
            <p className={sectionLabelClass}>{data.rangeLabel}</p>
            <div className="mt-3 flex flex-col gap-4">
              <HeadlineRow eyebrow="Discovery" label="Impressions" metric={data.headline.impressions} />
              <HeadlineRow eyebrow="Interest" label="Profile Views" metric={data.headline.profileViews} />
              <HeadlineRow eyebrow="Action" label="Actions Taken" metric={data.headline.actionsTaken} />
            </div>
          </div>

          {/* ── Trend ── */}
          {data.trend.points.some((p) => p.value > 0) && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>{data.trend.metricLabel} Over Time</p>
              <TrendBars points={data.trend.points} />
            </div>
          )}

          {/* ── Secondary actions — compact grid, zero-value items already
              filtered out server-side (progressive disclosure). ── */}
          {data.secondaryActions.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>What People Did</p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {data.secondaryActions.map((item) => (
                  <MetricTile key={item.label} label={item.label} value={item.count} />
                ))}
              </div>
            </div>
          )}

          {/* ── Contact channel breakdown ── */}
          {data.contactChannels.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>How People Reached You</p>
              <div className="mt-3 flex flex-col gap-2">
                {data.contactChannels.map((c) => (
                  <BarRow key={c.channel} label={c.label} value={c.count} max={data.contactChannels[0].count} />
                ))}
              </div>
            </div>
          )}

          {/* ── Discovery performance ── */}
          {data.discoverySources.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Where People Found You</p>
              <div className="mt-3 flex flex-col gap-3">
                {data.discoverySources.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{s.label}</p>
                      <p className="text-xs text-ink/45">
                        {s.impressions.toLocaleString()} impression{s.impressions === 1 ? "" : "s"}
                        {s.clicks > 0 && ` · ${s.clicks.toLocaleString()} click${s.clicks === 1 ? "" : "s"}`}
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

          {/* ── Appearance performance — first-class, never folded into
              Event reporting. ── */}
          {data.appearances.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Where People Found You In Person</p>
              <div className="mt-3 flex flex-col gap-3">
                {data.appearances.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-black/5 p-3.5">
                    <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                    <p className="text-xs text-ink/45">
                      {formatDateShort(a.startAt)}
                      {a.eventName && ` · ${a.eventName}`}
                      {a.location && ` · ${a.location}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/60">
                      {a.impressions > 0 && <span>{a.impressions.toLocaleString()} impressions</span>}
                      {a.clicks > 0 && <span>{a.clicks.toLocaleString()} clicks</span>}
                      {a.directions > 0 && <span>{a.directions.toLocaleString()} directions</span>}
                      {a.saves > 0 && <span>{a.saves.toLocaleString()} saves</span>}
                      {a.qrScans > 0 && <span>{a.qrScans.toLocaleString()} QR scans</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Product interest ── */}
          {data.products.length > 0 && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>Product Interest</p>
              <div className="mt-3 flex flex-col gap-3">
                {data.products.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-black/5 p-3.5">
                    <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/60">
                      {p.impressions > 0 && <span>{p.impressions.toLocaleString()} impressions</span>}
                      {p.views > 0 && <span>{p.views.toLocaleString()} views</span>}
                      {p.cardClicks > 0 && <span>{p.cardClicks.toLocaleString()} card clicks</span>}
                      {p.externalClicks > 0 && <span>{p.externalClicks.toLocaleString()} shop clicks</span>}
                      {p.saves > 0 && <span>{p.saves.toLocaleString()} saves</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── QR performance — never a causal-conversion claim. ── */}
          {data.qr && (
            <div className={cardClass}>
              <p className={sectionLabelClass}>QR Performance</p>
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

function HeadlineRow({ eyebrow, label, metric }: { eyebrow: string; label: string; metric: OwnerPerformanceMetric }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-findmi-700">{eyebrow}</p>
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

/** No chart library — a plain, dependency-free inline SVG bar row.
 * Deliberately simple: readable at a glance on a ~390px screen, not a
 * zoomable/hoverable analytics widget. */
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
