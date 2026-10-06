import { notFound } from "next/navigation";
import BusinessAppShell from "../../../../v2/BusinessAppShell";
import { getBusinessGoal, getGoalMarketOptions } from "@/lib/opportunity-goals";
import { canManageGoals } from "@/lib/opportunity-goals-domain";
import { loadBusinessShell } from "../../../loadBusinessShell";
import { submitGoal } from "../../../actions";
import GoalWizard from "../../GoalWizard";
import { GoalFrame, GoalNotAllowed } from "../../shared";

export const dynamic = "force-dynamic";

/** Edit one of this Business's goals (scoped by business_id; another
 * Business's goal id 404s). Owner/manager only. */
export default async function EditGoalPage({ params }: { params: Promise<{ id: string; goalId: string }> }) {
  const { id, goalId } = await params;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/opportunities/goals/${goalId}/edit`);
  const goal = await getBusinessGoal(id, goalId);
  if (!goal) notFound();
  const goalsHref = `${shell.basePath}?tab=opportunities&view=goals`;
  const allowed = canManageGoals(membership.role, membership.viaAdmin);
  const markets = allowed ? await getGoalMarketOptions() : [];

  return (
    <BusinessAppShell {...shell} activeSection="opportunities">
      <GoalFrame>
        {!allowed ? (
          <GoalNotAllowed
            backHref={goalsHref}
            message={membership.viaAdmin ? "Viewing as a Findmi Admin. Goals come from the Business, so they can't be changed here." : "Only a Business owner or manager can change goals."}
          />
        ) : (
          <GoalWizard
            action={submitGoal.bind(null, id, goal.id)}
            markets={markets}
            submitLabel="Save Goal"
            cancelHref={goalsHref}
            initial={{
              title: goal.title,
              objectives: goal.objectives,
              opportunity_interests: goal.opportunity_interests,
              audience_text: goal.audience_text ?? "",
              market_ids: goal.market_ids,
              markets_text: goal.markets_text ?? "",
              budget_band: goal.budget_band,
              timing: goal.timing,
              starts_on: goal.starts_on ?? "",
              ends_on: goal.ends_on ?? "",
              notes: goal.notes ?? "",
            }}
          />
        )}
      </GoalFrame>
    </BusinessAppShell>
  );
}
