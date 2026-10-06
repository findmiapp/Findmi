import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminBusinessGoals, type AdminBusinessGoal } from "@/lib/opportunity-goals";
import {
  GOAL_BUDGET,
  GOAL_INTEREST_LABELS,
  GOAL_OBJECTIVE_LABELS,
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
  formatGoalTiming,
  isGoalStatus,
  type GoalStatus,
} from "@/lib/opportunity-goals-domain";
import OpportunitiesAdminTabs from "../OpportunitiesAdminTabs";
import { formatOpportunityDate } from "../format";

export const dynamic = "force-dynamic";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-ink/80">{children}</dd>
    </div>
  );
}

function GoalRow({ g }: { g: AdminBusinessGoal }) {
  const where = [...g.markets, g.markets_text].filter(Boolean).join(" · ");
  return (
    <li className="rounded-xl border border-black/5 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {g.business ? (
            <Link href={`/admin/businesses/${g.business.id}`} className="text-xs font-bold uppercase tracking-wide text-findmi-700 hover:underline">
              {g.business.name}
            </Link>
          ) : (
            <span className="text-xs font-bold uppercase tracking-wide text-ink/40">Business unavailable</span>
          )}
          <p className="mt-0.5 break-words text-sm font-semibold text-ink">{g.title}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${g.status === "active" ? "bg-findmi-50 text-findmi-700" : "bg-black/5 text-ink/45"}`}>
          {GOAL_STATUS_LABELS[g.status]}
        </span>
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
        <Field label="Objectives">{g.objectives.map((o) => GOAL_OBJECTIVE_LABELS[o]).join(", ")}</Field>
        <Field label="Opportunity Types">{g.opportunity_interests.map((i) => GOAL_INTEREST_LABELS[i]).join(", ")}</Field>
        <Field label="Markets">{where || "Anywhere"}</Field>
        <Field label="Budget">{GOAL_BUDGET[g.budget_band].label}</Field>
        <Field label="Timing">{formatGoalTiming(g)}</Field>
        <Field label="Created">{formatOpportunityDate(g.created_at)}</Field>
        {g.audience_text && <Field label="Audience">{g.audience_text}</Field>}
        {g.notes && <Field label="Notes">{g.notes}</Field>}
      </dl>
    </li>
  );
}

/** Opportunities V2 — Business Goals (read-only operational intelligence
 * for deciding which Businesses receive which Opportunities). Admin only;
 * no CRM, no matching. */
export default async function AdminBusinessGoalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const status: GoalStatus | undefined = isGoalStatus(statusParam) ? statusParam : undefined;
  const { available, goals } = await getAdminBusinessGoals(status);
  const filters: { value?: GoalStatus; label: string }[] = [{ label: "All" }, ...GOAL_STATUSES.map((s) => ({ value: s, label: GOAL_STATUS_LABELS[s] }))];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Opportunities</h1>
      <p className="mt-1 max-w-xl text-sm text-ink/50">What Businesses have told Findmi they want to accomplish.</p>
      <OpportunitiesAdminTabs active="goals" />

      <nav aria-label="Filter by status" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {filters.map((f) => {
          const active = f.value === status;
          return (
            <Link
              key={f.label}
              href={f.value ? `/admin/opportunities/goals?status=${f.value}` : "/admin/opportunities/goals"}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                active ? "border-ink bg-ink text-white" : "border-black/10 bg-white text-ink/65 hover:border-black/20 hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4">
        {!available ? (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-ink/45">
            Business Goals need the pending database migration (business_opportunity_goals).
          </p>
        ) : goals.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-ink/45">No Business Goals{status ? ` (${GOAL_STATUS_LABELS[status]})` : ""} yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {goals.map((g) => (
              <GoalRow key={g.id} g={g} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
