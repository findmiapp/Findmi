import BusinessAppShell from "../v2/BusinessAppShell";
import { getBrandAudit } from "@/lib/brand-audit";
import { auditResumeStep } from "@/lib/brand-audit-domain";
import { canManageGoals } from "@/lib/opportunity-goals-domain";
import { loadBusinessShell } from "../opportunities/loadBusinessShell";
import { GoalFrame } from "../opportunities/goals/shared";
import { completeBrandAuditAction, saveBrandAuditStepAction } from "./actions";
import BrandAuditFlow, { type AuditStep } from "./BrandAuditFlow";

export const dynamic = "force-dynamic";

const STEPS: AuditStep[] = ["intro", "goals", "challenges", "review"];

/** Findmi Brand Audit — the Business's Goals and Current Challenges, each
 * with its own optional elaboration. Any member can view; owners and
 * managers edit (every rule re-checked server-side by lib/brand-audit.ts).
 * Never blocks anything else on Findmi. */
export default async function BrandAuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: stepParam } = await searchParams;
  const { membership, shell } = await loadBusinessShell(id, `/account/business/${id}/brand-audit`);
  const audit = await getBrandAudit(id);
  const canEdit = canManageGoals(membership.role, membership.viaAdmin);
  const requested = STEPS.includes(stepParam as AuditStep) ? (stepParam as AuditStep) : null;

  return (
    <BusinessAppShell {...shell} activeSection="home">
      <GoalFrame>
        {!audit.available ? (
          <div className="rounded-2xl border border-black/[0.07] bg-white p-5">
            <p className="text-card-title font-semibold text-primary">Findmi Brand Audit</p>
            <p className="mt-1 text-body text-muted">The Brand Audit isn&rsquo;t available yet. Check back soon.</p>
          </div>
        ) : (
          <BrandAuditFlow
            homeHref={shell.basePath}
            initialStep={requested ?? auditResumeStep(audit.summary)}
            initialGoals={audit.goals}
            initialChallenges={audit.challenges}
            complete={audit.summary.status === "complete"}
            canEdit={canEdit}
            readOnlyMessage={
              membership.viaAdmin
                ? "Viewing as a Findmi Admin. The Brand Audit comes from the Business, so it can’t be changed here."
                : "Only a Business owner or manager can change the Brand Audit."
            }
            saveStep={saveBrandAuditStepAction.bind(null, id)}
            completeAudit={completeBrandAuditAction.bind(null, id)}
          />
        )}
      </GoalFrame>
    </BusinessAppShell>
  );
}
