import { auditMissingSections, auditProgress, AUDIT_SECTIONS, type AuditSummary } from "./brand-audit-domain";

/** Growth — the Business Manager's one place for "how can Findmi help us
 * grow". Pure derivations over data the page already loads (Growth Setup
 * answers, Opportunity goals, recommended Opportunities, Opportunity Ideas);
 * nothing here reads or writes the database, and nothing here invents a
 * number — every figure is a count of a real row.
 *
 * Progressive personalization: an "All Brands" Idea is generic by nature,
 * so it is only shown once the Business has told Findmi what it wants (a
 * Growth Setup goal, or an active Opportunity goal). An Idea Findmi chose
 * for this Business specifically (`targeted`) always shows. Before there is
 * any signal the Growth surface is a setup state, never a stock list of
 * universal ideas. */

export interface GrowthIdeaLike {
  /** Findmi chose this Idea for this Business (audience = selected_businesses). */
  targeted: boolean;
  response: { value: string } | null;
}

export interface GrowthInput {
  audit: AuditSummary | null;
  /** Active (not paused/closed) Opportunity goals. */
  activeGoalCount: number;
  /** Opportunities recommended to this Business that are still unanswered. */
  matchesAwaitingResponse: number;
  /** Opportunities this Business is Confirmed / Interested in. */
  matchesInProgress: number;
}

export type GrowthSetupState = "not_started" | "in_progress" | "ready";

export interface GrowthSummary {
  setupState: GrowthSetupState;
  /** Goals Findmi can match against (Growth Setup goals + active Opportunity goals). */
  goalCount: number;
  /** Growth Setup sections answered, of the total. */
  preferencesAnswered: number;
  preferencesTotal: number;
  /** 0–100, from Growth Setup. */
  progress: number;
  /** Findmi has enough signal to personalize (at least one goal). */
  hasSignal: boolean;
  matchesAwaitingResponse: number;
  matchesInProgress: number;
}

export function summarizeGrowth(input: GrowthInput): GrowthSummary {
  const { audit, activeGoalCount } = input;
  const total = AUDIT_SECTIONS.length;
  const answered = audit ? total - auditMissingSections(audit).length : 0;
  const goalCount = (audit?.goalCount ?? 0) + activeGoalCount;
  const hasSignal = goalCount > 0;
  const setupState: GrowthSetupState = !hasSignal && answered === 0 ? "not_started" : audit?.status === "complete" && answered === total ? "ready" : hasSignal && answered >= 3 ? "ready" : "in_progress";
  return {
    setupState,
    goalCount,
    preferencesAnswered: answered,
    preferencesTotal: total,
    progress: audit ? auditProgress(audit) : 0,
    hasSignal,
    matchesAwaitingResponse: input.matchesAwaitingResponse,
    matchesInProgress: input.matchesInProgress,
  };
}

/** Ideas worth showing for this Business right now (see the file comment). */
export function eligibleGrowthIdeas<T extends GrowthIdeaLike>(ideas: T[], hasSignal: boolean): T[] {
  return ideas.filter((idea) => idea.targeted || hasSignal);
}

/** Ideas the Business hasn't answered yet (the "N New" count). */
export function unansweredIdeaCount(ideas: GrowthIdeaLike[]): number {
  return ideas.filter((i) => !i.response).length;
}

/** Copy for the setup state — explains the value, never demands completion. */
export const GROWTH_SETUP_COPY = {
  title: "Tell Us What You’re Looking For",
  body: "Set your goals and preferences so Findmi can surface more relevant opportunities and ideas for your brand.",
  cta: "Set Your Goals",
  improve: "Improve My Matches",
} as const;
