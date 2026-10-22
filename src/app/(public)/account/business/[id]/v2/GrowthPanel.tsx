import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import { GROWTH_DESTINATIONS, GROWTH_DESTINATION_LABELS, GROWTH_SETUP_COPY, growthDestinationStatus, growthHref, type GrowthSummary } from "@/lib/growth";

/** Home's Growth mini-dashboard — the Growth destinations (Goals, Targets,
 * Opportunities, Ideas) as direct links, each with a real count or status.
 * No destination is gated behind another: Opportunities targeting this
 * Business and Findmi-picked Ideas are reachable before any Goal exists.
 * Numbers are row counts only — never invented. */
export default function GrowthPanel({ basePath, summary }: { basePath: string; summary: GrowthSummary }) {
  return (
    <section id="home-growth" aria-labelledby="growth-title" className="scroll-mt-[104px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="growth-title" className="font-display text-section-title font-bold text-primary">
          Growth
        </h2>
        <Link href={`${basePath}?tab=growth`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
          Open Growth
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>

      <ul className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {GROWTH_DESTINATIONS.map((d) => {
          const status = growthDestinationStatus(summary, d);
          return (
            <li key={d} className="min-w-0">
              <Link
                href={growthHref(basePath, d)}
                className="flex h-full min-w-0 flex-col rounded-xl bg-black/[0.03] px-3 py-3 transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
              >
                <span className="text-label font-bold uppercase text-subtle">{GROWTH_DESTINATION_LABELS[d]}</span>
                <span className={`mt-1 font-display text-card-title font-bold leading-tight ${status.highlight ? "text-findmi-700" : "text-primary"}`}>{status.value}</span>
                <span className="mt-0.5 truncate text-metadata text-muted">{status.sub}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!summary.hasSignal ? (
        <p className="mt-2 text-metadata text-muted">
          {GROWTH_SETUP_COPY.body}{" "}
          <Link href={`${basePath}/brand-audit`} className="font-semibold text-accent hover:underline">
            {GROWTH_SETUP_COPY.cta}
          </Link>
        </p>
      ) : (
        summary.progress < 100 && (
          <Link href={`${basePath}/brand-audit`} className="mt-2 inline-flex items-center gap-1 text-metadata font-semibold text-accent hover:underline">
            {GROWTH_SETUP_COPY.improve}
            <ChevronIcon direction="right" className="h-3 w-3" />
          </Link>
        )
      )}
    </section>
  );
}
