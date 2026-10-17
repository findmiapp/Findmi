"use server";

import { revalidatePath } from "next/cache";
import { completeBrandAudit, respondToIdea, saveBrandAuditStep } from "@/lib/brand-audit";
import { isAuditKind, type AuditAnswerInput } from "@/lib/brand-audit-domain";

// Findmi Brand Audit + Opportunity Ideas — Business Server Actions. Every
// rule (membership of THIS Business, owner/manager only, never Admin
// Manage-As, valid choices, Idea eligibility) is enforced by
// lib/brand-audit.ts; nothing here trusts the bound ids beyond that.

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

export async function saveBrandAuditStepAction(businessId: string, kind: string, answers: AuditAnswerInput[]): Promise<ActionResult> {
  if (!isAuditKind(kind)) return { ok: false, error: "That step isn’t available." };
  const clean = (Array.isArray(answers) ? answers : []).map((a) => ({ key: String(a?.key ?? ""), detail: typeof a?.detail === "string" ? a.detail : null }));
  return run(businessId, () => saveBrandAuditStep(businessId, kind, clean));
}

export async function completeBrandAuditAction(businessId: string): Promise<ActionResult> {
  return run(businessId, () => completeBrandAudit(businessId));
}

export async function respondToIdeaAction(businessId: string, ideaId: string, response: string, note?: string | null): Promise<ActionResult> {
  return run(businessId, () => respondToIdea(businessId, String(ideaId), String(response), note === undefined ? undefined : typeof note === "string" ? note : null));
}
