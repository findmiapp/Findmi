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
  return (
    <>
      <p className="mt-0.5 text-metadata text-subtle">{data.rangeLabel}</p>
      {metrics.every((m) => m.metric.value === 0) ? (
        <p className="mt-2 text-body text-muted">
          No activity yet. Impressions, profile views, actions and followers will appear here as people find your Business on Findmi.
        </p>
      ) : (
        <ul className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map((m) => (
            <li key={m.key}>
              <MetricTile label={m.label} metric={m.metric} pro={pro} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MetricTile({ label, metric, pro }: { label: string; metric: HomeMetric; pro: boolean }) {
  const change = pro ? metric.changeLabel : null;
  const up = change?.startsWith("+");
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.07] bg-white px-3 py-2.5">
      <p className="truncate text-metadata font-medium text-muted">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-display text-xl font-bold leading-tight text-primary tabular-nums">{metric.value.toLocaleString()}</span>
        {change && <span className={`truncate text-microcopy font-bold ${up ? "text-accent" : "text-subtle"}`}>{change}</span>}
      </p>
    </div>
  );
}

/** Same geometry as the tile grid. */
export function HomePerformanceSkeleton() {
  return (
    <div aria-hidden="true">
      <span className="mt-1.5 block h-3 w-24 animate-pulse rounded bg-black/[0.05] motion-reduce:animate-none" />
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[62px] animate-pulse rounded-xl border border-black/[0.05] bg-black/[0.03] motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
