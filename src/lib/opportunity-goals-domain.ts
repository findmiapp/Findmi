// Opportunities V2 — the canonical, dependency-free rules for Business
// Opportunity Goals (public.business_opportunity_goals): what a Business
// wants to accomplish, as structured, persistent records that can later
// feed matching. Many goals per Business.
//
// No imports on purpose: safe for server and client code, and testable
// directly (tests/opportunity-goals.test.mjs). Every value list mirrors a
// CHECK constraint in
// supabase/migrations/20261007000000_opportunity_goals_and_discoverability.sql
// — change both together.

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

// ---------------------------------------------------------------- objectives

export const GOAL_OBJECTIVES = [
  "drive_sales",
  "product_sampling",
  "product_launch",
  "build_awareness",
  "reach_new_customers",
  "generate_content",
  "retail_trial",
  "lead_generation",
  "community_engagement",
  "sponsorship",
  "something_else",
] as const;
export type GoalObjective = (typeof GOAL_OBJECTIVES)[number];

export const GOAL_OBJECTIVE_LABELS: Record<GoalObjective, string> = {
  drive_sales: "Drive Sales",
  product_sampling: "Product Sampling",
  product_launch: "Product Launch",
  build_awareness: "Build Awareness",
  reach_new_customers: "Reach New Customers",
  generate_content: "Generate Content",
  retail_trial: "Retail Trial",
  lead_generation: "Lead Generation",
  community_engagement: "Community Engagement",
  sponsorship: "Sponsorship",
  something_else: "Something Else",
};

// ---------------------------------------------------------------- opportunity interests

export const GOAL_INTERESTS = [
  "pop_ups",
  "sampling_demos",
  "residential",
  "retail",
  "markets_festivals",
  "corporate_office",
  "hospitality",
  "sponsorships",
  "vending",
  "content_creator",
  "partnerships",
  "experiential",
  "open_to_ideas",
] as const;
export type GoalInterest = (typeof GOAL_INTERESTS)[number];

export const GOAL_INTEREST_LABELS: Record<GoalInterest, string> = {
  pop_ups: "Pop-Ups",
  sampling_demos: "Sampling & Demos",
  residential: "Residential",
  retail: "Retail",
  markets_festivals: "Markets & Festivals",
  corporate_office: "Corporate / Office",
  hospitality: "Hospitality",
  sponsorships: "Sponsorships",
  vending: "Vending",
  content_creator: "Content / Creator",
  partnerships: "Partnerships",
  experiential: "Experiential",
  open_to_ideas: "Open To Ideas",
};

// ---------------------------------------------------------------- budget

export const GOAL_BUDGET_BANDS = ["under_500", "500_1k", "1k_2_5k", "2_5k_5k", "5k_10k", "10k_plus", "flexible", "not_sure"] as const;
export type GoalBudgetBand = (typeof GOAL_BUDGET_BANDS)[number];

/** Label plus the cents range stored alongside the band (null = open-ended
 * or not applicable) so future matching can compare against listing
 * price_cents without re-deriving anything. */
export const GOAL_BUDGET: Record<GoalBudgetBand, { label: string; min: number | null; max: number | null }> = {
  under_500: { label: "Under $500", min: 0, max: 50_000 },
  "500_1k": { label: "$500–$1K", min: 50_000, max: 100_000 },
  "1k_2_5k": { label: "$1K–$2.5K", min: 100_000, max: 250_000 },
  "2_5k_5k": { label: "$2.5K–$5K", min: 250_000, max: 500_000 },
  "5k_10k": { label: "$5K–$10K", min: 500_000, max: 1_000_000 },
  "10k_plus": { label: "$10K+", min: 1_000_000, max: null },
  flexible: { label: "Flexible", min: null, max: null },
  not_sure: { label: "Not Sure", min: null, max: null },
};

// ---------------------------------------------------------------- timing

export const GOAL_TIMINGS = ["asap", "next_30_days", "next_90_days", "specific_dates", "ongoing", "flexible"] as const;
export type GoalTiming = (typeof GOAL_TIMINGS)[number];

export const GOAL_TIMING_LABELS: Record<GoalTiming, string> = {
  asap: "ASAP",
  next_30_days: "Next 30 Days",
  next_90_days: "Next 90 Days",
  specific_dates: "Specific Dates",
  ongoing: "Ongoing",
  flexible: "Flexible",
};

// ---------------------------------------------------------------- status

export const GOAL_STATUSES = ["active", "paused", "closed"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { active: "Active", paused: "Paused", closed: "Closed" };

/** Pause / resume / close / reopen. Closing is never a delete. */
export const GOAL_STATUS_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  active: ["paused", "closed"],
  paused: ["active", "closed"],
  closed: ["active"],
};

