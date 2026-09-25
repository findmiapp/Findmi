import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import {
  OWNER_PERFORMANCE_RANGES,
  type OwnerPerformanceAppearance,
  type OwnerPerformanceData,
  type OwnerPerformanceMetric,
  type OwnerPerformanceProduct,
  type OwnerPerformanceRange,
} from "@/lib/analytics/ownerPerformance";
import type { BusinessFollowerSummary } from "@/lib/business-followers";
import SupabaseImage from "@/components/SupabaseImage";
import { Panel, RowList, Row, Stat, SectionEyebrow, PerformanceMetric, ShareBar, RankedPerformanceRow, secondaryButtonClass } from "../../owner-ui";

// Performance Command Center pass — Analytics stays presentational-only
// here: every number still comes pre-aggregated from
// lib/analytics/ownerPerformance.ts, this file never touches
// analytics_events, and no new metric is computed anywhere in this file
// that ownerPerformance.ts didn't already return.
//
// Low-Data Polish pass — the Command Center redesign correctly handles
// TRUE ZERO DATA (data.isEmpty: KPI strip + one onboarding module) and
// HEALTHY DATA (every section has real content), but a real production
// business with SOME activity in only one or two areas (e.g. a couple
// of impressions, nothing else yet) previously saw most sections
// silently disappear — the page looked like it stopped working rather
// than like a capable product waiting for more activity. Every section
// below data.isEmpty now always renders its shell (title still real,
// no icons/warnings/illustrations), and shows either its real content
// or a short, calm SectionWaiting line — never a graveyard of zeroed-
// out individual metrics, and never fake/interpolated data. QR stays
// the one deliberate exception: it's still fully absent without a real
// QR campaign, since owner QR self-service doesn't exist yet.
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

/** A section header that ALWAYS stacks title above subtitle, at every
 * width — the fix for the production mobile bug where Panel's own
 * title+meta slot (a single flex row, no wrap) forced a section title
 * and a full sentence of supporting copy to fight for the same line on
 * a ~360px phone. Every Analytics section below uses this instead of
 * Panel's built-in title/meta props, so none of them can develop that
 * same narrow-column wrapping problem. Kept local — nothing outside
 * this one Analytics-specific header pattern needs it today. */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-black/[0.06] px-4 py-3">
      <h2 className="text-[13px] font-bold text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[11.5px] text-ink/45">{subtitle}</p>}
    </div>
  );
}

/** A calm, compact "the report is ready, we're waiting for activity"
 * line — never an error/warning treatment (no icon, no color beyond
 * the page's normal muted text), never more than two short lines. Used
 * wherever a section has zero rows in a business that is NOT globally
 * data.isEmpty — i.e. the business has some real activity elsewhere,
 * so this section's capability should still be communicated, just
 * honestly marked as not populated yet. `title` is omitted when the
 * section already has its own compact label (e.g. a SectionEyebrow)
 * immediately above, so the waiting copy never doubles a heading. */
function SectionWaiting({ title, body }: { title?: string; body: string }) {
  return (
    <div className="py-1">
      {title && <p className="text-[13px] font-semibold text-ink/70">{title}</p>}
      <p className={`text-[12px] leading-relaxed text-ink/45 ${title ? "mt-1" : ""}`}>{body}</p>
    </div>
  );
}

// ── Low-data-aware comparison formatting ────────────────────────────
// Presentation-only: reads the EXISTING value/previousValue/changeLabel
// an OwnerPerformanceMetric already carries and decides how to phrase
// it. Never recomputes a percentage and never touches
// ownerPerformance.ts's own changeLabel() — a percentage sentence
// computed from a previous-period value under LOW_DATA_FLOOR (e.g.
// "1 -> 2" reading as a real but misleading "+100%") is replaced with
// an honest absolute comparison instead, using the exact same
// value/previousValue the backend already returned.
const LOW_DATA_FLOOR = 5;

