import Link from "next/link";
import BusinessAppShell from "../../../v2/BusinessAppShell";
import { GoalGlyph } from "@/components/opportunities/OpportunityGlyphs";
import { getBusinessGoal, getBusinessGoals, getGoalMarketOptions } from "@/lib/opportunity-goals";
import { canManageGoals } from "@/lib/opportunity-goals-domain";
import { loadBusinessShell } from "../../loadBusinessShell";
import { submitGoal } from "../../actions";
import GoalWizard from "../GoalWizard";
import { GoalFrame, GoalNotAllowed } from "../shared";

export const dynamic = "force-dynamic";

/** Tell Findmi Your Goals — create a Business Opportunity Goal. Owners and
 * managers only (staff and Admin Manage-As see why not); every rule is
 * re-checked server-side by createBusinessGoal. ?created=<id> shows the
 * success state for that goal (it must belong to this Business). */
export default async function NewGoalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/opportunities/goals/new`);
  const goalsHref = `${shell.basePath}?tab=opportunities&view=goals`;
  const createdGoal = created ? await getBusinessGoal(id, created) : null;

  if (createdGoal) {
    return (
      <BusinessAppShell {...shell} activeSection="opportunities">
        <GoalFrame>
          <div className="rounded-2xl border border-black/[0.07] bg-white p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-findmi-50 text-findmi-700">
              <GoalGlyph className="h-6 w-6" />
            </span>
            <h1 className="mt-3 font-display text-page-title font-bold text-primary">We know what you&rsquo;re looking for.</h1>
            <p className="mx-auto mt-2 max-w-sm text-body text-muted">Findmi will use these goals to surface relevant Opportunities for your Business.</p>
            <p className="mt-3 text-metadata font-semibold text-secondary">{createdGoal.title}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={`${shell.basePath}?tab=opportunities`} className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-findmi px-5 text-button font-bold text-white transition hover:bg-findmi-600">
                View Opportunities
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                href={`${shell.basePath}/opportunities/goals/new`}
                className="flex h-12 items-center justify-center rounded-xl border border-black/10 px-5 text-button font-semibold text-primary transition hover:border-black/20"
              >
                Add Another Goal
              </Link>
            </div>
          </div>
        </GoalFrame>
      </BusinessAppShell>
    );
  }

  const allowed = canManageGoals(membership.role, membership.viaAdmin);
  const [{ available }, markets] = allowed ? await Promise.all([getBusinessGoals(id), getGoalMarketOptions()]) : [{ available: true }, []];

  return (
    <BusinessAppShell {...shell} activeSection="opportunities">
      <GoalFrame>
        {!allowed ? (
          <GoalNotAllowed
            backHref={goalsHref}
            message={
              membership.viaAdmin
                ? "Viewing as a Findmi Admin. Goals come from the Business, so they can't be created here."
                : "Only a Business owner or manager can add goals."
            }
          />
        ) : !available ? (
          <GoalNotAllowed backHref={goalsHref} message="Goals aren't available yet. Check back soon." />
        ) : (
          <GoalWizard
            action={submitGoal.bind(null, id, null)}
            markets={markets}
            submitLabel="Submit Goals"
            cancelHref={goalsHref}
            initial={{
              title: "",
              objectives: [],
              opportunity_interests: [],
              audience_text: "",
              market_ids: [],
              markets_text: "",
              budget_band: null,
              timing: null,
              starts_on: "",
              ends_on: "",
              notes: "",
            }}
          />
        )}
      </GoalFrame>
    </BusinessAppShell>
  );
}
