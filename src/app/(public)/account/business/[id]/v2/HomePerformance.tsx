import { getOwnerBusinessPerformance, type OwnerPerformanceRange } from "@/lib/analytics/ownerPerformance";
import { getManagerCore } from "../managerContext";

export interface HomeMetric {
  value: number;
  changeLabel: string | null;
}

/** The four Home Performance tiles, in order — the existing headline metrics of
 * the one Performance system (lib/analytics/ownerPerformance.ts) plus the
 * follower total. No new analytics definition. */
export function homePerformanceMetrics(
  headline: { impressions: HomeMetric; profileViews: HomeMetric; actionsTaken: HomeMetric },
  followers: number
): { key: string; label: string; metric: HomeMetric }[] {
  return [
    { key: "impressions", label: "Impressions", metric: headline.impressions },
    { key: "views", label: "Profile Views", metric: headline.profileViews },
    { key: "actions", label: headline.actionsTaken.value === 1 ? "Action" : "Actions", metric: headline.actionsTaken },
    { key: "followers", label: "Followers", metric: { value: followers, changeLabel: null } },
  ];
}

/** Business Home → Performance pulse. Streams in behind its own Suspense
 * boundary (BusinessHome): the analytics read is the heaviest Home read, so
 * nothing else on Home waits for it. Values are shown to every plan (as before);
 * period-over-period change stays Pro, and the full Performance page keeps its
 * own Pro gate. A failed read degrades to a short note, never a broken Home.
 * The service client and the plan come from the per-request-cached,
 * already-authorized manager context (../managerContext). */
export async function HomePerformanceTiles({ businessId, range, followers }: { businessId: string; range: OwnerPerformanceRange; followers: number }) {
  const { admin, pro } = await getManagerCore(businessId);
  let data: Awaited<ReturnType<typeof getOwnerBusinessPerformance>> | null = null;
  try {
    data = await getOwnerBusinessPerformance(admin, businessId, range);
  } catch {
    data = null;
  }
  if (!data) return <p className="mt-2 text-body text-muted">Performance couldn&rsquo;t load right now.</p>;

  const metrics = homePerformanceMetrics(data.headline, followers);
  // The range ("Last 30 Days") is in the section heading (BusinessHome), so the
  // strip starts right under it.
  return metrics.every((m) => m.metric.value === 0) ? (
    <p className="mt-1 text-body text-muted">
      No activity yet. Impressions, profile views, actions and followers will appear here as people find your Business on Findmi.
    </p>
  ) : (
    // ONE compact strip: four metrics across at every phone width, the number
    // the strongest element.
    <ul className="mt-1.5 grid grid-cols-4 divide-x divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.07] bg-white">
      {metrics.map((m) => (
        <li key={m.key} className="min-w-0">
          <MetricCell label={m.label} metric={m.metric} pro={pro} />
        </li>
      ))}
    </ul>
  );
}

/** "12,431" stays exact up to 9,999; larger values read "12.4K" (the exact
 * number is the cell's accessible name and tooltip). */
export function formatMetricValue(value: number): string {
  return value >= 10000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : value.toLocaleString("en-US");
}

function MetricCell({ label, metric, pro }: { label: string; metric: HomeMetric; pro: boolean }) {
  const change = pro ? metric.changeLabel : null;
  const up = change?.startsWith("+");
  const exact = metric.value.toLocaleString("en-US");
  return (
    <div className="flex h-full min-w-0 flex-col px-1.5 py-1.5 min-[380px]:px-2" title={`${label}: ${exact}`}>
      {/* One label line where it fits; where "Profile Views" must wrap (narrow
          phones) every label gets the same two-line, bottom-aligned row, so the
          numbers still sit on one line. */}
      <p className="flex h-[26px] items-end text-[11px] font-medium leading-tight tracking-[-0.01em] text-muted min-[380px]:h-auto">
        <span className="line-clamp-2 min-[380px]:truncate">{label}</span>
      </p>
      <p className="mt-0.5 font-display text-lg font-bold leading-none text-primary tabular-nums min-[380px]:text-[19px]" aria-label={`${exact} ${label}`}>
        {formatMetricValue(metric.value)}
      </p>
      {change && <p className={`mt-0.5 truncate text-[10px] font-bold leading-tight ${up ? "text-accent" : "text-subtle"}`}>{change}</p>}
    </div>
  );
}

/** Same geometry as the metric strip. */
export function HomePerformanceSkeleton() {
  return <div aria-hidden="true" className="mt-1.5 h-[52px] animate-pulse rounded-xl border border-black/[0.05] bg-black/[0.03] motion-reduce:animate-none" />;
}
