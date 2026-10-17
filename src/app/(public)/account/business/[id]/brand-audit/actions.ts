"use server";

import { revalidatePath } from "next/cache";
import { completeBrandAudit, respondToIdea, saveBrandAuditAudience, saveBrandAuditMarkets, saveBrandAuditStep } from "@/lib/brand-audit";
import type { AuditAnswerInput, GeoInput } from "@/lib/brand-audit-domain";

// Findmi Brand Audit + Opportunity Ideas — Business Server Actions. Every
// rule (membership of THIS Business, owner/manager only, never Admin
// Manage-As, valid choices, real Markets/Areas, Idea eligibility) is
// enforced by lib/brand-audit.ts; nothing here trusts the bound ids beyond
// that.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function run(businessId: string, fn: () => Promise<ActionResult>): Promise<ActionResult> {
  let result: ActionResult;
  try {
    result = await fn();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "You don’t have access to that business." };
  }
  if (result.ok) {
    revalidatePath(`/account/business/${businessId}`);
    revalidatePath(`/account/business/${businessId}/brand-audit`);
  }
  return result;
}

const cleanAnswers = (answers: unknown): AuditAnswerInput[] =>
  (Array.isArray(answers) ? answers : []).map((a) => ({ key: String(a?.key ?? ""), detail: typeof a?.detail === "string" ? a.detail : null }));

/** Single-kind steps only: Goals, Challenges, Activation Environments. */
const SINGLE_KIND_STEPS = ["goal", "challenge", "environment"] as const;

export async function saveBrandAuditStepAction(businessId: string, kind: string, answers: AuditAnswerInput[]): Promise<ActionResult> {
  const step = SINGLE_KIND_STEPS.find((k) => k === kind);
  if (!step) return { ok: false, error: "That step isn’t available." };
  return run(businessId, () => saveBrandAuditStep(businessId, step, cleanAnswers(answers)));
}

export async function saveBrandAuditAudienceAction(
  businessId: string,
  input: { audiences: AuditAnswerInput[]; ages: AuditAnswerInput[]; priorities: AuditAnswerInput[] }
): Promise<ActionResult> {
  return run(businessId, () =>
    saveBrandAuditAudience(businessId, { audiences: cleanAnswers(input?.audiences), ages: cleanAnswers(input?.ages), priorities: cleanAnswers(input?.priorities) })
  );
}

export async function saveBrandAuditMarketsAction(businessId: string, input: { scope: string | null; geo: GeoInput[] }): Promise<ActionResult> {
  const geo = (Array.isArray(input?.geo) ? input.geo : []).map((g) => ({
    intent: String(g?.intent ?? ""),
    level: String(g?.level ?? ""),
    id: typeof g?.id === "string" ? g.id : null,
    key: typeof g?.key === "string" ? g.key : null,
    label: typeof g?.label === "string" ? g.label : null,
  }));
  return run(businessId, () => saveBrandAuditMarkets(businessId, { scope: typeof input?.scope === "string" ? input.scope : null, geo }));
}

export async function completeBrandAuditAction(businessId: string): Promise<ActionResult> {
  return run(businessId, () => completeBrandAudit(businessId));
}

export async function respondToIdeaAction(businessId: string, ideaId: string, response: string, note?: string | null): Promise<ActionResult> {
  return run(businessId, () => respondToIdea(businessId, String(ideaId), String(response), note === undefined ? undefined : typeof note === "string" ? note : null));
}