function formatComparison(metric: OwnerPerformanceMetric): { text: string | null; tone: "up" | "down" | "neutral" } {
  if (metric.previousValue === null || metric.changeLabel === null) return { text: null, tone: "neutral" };
  if (metric.changeLabel === "New") return { text: "New", tone: "up" };
  if (metric.changeLabel === "No change") return { text: "No change", tone: "neutral" };
  if (metric.previousValue > 0 && metric.previousValue < LOW_DATA_FLOOR) {
    const delta = metric.value - metric.previousValue;
    if (delta === 0) return { text: "No change", tone: "neutral" };
    return { text: `${delta > 0 ? "+" : ""}${delta} vs previous period`, tone: delta > 0 ? "up" : "down" };
  }
  // changeLabel is guaranteed to be the "+N% vs previous X days" shape
  // by this point (New/No change/low-data already handled above).
  return { text: metric.changeLabel, tone: metric.changeLabel.startsWith("+") ? "up" : "down" };
}

// ── Ranked-list scoring ──────────────────────────────────────────────
// Presentation-only normalization for RankedPerformanceRow's bar width.
// Reuses only fields ownerPerformance.ts already returns; never changes
// WHICH item is #1 (the array itself is already server-ranked — this
// only derives a 0..1 proportion of each item's engagement relative to
// the top item in that same already-sorted array).
function appearanceEngagementScore(a: OwnerPerformanceAppearance): number {
  return a.clicks + a.directions + a.saves + a.qrScans;
}
function productEngagementScore(p: OwnerPerformanceProduct): number {
  return p.cardClicks + p.externalClicks + p.saves + p.views;
}

