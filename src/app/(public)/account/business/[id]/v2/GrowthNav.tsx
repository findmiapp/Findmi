import OptimisticTabs from "./OptimisticTabs";
import Link from "next/link";
import { GROWTH_DESTINATIONS, GROWTH_DESTINATION_LABELS, GROWTH_WORKFLOW_INTRO, growthHref, growthWorkflowSteps, type GrowthDestination, type GrowthSummary } from "@/lib/growth";

/** The persistent Growth navigation — Goals · Targets · Opportunities · Ideas —
 * shown on every Growth page (the hub views, Growth Setup, the goal wizard), so
 * no Growth page is ever a dead end: from any of them you reach the others in
 * one tap. `badges` are real counts passed by pages that already have
 * them; omitted otherwise. The highlight moves on tap (OptimisticTabs). */
export default function GrowthNav({
  basePath,
  active,
  badges,
  summary,
}: {
  basePath: string;
  active: GrowthDestination;
  badges?: Partial<Record<GrowthDestination, number>>;
  /** When given on Goals, the workflow strip under the tabs shows each step's real status. */
  summary?: GrowthSummary | null;
}) {
  const nav = (
    <OptimisticTabs
      ariaLabel="Opportunities + Growth Manager"
      navClass="flex gap-0.5 rounded-full bg-black/[0.04] p-0.5"
      linkClass="flex h-9 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-full px-2 text-button font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-findmi/40"
      activeClass="bg-white text-primary shadow-sm"
      inactiveClass="text-muted hover:text-primary"
      badgeClass="inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-[18px]"
      badgeActiveClass="bg-findmi text-white"
      badgeInactiveClass="bg-findmi-50 text-findmi-700"
      active={active}
      items={GROWTH_DESTINATIONS.map((d) => ({
        key: d,
        href: growthHref(basePath, d),
        label: <span className="truncate">{GROWTH_DESTINATION_LABELS[d]}</span>,
        badge: badges?.[d],
      }))}
    />
  );
  // Goals (the Growth landing) explains the Growth model; every other Growth
  // page is a working surface — the tabs alone orient it, the work comes first.
  if (!summary || active !== "goals") return nav;
  const steps = growthWorkflowSteps(summary);
  const strip = (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, i) => (
        <li key={step.key}>
          <Link href={growthHref(basePath, step.key)} aria-current={step.key === active ? "step" : undefined} className="flex items-baseline gap-2 text-metadata">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full text-[11px] font-bold ${step.key === active ? "bg-findmi text-white" : "bg-black/[0.07] text-muted"}`}>{i + 1}</span>
            <span className={`font-semibold ${step.key === active ? "text-primary" : "text-secondary"}`}>{step.role}</span>
            <span className={`min-w-0 flex-1 truncate text-right ${step.highlight ? "font-semibold text-findmi-700" : "text-muted"}`}>{step.status}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="flex flex-col gap-3">
      {nav}
      <div className="rounded-2xl bg-black/[0.03] px-4 py-3">
        <p className="text-metadata text-muted">{GROWTH_WORKFLOW_INTRO}</p>
        <div className="mt-2">{strip}</div>
      </div>
    </div>
  );
}