export function canGoalTransition(from: GoalStatus, to: GoalStatus): boolean {
  return GOAL_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function goalTransitionLabel(from: GoalStatus, to: GoalStatus): string {
  if (to === "paused") return "Pause Goal";
  if (to === "closed") return "Close Goal";
  return from === "paused" ? "Resume Goal" : "Reopen Goal";
}

export const isGoalObjective = isOneOf(GOAL_OBJECTIVES);
export const isGoalInterest = isOneOf(GOAL_INTERESTS);
export const isGoalBudgetBand = isOneOf(GOAL_BUDGET_BANDS);
export const isGoalTiming = isOneOf(GOAL_TIMINGS);
export const isGoalStatus = isOneOf(GOAL_STATUSES);

// ---------------------------------------------------------------- permissions

export type GoalRole = "owner" | "manager" | "staff";

/** Owner/manager create, edit and change status; staff view only. An Admin
 * Manage-As session never authors a goal as the Business (there is no
 * real Business user to attribute it to). */
export function canManageGoals(role: GoalRole, viaAdmin?: boolean): boolean {
  return !viaAdmin && (role === "owner" || role === "manager");
}

// ---------------------------------------------------------------- input

export const GOAL_LIMITS = { title: 120, audience_text: 1000, markets_text: 300, notes: 2000, markets: 20 } as const;

export interface GoalFormInput {
  title: string | null;
  objectives: string[];
  opportunity_interests: string[];
  audience_text: string | null;
  market_ids: string[];
  markets_text: string | null;
  budget_band: string | null;
  timing: string | null;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
}

export interface GoalFields {
  title: string;
  objectives: GoalObjective[];
  opportunity_interests: GoalInterest[];
  audience_text: string | null;
  market_ids: string[];
  markets_text: string | null;
  budget_band: GoalBudgetBand;
  budget_min_cents: number | null;
  budget_max_cents: number | null;
  timing: GoalTiming;
  starts_on: string | null;
  ends_on: string | null;
  notes: string | null;
}

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Server-side validation of a create/edit payload — the same rules as the
 * table CHECKs, as friendly messages. `allowedMarketIds` is the set of
 * active Findmi Markets (checked by the caller against the database);
 * unknown market ids are rejected, never silently stored. */
export function validateGoalInput(
  input: GoalFormInput,
  allowedMarketIds: ReadonlySet<string>
): { ok: true; value: GoalFields } | { ok: false; error: string } {
  const objectives = [...new Set(input.objectives)];
  if (objectives.length === 0) return { ok: false, error: "Choose at least one thing you're trying to accomplish." };
  if (!objectives.every(isGoalObjective)) return { ok: false, error: "One of those goals isn't available." };

  const interests = [...new Set(input.opportunity_interests)];
  if (interests.length === 0) return { ok: false, error: "Choose at least one kind of Opportunity." };
  if (!interests.every(isGoalInterest)) return { ok: false, error: "One of those Opportunity types isn't available." };

  const marketIds = [...new Set(input.market_ids.filter(Boolean))];
  if (marketIds.length > GOAL_LIMITS.markets) return { ok: false, error: "Choose fewer markets." };
  if (!marketIds.every((m) => allowedMarketIds.has(m))) return { ok: false, error: "One of those markets isn't available." };

  if (!isGoalBudgetBand(input.budget_band)) return { ok: false, error: "Choose a budget." };
  if (!isGoalTiming(input.timing)) return { ok: false, error: "Choose when." };

  let starts_on: string | null = null;
  let ends_on: string | null = null;
  if (input.timing === "specific_dates") {
    starts_on = blank(input.starts_on);
    ends_on = blank(input.ends_on);
    if (!starts_on) return { ok: false, error: "Add a start date." };
    if (!DATE_RE.test(starts_on) || (ends_on && !DATE_RE.test(ends_on))) return { ok: false, error: "One of the dates isn't valid." };
    if (ends_on && ends_on < starts_on) return { ok: false, error: "The end date can't be before the start date." };
  }

  const title = blank(input.title) ?? suggestGoalTitle(objectives as GoalObjective[], interests as GoalInterest[]);
  if (title.length > GOAL_LIMITS.title) return { ok: false, error: `Keep the title to ${GOAL_LIMITS.title} characters.` };
  const audience_text = blank(input.audience_text);
  if ((audience_text?.length ?? 0) > GOAL_LIMITS.audience_text) return { ok: false, error: "Keep the audience description shorter." };
  const markets_text = blank(input.markets_text);
  if ((markets_text?.length ?? 0) > GOAL_LIMITS.markets_text) return { ok: false, error: "Keep the location description shorter." };
  const notes = blank(input.notes);
  if ((notes?.length ?? 0) > GOAL_LIMITS.notes) return { ok: false, error: "Keep your notes shorter." };

  const budget = GOAL_BUDGET[input.budget_band];
  return {
    ok: true,
    value: {
      title,
      objectives: objectives as GoalObjective[],
      opportunity_interests: interests as GoalInterest[],
      audience_text,
      market_ids: marketIds,
      markets_text,
      budget_band: input.budget_band,
      budget_min_cents: budget.min,
      budget_max_cents: budget.max,
      timing: input.timing,
      starts_on,
      ends_on,
      notes,
    },
  };
}

/** A readable default title from the selections ("Product Sampling ·
 * Residential"). The Business can always edit it before submitting. */
export function suggestGoalTitle(objectives: readonly GoalObjective[], interests: readonly GoalInterest[]): string {
  const first = objectives.find((o) => o !== "something_else") ?? objectives[0];
  const interest = interests.find((i) => i !== "open_to_ideas") ?? interests[0];
  const parts = [first ? GOAL_OBJECTIVE_LABELS[first] : null, interest ? GOAL_INTEREST_LABELS[interest] : null].filter(Boolean);
  return parts.join(" · ") || "New Goal";
}

/** "Oct 1 – Dec 31, 2026" / "From Oct 1, 2026" / the timing label. */
export function formatGoalTiming(goal: { timing: GoalTiming; starts_on: string | null; ends_on: string | null }): string {
  if (goal.timing !== "specific_dates" || !goal.starts_on) return GOAL_TIMING_LABELS[goal.timing];
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return goal.ends_on ? `${fmt(goal.starts_on)} – ${fmt(goal.ends_on)}` : `From ${fmt(goal.starts_on)}`;
}
