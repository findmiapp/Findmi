import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import { GROWTH_DESTINATIONS, GROWTH_DESTINATION_LABELS, GROWTH_SETUP_COPY, OPPORTUNITIES_MANAGER_TITLE, growthDestinationStatus, growthHref, type GrowthSummary } from "@/lib/growth";

/** Home's "Opportunities + Growth Manager" summary — four THIN navigation
 * controls (Set Goals, Opportunities, Ideas, Set Targets), each a one-tap deep link into that exact Growth
 * state (growthHref) carrying its real count or status, so common Growth
 * work never needs More → Growth → tab. No destination is gated behind
 * another: Opportunities targeting this Business and Findmi-picked Ideas
 * are reachable before any Goal exists. Numbers are row counts only —
 * never invented. The full Growth dashboard stays the deeper workspace
 * ("Open Growth"). */
export default function GrowthPanel({ basePath, summary }: { basePath: string; summary: GrowthSummary }) {
  return (
    <section id="home-growth" aria-labelledby="growth-title" className="scroll-mt-[104px]">
      <div className="flex items-center justify-between gap-3">
        <h2 id="growth-title" className="font-display text-section-title font-bold text-primary">
          {OPPORTUNITIES_MANAGER_TITLE}
        </h2>
        <Link
          href={`${basePath}?tab=growth`}
          className="flex shrink-0 items-center gap-1 rounded-full border border-findmi-200 bg-white px-3 py-1 text-metadata font-bold text-findmi-700 transition hover:border-findmi-300 hover:bg-findmi-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
        >
          Open Opportunities
          <ChevronIcon direction="right" className="h-3 w-3" />
        </Link>
      </div>

      <nav aria-label={OPPORTUNITIES_MANAGER_TITLE}>
        <ul className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {GROWTH_DESTINATIONS.map((d) => {
            const status = growthDestinationStatus(summary, d);
            return (
              <li key={d} className="min-w-0">
                <Link
                  href={growthHref(basePath, d)}
                  aria-label={`${GROWTH_DESTINATION_LABELS[d]}: ${status.value}`}
                  className="flex h-11 min-w-0 items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 transition hover:border-findmi-200 hover:bg-findmi-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold leading-tight text-primary">{GROWTH_DESTINATION_LABELS[d]}</span>
                    <span className={`block truncate text-[11px] leading-tight ${status.highlight ? "font-semibold text-findmi-700" : "text-muted"}`}>{status.value}</span>
                  </span>
                  <ChevronIcon direction="right" className="h-3 w-3 shrink-0 text-subtle" />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {!summary.hasSignal ? (
        <p className="mt-2 text-metadata text-muted">
          {GROWTH_SETUP_COPY.body}{" "}
          <Link href={`${basePath}/brand-audit?step=goals`} className="font-semibold text-accent hover:underline">
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
