import BusinessAppShell from "../v2/BusinessAppShell";
import { getBrandAudit, getGeoCatalog } from "@/lib/brand-audit";
import { auditResumeStep, type AuditStep } from "@/lib/brand-audit-domain";
import { canManageGoals } from "@/lib/opportunity-goals-domain";
import { loadBusinessShell } from "../opportunities/loadBusinessShell";
import { GoalFrame } from "../opportunities/goals/shared";
import { completeBrandAuditAction, saveBrandAuditAudienceAction, saveBrandAuditMarketsAction, saveBrandAuditStepAction } from "./actions";
import BrandAuditFlow, { type GeoChoice } from "./BrandAuditFlow";

export const dynamic = "force-dynamic";

const STEPS: AuditStep[] = ["intro", "goals", "challenges", "audience", "markets", "environments", "review"];

/** Findmi Brand Audit — Goals, Current Challenges, Target Audience,
 * Markets and Activation Environments, each choice with its own optional
 * elaboration. Any member can view; owners and managers edit (every rule
 * re-checked server-side by lib/brand-audit.ts). Never blocks anything
 * else on Findmi. */
export default async function BrandAuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: stepParam } = await searchParams;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/brand-audit`);
  const [audit, catalog] = await Promise.all([getBrandAudit(id), getGeoCatalog()]);
  const canEdit = canManageGoals(membership.role, membership.viaAdmin);
  const requested = STEPS.includes(stepParam as AuditStep) ? (stepParam as AuditStep) : null;
  const geo: GeoChoice[] = audit.geo.map((g) => ({
    intent: g.intent,
    level: g.level,
    id: g.level === "area" ? g.market_area_id : g.level === "market" ? g.market_id : null,
    key: g.level === "neighborhood" || g.level === "place" ? g.place_key : null,
    label: g.label,
  }));

  return (
    <BusinessAppShell {...shell} activeSection="growth">
      <GoalFrame>
        {!audit.available ? (
          <div className="rounded-2xl border border-black/[0.07] bg-white p-5">
            <p className="text-card-title font-semibold text-primary">Growth Setup</p>
            <p className="mt-1 text-body text-muted">Growth Setup isn&rsquo;t available yet. Check back soon.</p>
          </div>
        ) : (
          <BrandAuditFlow
            homeHref={shell.basePath}
            initialStep={requested ?? auditResumeStep(audit.summary)}
            initial={{
              goals: audit.goals,
              challenges: audit.challenges,
              audiences: audit.audiences,
              ages: audit.ages,
              priorities: audit.priorities,
              marketScope: audit.marketScope,
              environments: audit.environments,
              geo,
            }}
            catalog={catalog}
            complete={audit.summary.status === "complete"}
            canEdit={canEdit}
            readOnlyMessage={
              membership.viaAdmin
                ? "Viewing as a Findmi Admin. Growth Setup comes from the Business, so it can’t be changed here."
                : "Only a Business owner or manager can change Growth Setup."
            }
            saveStep={saveBrandAuditStepAction.bind(null, id)}
            saveAudience={saveBrandAuditAudienceAction.bind(null, id)}
            saveMarkets={saveBrandAuditMarketsAction.bind(null, id)}
            completeAudit={completeBrandAuditAction.bind(null, id)}
          />
        )}
      </GoalFrame>
    </BusinessAppShell>
  );
}