export default function PerformanceTab({
  data,
  basePath,
  range,
  businessName,
  businessSlug,
  followerSummary,
}: {
  data: OwnerPerformanceData;
  basePath: string;
  range: OwnerPerformanceRange;
  businessName: string;
  /** Threaded through as a plain prop so the zero-data module's "Share
   * your Findmi page" CTA can link to the real public profile without
   * this file querying anything itself — page.tsx already has it. */
  businessSlug: string | null;
  /** Already fetched unconditionally by page.tsx; threaded through as a
   * plain prop for the Audience section rather than expanding
   * ownerPerformance.ts's own query/aggregation. */
  followerSummary: BusinessFollowerSummary;
}) {
  const nonZeroTrendPoints = data.trend.points.filter((p) => p.value > 0);

  const impressionsComparison = formatComparison(data.headline.impressions);
  const profileViewsComparison = formatComparison(data.headline.profileViews);
  const actionsComparison = formatComparison(data.headline.actionsTaken);

  const emptyStateActions = [
    { href: `${basePath}?tab=profile`, label: "Complete your profile" },
    { href: `${basePath}?tab=products`, label: "Add products" },
    { href: `${basePath}?tab=findmi-here`, label: "Publish where you'll be" },
    ...(businessSlug ? [{ href: `/business/${businessSlug}`, label: "Share your Findmi page" }] : []),
  ];

  // ── Discovery Sources -> proportional share bars ──
  const totalDiscoveryImpressions = data.discoverySources.reduce((sum, s) => sum + s.impressions, 0);

  // ── "What People Do Next" -> grouped by the same three concepts a
  // consumer actually experiences (do something ON Findmi, take a
  // commerce/event action, or leave via a link) rather than one flat
  // list of nine unrelated-looking rows. ──
  const ENGAGEMENT_LABELS = new Set(["Directions", "Saves", "Follows", "Shares"]);
  const engagementActions = data.secondaryActions.filter((a) => ENGAGEMENT_LABELS.has(a.label));
  const commerceEventActions = data.secondaryActions.filter((a) => !ENGAGEMENT_LABELS.has(a.label));

  const hasWhatsNext = engagementActions.length > 0 || commerceEventActions.length > 0 || data.contactChannels.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Performance Header + KPI Command Strip — the page's one
          visual anchor. Title/range control on top, four headline
          metrics below a hairline divider, sized to actually read as a
          command instrument rather than four small numbers floating in
          a generic grid. Unchanged this pass except the Followers
          caption below. ── */}
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="font-display text-[19px] font-bold tracking-tight text-ink">Performance</h1>
            <p className="mt-0.5 text-[13px] text-ink/50">Understand how people discover and engage with {businessName}.</p>
          </div>
          <div className="flex shrink-0 gap-0.5 self-start rounded-lg bg-black/[0.04] p-0.5">
            {RANGE_TABS.map((r) => {
              const active = r.value === range;
              return (
                <Link
                  key={r.value}
                  href={`${basePath}?tab=performance&range=${r.value}`}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold transition ${
                    active ? "bg-findmi text-white shadow-sm" : "text-ink/45 hover:text-ink/70"
                  }`}
                >
                  {r.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-black/[0.06] pt-5 sm:grid-cols-4 sm:gap-x-6">
          <PerformanceMetric
            label="Impressions"
            value={data.headline.impressions.value.toLocaleString()}
            comparison={impressionsComparison.text}
            comparisonTone={impressionsComparison.tone}
          />
          <PerformanceMetric
            label="Profile Views"
            value={data.headline.profileViews.value.toLocaleString()}
            comparison={profileViewsComparison.text}
            comparisonTone={profileViewsComparison.tone}
          />
          <PerformanceMetric
            label="Actions Taken"
            value={data.headline.actionsTaken.value.toLocaleString()}
            comparison={actionsComparison.text}
            comparisonTone={actionsComparison.tone}
          />
          {/* Low-Data Polish pass — was "People who follow your business
              appear here." when zero, which read as an empty-state
              instruction living inside a KPI tile rather than a metric
              caption. A plain, constant "Total followers" now labels
              this tile the same way regardless of count (the
              account/legacy breakdown still lives in the Audience
              section below, not duplicated here) — never implies growth,
              never adds a period comparison (not available today). */}
          <PerformanceMetric label="Followers" value={followerSummary.totalCount.toLocaleString()} helpText="Total followers" />
        </div>
      </Panel>

      {data.isEmpty ? (
        // TRUE ZERO DATA — unchanged from the previous pass: KPI strip
        // above, plus exactly this one onboarding module. None of the
        // section-level waiting states below ever render here.
        <Panel padded={false}>
          <div className="px-4 py-5">
            <p className="text-[15px] font-bold text-ink">Your performance starts here</p>
            <p className="mt-1.5 text-[13px] text-ink/55">
              As people discover {businessName}, view your profile and take action, your performance will appear here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-black/[0.06] pt-4">
              {emptyStateActions.map((a) => (
                <Link key={a.href} href={a.href} className={secondaryButtonClass("sm")}>
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        </Panel>
      ) : (
        // SOME DATA / LOW DATA / HEALTHY DATA — one continuum, not two
        // separate branches: every section below always renders its
        // real shell now; each independently shows real content or a
        // compact SectionWaiting line depending on whether ITS OWN data
        // is populated. A business healthy in every section simply
        // never hits any SectionWaiting branch. Same 2/3 main-column +
        // 1/3 rail composition, same "four questions" order, same
        // mobile DOM-order stacking as before.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start lg:gap-4">
          <div className="flex flex-col gap-4 lg:col-start-1 lg:col-span-2">
            {/* ── Discovery Trend — enlarged from a 96px decorative
                sparkline into the page's one real chart moment. Still
                Profile Views only, still the same dependency-free SVG.
                Now always rendered (was: hidden entirely with zero
                non-zero points) with an honest waiting state instead of
                a fake flat line. ── */}
            <Panel padded={false}>
              <SectionHeader title="Discovery Trend" subtitle="Profile views over this period" />
              <div className="px-4 pb-4 pt-3">
                {nonZeroTrendPoints.length === 0 ? (
                  <SectionWaiting
                    title="No profile views yet"
                    body="Your profile-view trend will begin building as people open your Findmi profile."
                  />
                ) : nonZeroTrendPoints.length === 1 ? (
                  <PerformanceMetric
                    value={nonZeroTrendPoints[0].value.toLocaleString()}
                    label={nonZeroTrendPoints[0].label}
                    helpText="Profile views"
                  />
                ) : (
                  <TrendChart points={data.trend.points} />
                )}
              </div>
            </Panel>

            {/* ── How People Find You — the same Discovery Sources data,
                each source now stating its explicit share-of-discovery
                percentage (computed client-side from the already-
                returned impression counts — no new metric) alongside
                the proportional bar, so the bar's meaning is never
                ambiguous. ── */}
            <Panel padded={false}>
              <SectionHeader title="How People Find You" subtitle="Where your discovery is coming from" />
              {data.discoverySources.length === 0 ? (
                <div className="px-4 py-3">
                  <SectionWaiting body="Where people discover you will appear here as your profile, products and appearances get seen across Findmi." />
                </div>
              ) : (
                <RowList>
                  {data.discoverySources.map((s) => {
                    const sharePercent =
                      totalDiscoveryImpressions > 0 ? Math.round((s.impressions / totalDiscoveryImpressions) * 100) : 0;
                    return (
                      <ShareBar
                        key={s.label}
                        label={s.label}
                        value={
                          <span>
                            {plural(s.impressions, "impression")}
                            {s.clicks > 0 && ` · ${plural(s.clicks, "click")}`}
                            {" · "}
                            <span className="font-bold text-findmi-700">{sharePercent}% of discovery</span>
                          </span>
                        }
                        share={totalDiscoveryImpressions > 0 ? s.impressions / totalDiscoveryImpressions : 0}
                        sublabel={s.clickRate !== null && s.clickRate > 0 ? `${Math.round(s.clickRate * 100)}% click rate` : undefined}
                      />
                    );
                  })}
                </RowList>
              )}
            </Panel>

            {/* ── What People Do Next — Actions and Link Clicks merged
                into one section, grouped by what the action actually
                means. Now always rendered; a business with zero actions
                gets one waiting line instead of the section vanishing
                (never nine individual zeroed rows). Once real data
                exists, only non-zero groups/rows ever render. ── */}
            <Panel padded={false}>
              <SectionHeader title="What People Do Next" subtitle="After discovery" />
              <div className="p-4">
                {hasWhatsNext ? (
                  <div className="flex flex-col gap-5">
                    {engagementActions.length > 0 && (
                      <div>
                        <SectionEyebrow>Engagement</SectionEyebrow>
                        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                          {engagementActions.map((item) => (
                            <Stat key={item.label} value={item.count.toLocaleString()} label={item.label} />
                          ))}
                        </div>
                      </div>
                    )}
                    {commerceEventActions.length > 0 && (
                      <div>
                        <SectionEyebrow>Commerce &amp; Events</SectionEyebrow>
                        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
                          {commerceEventActions.map((item) => (
                            <Stat key={item.label} value={item.count.toLocaleString()} label={item.label} />
                          ))}
                        </div>
                      </div>
                    )}
                    {data.contactChannels.length > 0 && (
                      <div>
                        <SectionEyebrow>Links &amp; Contact</SectionEyebrow>
                        <div className="mt-2.5 overflow-hidden rounded-lg border border-black/[0.06]">
                          <RowList>
                            {data.contactChannels.map((c) => (
                              <Row key={c.channel} label={c.label} value={c.count.toLocaleString()} />
                            ))}
                          </RowList>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <SectionWaiting
                    title="No actions yet"
                    body="Directions, saves, follows, shares, website visits and other engagement will appear here as people take action."
                  />
                )}
              </div>
            </Panel>

            {/* ── What's Performing — Appearance + Product Analytics
                merged into one section. Now always rendered with both
                subsections always present; each independently shows its
                real server-ranked list or a compact waiting line. Never
                invents an Appearance/Product or a ranking — the array
                order is used exactly as returned whenever it's
                non-empty. ── */}
            <Panel padded={false}>
              <SectionHeader title="What's Performing" subtitle="Getting the most attention" />
              <div className="flex flex-col">
                <div className="border-b border-black/[0.06] pb-1">
                  <div className="px-4 pt-3 pb-1">
                    <SectionEyebrow>Top Appearances</SectionEyebrow>
                  </div>
                  {data.appearances.length === 0 ? (
                    <div className="px-4 pb-3">
                      <SectionWaiting body="Performance will appear here as your Findmi Here appearances receive discovery and engagement." />
                    </div>
                  ) : (
                    <RowList>
                      {data.appearances.map((a, i) => {
                        const topScore = Math.max(1, appearanceEngagementScore(data.appearances[0]));
                        const metricLine = compactMetricLine([
                          { count: a.impressions, word: "impression" },
                          { count: a.clicks, word: "click" },
                          { count: a.directions, word: "direction" },
                          { count: a.saves, word: "save" },
                          { count: a.qrScans, word: "QR scan" },
                        ]);
                        return (
                          <RankedPerformanceRow
                            key={a.id}
                            rank={i + 1}
                            title={a.title}
                            subtitle={[formatDateShort(a.startAt), a.eventName, a.location].filter(Boolean).join(" · ")}
                            metricLine={metricLine || undefined}
                            relativeScore={appearanceEngagementScore(a) / topScore}
                          />
                        );
                      })}
                    </RowList>
                  )}
                </div>
                <div className="pb-1">
                  <div className="px-4 pt-3 pb-1">
                    <SectionEyebrow>Top Products</SectionEyebrow>
                  </div>
                  {data.products.length === 0 ? (
                    <div className="px-4 pb-3">
                      <SectionWaiting body="Product performance will appear here as people discover and interact with your products." />
                    </div>
                  ) : (
                    <RowList>
                      {data.products.map((p, i) => {
                        const topScore = Math.max(1, productEngagementScore(data.products[0]));
                        const metricLine = compactMetricLine([
                          { count: p.impressions, word: "impression" },
                          { count: p.views, word: "view" },
                          { count: p.cardClicks, word: "card click" },
                          { count: p.externalClicks, word: "shop click" },
                          { count: p.saves, word: "save" },
                        ]);
                        return (
                          <RankedPerformanceRow
                            key={p.id}
                            rank={i + 1}
                            title={p.name}
                            metricLine={metricLine || undefined}
                            relativeScore={productEngagementScore(p) / topScore}
                          />
                        );
                      })}
                    </RowList>
                  )}
                </div>
              </div>
            </Panel>
          </div>

          <div className="flex flex-col gap-4 lg:col-start-3">
            {/* ── Your Audience — Followers itself lives in the KPI
                strip above, so this section is about the PEOPLE behind
                that total. Now always rendered: a real waiting line
                when there are zero followers, the existing avatar grid
                or factual privacy-safe line once there are some. Never
                shows growth (not available today). ── */}
            <Panel padded={false}>
              <SectionHeader title="Your Audience" />
              <div className="p-4">
                {followerSummary.totalCount === 0 ? (
                  <SectionWaiting title="No followers yet" body={`When people follow ${businessName}, you'll see your audience here.`} />
                ) : followerSummary.profiles.length > 0 ? (
                  <div className="grid grid-cols-4 gap-3">
                    {followerSummary.profiles.map((p) => (
                      <Link
                        key={p.username}
                        href={`/user/${p.username}`}
                        className="flex flex-col items-center gap-1 text-center transition hover:opacity-70"
                      >
                        <div className="relative h-11 w-11 overflow-hidden rounded-full bg-mist ring-1 ring-black/[0.06]">
                          {p.avatar_url && (
                            <SupabaseImage src={p.avatar_url} alt={p.display_name ?? p.username} fill sizes="44px" className="object-cover" />
                          )}
                        </div>
                        <p className="w-full truncate text-[10.5px] font-medium text-ink/70">{p.display_name || `@${p.username}`}</p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-ink/50">
                    {followerSummary.totalCount.toLocaleString()} {followerSummary.totalCount === 1 ? "person follows" : "people follow"}{" "}
                    {businessName} — public profiles will appear here once they&rsquo;re set.
                  </p>
                )}
                {followerSummary.totalCount > 0 && (followerSummary.accountCount > 0 || followerSummary.legacyCount > 0) && (
                  <p className="mt-3 border-t border-black/[0.05] pt-2.5 text-[11px] text-ink/40">
                    {followerSummary.accountCount.toLocaleString()} with a Findmi account
                    {followerSummary.legacyCount > 0 && ` · ${followerSummary.legacyCount.toLocaleString()} email-only`}
                  </p>
                )}
              </div>
            </Panel>

            {/* ── QR Performance — the one deliberate exception to
                "always render a shell": never rendered at all, not even
                a waiting state, when this Business has no real QR
                campaigns (owner QR self-service doesn't exist yet, and
                a waiting state here would incorrectly imply a business
                can create one). Unchanged from before. ── */}
            {data.qr && (
              <Panel title="QR Performance">
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

/** A real filled-area trend chart — still a plain, dependency-free
 * inline SVG, sized up from a 96px decorative sparkline to an actual
 * primary visualization. Only rendered once there are 2+ non-zero
 * buckets to actually compare (a single-bucket trend renders as a
 * PerformanceMetric, and zero non-zero buckets renders a SectionWaiting
 * line, both in the caller above). */
function TrendChart({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const width = 600;
  const height = 160;
  const stepX = width / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => ({ x: i * stepX, y: height - (p.value / max) * (height - 16) - 8 }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${height} L0,${height} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${points.length}-point trend`}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14B0BC" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#14B0BC" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} fill="none" stroke="#14B0BC" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={points[i].value > 0 ? 3 : 0} className="fill-findmi" />
        ))}
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] font-medium text-ink/35">
        <span>{points[0]?.label}</span>
        {points.length > 1 && <span>{points[points.length - 1]?.label}</span>}
      </div>
    </div>
  );
}
