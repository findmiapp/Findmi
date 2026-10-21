import Link from "next/link";
import ChevronIcon from "@/components/ChevronIcon";
import { GROWTH_SETUP_COPY, type GrowthSummary } from "@/lib/growth";

/** The compact Growth mini-dashboard — used on Business Home (as the one
 * Growth entry) and at the top of the Growth tab. Three real counts (Your
 * Goals / Opportunity Matches / Preferences), each linking to where it is
 * managed. Before Findmi has any signal it is a setup state instead: it
 * explains what telling Findmi buys the Business, rather than demanding a
 * form be completed. No fabricated metrics — every number is a row count. */
export default function GrowthPanel({ basePath, summary, titleId = "growth-title", heading = true }: { basePath: string; summary: GrowthSummary; titleId?: string; heading?: boolean }) {
  const setupHref = `${basePath}/brand-audit`;
  const goalsHref = `${basePath}?tab=opportunities&view=goals`;
  const matchesHref = `${basePath}?tab=opportunities`;
  const matchCount = summary.matchesAwaitingResponse + summary.matchesInProgress;

  return (
    <section id="home-growth" aria-labelledby={titleId} className="scroll-mt-[104px]">
      {heading && (
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="font-display text-section-title font-bold text-primary">
            Growth
          </h2>
          <Link href={`${basePath}?tab=growth`} className="flex shrink-0 items-center gap-1 text-metadata font-semibold text-accent hover:underline">
            Open Growth
            <ChevronIcon direction="right" className="h-3 w-3" />
          </Link>
        </div>
      )}

      {summary.setupState === "not_started" ? (
        <div className={`${heading ? "mt-3" : ""} rounded-2xl bg-black/[0.03] px-4 py-4`}>
          <p className="text-card-title font-bold text-primary">{GROWTH_SETUP_COPY.title}</p>
          <p className="mt-1 text-body text-muted">{GROWTH_SETUP_COPY.body}</p>
          <Link href={setupHref} className="mt-3 inline-flex h-10 items-center rounded-full bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600">
            {GROWTH_SETUP_COPY.cta}
          </Link>
        </div>
      ) : (
        <>
          <div className={`${heading ? "mt-3" : ""} grid grid-cols-3 gap-2`}>
            <Stat href={goalsHref} value={String(summary.goalCount)} label={summary.goalCount === 1 ? "Goal" : "Goals"} sub="Your Goals" />
            <Stat
              href={matchesHref}
              value={String(matchCount)}
              label={matchCount === 1 ? "Match" : "Matches"}
              sub={summary.matchesAwaitingResponse > 0 ? `${summary.matchesAwaitingResponse} Need${summary.matchesAwaitingResponse === 1 ? "s" : ""} A Reply` : "Opportunities"}
              highlight={summary.matchesAwaitingResponse > 0}
            />
            <Stat href={setupHref} value={`${summary.preferencesAnswered}/${summary.preferencesTotal}`} label="Set" sub="Preferences" />
          </div>
          {summary.progress < 100 && (
            <Link href={setupHref} className="mt-3 flex items-center justify-between gap-3 rounded-xl px-1 py-1 text-metadata">
              <span className="min-w-0 text-muted">Tell Findmi more to sharpen your matches.</span>
              <span className="flex shrink-0 items-center gap-1 font-bold text-accent">
                {GROWTH_SETUP_COPY.improve}
                <ChevronIcon direction="right" className="h-3 w-3" />
              </span>
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ href, value, label, sub, highlight }: { href: string; value: string; label: string; sub: string; highlight?: boolean }) {
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-col rounded-2xl bg-black/[0.03] px-3 py-3 transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
    >
      <span className="font-display text-stat font-bold leading-none text-primary tabular-nums">
        {value} <span className="text-metadata font-semibold text-muted">{label}</span>
      </span>
      <span className={`mt-1.5 truncate text-metadata font-medium ${highlight ? "text-findmi-700" : "text-muted"}`}>{sub}</span>
    </Link>
  );
}
