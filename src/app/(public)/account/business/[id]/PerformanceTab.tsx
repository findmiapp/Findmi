import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateShort } from "@/lib/format";
import {
  OWNER_PERFORMANCE_RANGES,
  type OwnerPerformanceData,
  type OwnerPerformanceMetric,
  type OwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import type { BusinessFollowerSummary } from "@/lib/business-followers";
import SupabaseImage from "@/components/SupabaseImage";

// Findmi Owner Analytics — presentational-only. Every number here comes
// pre-aggregated from lib/analytics/ownerPerformance.ts; this file never
// touches analytics_events itself, and Visual System Pass 1 changes
// NOTHING about what's computed — only how it's presented.
//
// Visual System Pass 1 — this used to be seven stacked white
// rounded/bordered/shadowed cards (a "component library demo" reading,
// not a report). Replaced with ONE consistent grammar: a section title
// (occasionally a short explanation), its content, a thin divider, the
// next section — see Section() below. A card now appears only where a
// boundary communicates something real: the sparse/empty state (an
// exceptional state, not ordinary content).
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
 * of zeros. */
function compactMetricLine(parts: { count: number; word: string }[]): string {
  return parts
    .filter((p) => p.count > 0)
    .map((p) => plural(p.count, p.word))
    .join(" · ");
}

/** The one repeated unit of the Analytics grammar — a title (font-display,
 * dark, NOT the tiny-gray-uppercase treatment every metric label uses, so
 * a section header actually reads as a header), an optional one-line
 * explanation, then its content. A top divider is the section boundary —
 * no enclosing box. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="border-t border-black/[0.06] pt-5">
      <h2 className="font-display text-base font-bold tracking-tight text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-ink/45">{description}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
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
    <div className="flex flex-col gap-5">
      {/* Range control — a quiet segmented text control, deliberately much
          lighter than the primary Business navigation above it: no filled
          capsules, just weight/tint on the selected value. */}
      <div className="-mx-1 flex gap-1 overflow-x-auto text-xs font-semibold [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {RANGE_TABS.map((r) => {
          const active = r.value === range;
          return (
            <Link
              key={r.value}
              href={`${basePath}?tab=performance&range=${r.value}`}
              aria-current={active ? "true" : undefined}
              className={`shrink-0 rounded-md px-2.5 py-1.5 transition ${
                active ? "bg-findmi-50 text-findmi-700" : "text-ink/40 hover:bg-black/[0.03] hover:text-ink/70"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {/* Headline — three numbers directly on the canvas, no enclosing
          card. The range control immediately above already shows the
          selected period, so it isn't repeated as a heading here. */}
      <div className="grid grid-cols-3 gap-3">
        <HeadlineStat value={data.headline.impressions.value} unit="Impression" changeLabel={data.headline.impressions.changeLabel} />
        <HeadlineStat value={data.headline.profileViews.value} unit="Profile View" changeLabel={data.headline.profileViews.changeLabel} />
        <HeadlineStat value={data.headline.actionsTaken.value} unit="Action" changeLabel={data.headline.actionsTaken.changeLabel} />
      </div>

      {data.isEmpty ? (
        <div className="rounded-2xl bg-black/[0.02] p-4">
          <p className="text-sm font-semibold text-ink">Your performance starts here</p>
          <p className="mt-1.5 text-sm text-ink/60">
            Findmi is now measuring how people discover and interact with {businessName}. Activity will appear here
            as people find your Business, view your profile and take actions — directions, website/social clicks,
            saves, follows, products and QR activity.
          </p>
          <p className="mt-2 text-xs font-semibold text-ink/40">No activity recorded in this period yet.</p>
        </div>
      ) : (
        <div>
          {/* ── Trend ── */}
          {nonZeroTrendPoints.length > 0 && (
            <Section title={`${data.trend.metricLabel} Over Time`}>
              {nonZeroTrendPoints.length === 1 ? (
                <div>
                  <p className="font-display text-2xl font-bold tracking-tight text-ink">
                    {plural(nonZeroTrendPoints[0].value, "profile view")}
                  </p>
                  <p className="mt-0.5 text-xs text-ink/45">{nonZeroTrendPoints[0].label}</p>
                </div>
              ) : (
                <TrendBars points={data.trend.points} />
              )}
            </Section>
          )}

          {/* ── Actions — meaningful things a visitor DID (Save, Follow,
              Directions, Share, RSVP, etc.). Plain typography grid, not a
              field of gray tiles — zero-value items already filtered out
              server-side. ── */}
          {data.secondaryActions.length > 0 && (
            <Section title="Actions">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3">
                {data.secondaryActions.map((item) => (
                  <div key={item.label}>
                    <p className="font-display text-xl font-bold tracking-tight text-ink">{item.count.toLocaleString()}</p>
                    <p className="text-xs text-ink/50">{item.label}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Link Clicks — OUTBOUND clicks to the Business's own
              channels (Website/Instagram/Facebook/TikTok/Phone/Email),
              never "how people reached you". A ranked list, not
              proportional bars: at small counts a near-full-width bar for
              "1" implies a magnitude the number itself doesn't support. ── */}
          {data.contactChannels.length > 0 && (
            <Section title="Link Clicks">
              <div className="flex flex-col divide-y divide-black/[0.06]">
                {data.contactChannels.map((c) => (
                  <div key={c.channel} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-ink">{c.label}</span>
                    <span className="font-semibold text-ink/60">{c.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Audience — Followers folded in as a compact, deliberately
              quieter secondary section (smaller numeral than the headline
              stats above) — same data/privacy rule the old standalone
              Followers tab used, no new query. "(legacy)" replaced with
              plain "email-only": that's the actual, useful distinction
              for an owner (no Findmi account behind it), not a label
              about Findmi's own implementation history. ── */}
          {followerSummary.totalCount > 0 && (
            <Section title="Audience">
              <p className="font-display text-xl font-bold tracking-tight text-ink">{plural(followerSummary.totalCount, "Follower")}</p>
              <p className="mt-0.5 text-xs text-ink/45">
                {followerSummary.accountCount} with a Findmi account
                {followerSummary.legacyCount > 0 && ` · ${followerSummary.legacyCount} email-only`}
              </p>
              {followerSummary.profiles.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {followerSummary.profiles.map((p) => (
                    <Link key={p.username} href={`/user/${p.username}`} className="flex items-center gap-2.5 transition hover:opacity-70">
                      <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-mist">
                        {p.avatar_url && (
                          <SupabaseImage src={p.avatar_url} alt={p.display_name ?? p.username} fill sizes="28px" className="object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{p.display_name || `@${p.username}`}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* ── Discovery Sources — WHERE Findmi displayed this Business/
              content inside Findmi. Click rate is secondary metadata, not
              a badge competing with the source name for attention. See
              Appearance Analytics below for WHICH Appearance — orthogonal
              questions about the same raw event, never double-counted. ── */}
          {data.discoverySources.length > 0 && (
            <Section title="Discovery Sources" description="Where you appeared across Findmi.">
              <div className="flex flex-col divide-y divide-black/[0.06]">
                {data.discoverySources.map((s) => (
                  <div key={s.label} className="py-2.5">
                    <p className="text-sm font-semibold text-ink">{s.label}</p>
                    <p className="mt-0.5 text-xs text-ink/45">
                      {plural(s.impressions, "impression")}
                      {s.clicks > 0 && ` · ${plural(s.clicks, "click")}`}
                    </p>
                    {s.clickRate !== null && <p className="mt-0.5 text-[11px] text-ink/35">{Math.round(s.clickRate * 100)}% click rate</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Appearance Analytics — first-class, never folded into
              Event reporting. Flattened from card-inside-card into a
              plain divided list — each row is informational, not itself
              a tappable object, so it doesn't need its own rounded
              boundary. An impression only means a consumer SAW the
              Appearance on Findmi, never that they physically attended
              (known limitation, unchanged: some impressions still
              honestly resolve only as far as "Appearance Discovery"
              above — see ownerPerformance.ts). ── */}
          {data.appearances.length > 0 && (
            <Section title="Appearance Analytics" description="See which upcoming stops are getting attention.">
              <div className="flex flex-col divide-y divide-black/[0.06]">
                {data.appearances.map((a) => {
                  const metricLine = compactMetricLine([
                    { count: a.impressions, word: "impression" },
                    { count: a.clicks, word: "click" },
                    { count: a.directions, word: "direction" },
                    { count: a.saves, word: "save" },
                    { count: a.qrScans, word: "QR scan" },
                  ]);
                  return (
                    <div key={a.id} className="py-2.5">
                      <p className="truncate text-sm font-semibold text-ink">{a.title}</p>
                      <p className="mt-0.5 text-xs text-ink/45">
                        {formatDateShort(a.startAt)}
                        {a.eventName && ` · ${a.eventName}`}
                        {a.location && ` · ${a.location}`}
                      </p>
                      {metricLine && <p className="mt-0.5 text-xs text-ink/60">{metricLine}</p>}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Product Analytics ── */}
          {data.products.length > 0 && (
            <Section title="Product Analytics">
              <div className="flex flex-col divide-y divide-black/[0.06]">
                {data.products.map((p) => {
                  const metricLine = compactMetricLine([
                    { count: p.impressions, word: "impression" },
                    { count: p.views, word: "view" },
                    { count: p.cardClicks, word: "card click" },
                    { count: p.externalClicks, word: "shop click" },
                    { count: p.saves, word: "save" },
                  ]);
                  return (
                    <div key={p.id} className="py-2.5">
                      <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                      {metricLine && <p className="mt-0.5 text-xs text-ink/60">{metricLine}</p>}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── QR Analytics — never a causal-conversion claim. ── */}
          {data.qr && (
            <Section title="QR Analytics">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="font-display text-xl font-bold tracking-tight text-ink">{data.qr.totalScans.toLocaleString()}</p>
                  <p className="text-xs text-ink/50">Scans</p>
                </div>
                <div>
                  <p className="font-display text-xl font-bold tracking-tight text-ink">{data.qr.uniqueSessions.toLocaleString()}</p>
                  <p className="text-xs text-ink/50">Unique Visitors</p>
                </div>
                <div>
                  <p className="font-display text-xl font-bold tracking-tight text-ink">{data.qr.actionsFromQr.toLocaleString()}</p>
                  <p className="text-xs text-ink/50">Actions</p>
                </div>
              </div>

              {data.qrCampaigns.length > 0 && (
                <div className="mt-4 flex flex-col divide-y divide-black/[0.06] border-t border-black/[0.06]">
                  {data.qrCampaigns.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                        {c.placement && <p className="text-xs text-ink/45">{c.placement}</p>}
                      </div>
                      <p className="shrink-0 text-right text-xs text-ink/55">
                        {c.scans.toLocaleString()} scans
                        <br />
                        {c.uniqueVisitors.toLocaleString()} visitors · {c.actions.toLocaleString()} actions
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/** One headline number — `unit` is the SINGULAR form ("Impression",
 * "Profile View", "Action"); pluralized here from the real value so "1
 * Profile View" reads correctly instead of a static, always-plural
 * label. No funnel-stage eyebrow (Discovery/Interest/Action) — just the
 * plain number an owner asked for. */
function HeadlineStat({ value, unit, changeLabel }: { value: number; unit: string; changeLabel: string | null }) {
  return (
    <div>
      <p className="font-display text-3xl font-bold tracking-tight text-ink">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-ink/50">
        {unit}
        {value === 1 ? "" : "s"}
      </p>
      {changeLabel && (
        <p
          className={`mt-1 text-[11px] font-semibold ${
            changeLabel.startsWith("+") ? "text-findmi-700" : changeLabel.startsWith("-") ? "text-ink/45" : "text-ink/35"
          }`}
        >
          {changeLabel}
        </p>
      )}
    </div>
  );
}

/** No chart library — a plain, dependency-free inline SVG bar row.
 * Deliberately simple: readable at a glance on a ~390px screen, not a
 * zoomable/hoverable analytics widget. Only rendered once there are 2+
 * non-zero buckets to actually compare (a single-bucket trend renders
 * as a compact value+date instead — see the caller). */
function TrendBars({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 100;
  const height = 40;
  const barWidth = width / points.length;
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label={`${points.length}-point trend`}>
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
