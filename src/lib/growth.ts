import { auditOptionLabel, auditMissingSections, auditProgress, auditSectionsAnswered, AUDIT_SECTIONS, type AuditSection, type AuditSummary } from "./brand-audit-domain";

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
  /** Ideas worth showing right now (after the signal gating below). */
  ideasForYou?: number;
  /** …of which the Business hasn't answered yet. */
  ideasNew?: number;
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
  ideasForYou: number;
  ideasNew: number;
  /** Growth Setup sections answered, by section (Profile checklist). */
  sections: Record<AuditSection, boolean>;
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
    ideasForYou: input.ideasForYou ?? 0,
    ideasNew: input.ideasNew ?? 0,
    sections: audit ? auditSectionsAnswered(audit) : { goals: false, challenges: false, audience: false, markets: false, environments: false },
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

/** The three Growth destinations, in order. One definition: the hub
 * navigation, Home's mini-dashboard and the tests all read it. */
export const GROWTH_DESTINATIONS = ["goals", "opportunities", "ideas"] as const;
export type GrowthDestination = (typeof GROWTH_DESTINATIONS)[number];
export const GROWTH_DESTINATION_LABELS: Record<GrowthDestination, string> = { goals: "Goals", opportunities: "Opportunities", ideas: "Ideas" };

export function growthHref(basePath: string, destination: GrowthDestination): string {
  if (destination === "opportunities") return `${basePath}?tab=opportunities`;
  if (destination === "ideas") return `${basePath}?tab=growth&view=ideas`;
  return `${basePath}?tab=growth`;
}

/** Growth Profile sections in the order the Setup flow asks them, with the
 * Setup step each one resumes at (route and step names are the unchanged
 * legacy ones). */
export const GROWTH_PROFILE_SECTIONS: { key: AuditSection; label: string; step: string }[] = [
  { key: "goals", label: "Goals", step: "goals" },
  { key: "challenges", label: "Current Challenges", step: "challenges" },
  { key: "audience", label: "Target Audience", step: "audience" },
  { key: "markets", label: "Markets", step: "markets" },
  { key: "environments", label: "Activation Environments", step: "environments" },
];

/** What each destination shows as its one-line status on Home and in the
 * hub navigation — real counts only. */
export function growthDestinationStatus(summary: GrowthSummary, destination: GrowthDestination): { value: string; sub: string; highlight?: boolean } {
  if (destination === "goals") {
    return summary.goalCount > 0
      ? { value: `${summary.goalCount} Set`, sub: `Profile ${summary.preferencesAnswered}/${summary.preferencesTotal}` }
      : { value: "Get Started", sub: "Set Your Goals" };
  }
  if (destination === "opportunities") {
    if (summary.matchesAwaitingResponse > 0) return { value: `${summary.matchesAwaitingResponse} Needs Response`, sub: "Opportunities", highlight: true };
    const n = summary.matchesAwaitingResponse + summary.matchesInProgress;
    return n > 0 ? { value: `${n} ${n === 1 ? "Match" : "Matches"}`, sub: "In Progress" } : { value: "Browse", sub: "Opportunities" };
  }
  if (summary.ideasForYou > 0) return { value: `${summary.ideasForYou} For You`, sub: summary.ideasNew > 0 ? `${summary.ideasNew} New` : "Reviewed" };
  return summary.hasSignal ? { value: "None Yet", sub: "Check Back Soon" } : { value: "Personalize", sub: "Add Your Goals" };
}

/** The one sentence that says how Goals, Ideas and Opportunities fit together — shown on
 * every Growth page so the three read as one workflow, not three unrelated tabs. */
export const GROWTH_WORKFLOW_INTRO = "Tell Findmi what you want. Findmi suggests Ideas that may help, and shares an Opportunity when a real one fits.";

/** The role each destination plays, in the order a Business moves through them. */
export const GROWTH_WORKFLOW_ROLES: { key: GrowthDestination; role: string }[] = [
  { key: "goals", role: "What You Want" },
  { key: "ideas", role: "What May Help" },
  { key: "opportunities", role: "What’s Available" },
];

/** The three workflow lines (role + the destination's real one-line status). */
export function growthWorkflowSteps(summary: GrowthSummary): { key: GrowthDestination; role: string; status: string; highlight: boolean }[] {
  return GROWTH_WORKFLOW_ROLES.map(({ key, role }) => {
    const s = growthDestinationStatus(summary, key);
    return { key, role, status: `${s.value} · ${s.sub}`, highlight: Boolean(s.highlight) };
  });
}

/** The answers behind the Growth Profile checklist, as the page already has
 * them (`getBrandAudit`). Structural so tests and the view don't need the
 * server module. */
export interface GrowthProfileAnswers {
  goals: { key: string }[];
  challenges: { key: string }[];
  audiences: { key: string }[];
  ages: { key: string }[];
  priorities: { key: string }[];
  marketScope: { key: string }[];
  environments: { key: string }[];
  geo: { label: string }[];
}

const joinLabels = (labels: string[], shown = 3): string | null => {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length === 0) return null;
  return unique.length > shown ? `${unique.slice(0, shown).join(", ")} +${unique.length - shown} More` : unique.join(", ");
};

/** One compact line of what the Business actually answered for a Growth
 * Profile section ("Brand Awareness, Trial +2 More"), or null when nothing is
 * saved. Real answers only — never placeholder copy. */
export function growthProfileSummary(profile: GrowthProfileAnswers | null, section: AuditSection): string | null {
  if (!profile) return null;
  switch (section) {
    case "goals":
      return joinLabels(profile.goals.map((a) => auditOptionLabel("goal", a.key)));
    case "challenges":
      return joinLabels(profile.challenges.map((a) => auditOptionLabel("challenge", a.key)));
    case "audience":
      return joinLabels([...profile.audiences.map((a) => auditOptionLabel("audience", a.key)), ...profile.ages.map((a) => auditOptionLabel("age_range", a.key))]);
    case "markets":
      return joinLabels([...profile.marketScope.map((a) => auditOptionLabel("market_scope", a.key)), ...profile.geo.map((g) => g.label)]);
    case "environments":
      return joinLabels(profile.environments.map((a) => auditOptionLabel("environment", a.key)));
  }
}
