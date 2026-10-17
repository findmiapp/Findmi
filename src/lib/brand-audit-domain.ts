// Findmi Brand Audit + Opportunity Intelligence V1 — the canonical,
// dependency-free rules (safe for server and client code, tested directly
// by tests/brand-audit.test.mjs). Every value list mirrors a CHECK
// constraint in
// supabase/migrations/20261021000000_brand_audit_and_opportunity_ideas.sql
// — change both together.
//
// Goal keys deliberately reuse the existing Opportunity Goal objective keys
// (lib/opportunity-goals-domain.ts GOAL_OBJECTIVES) wherever the meaning
// is the same, so a Brand Audit Goal and an Opportunity Goal objective can
// be compared directly by future matching. The Brand Audit is the
// Business-level "where are you headed"; Opportunity Goals stay the
// per-request records with budget and timing.

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

export interface AuditOption {
  label: string;
  description: string;
}

// ---------------------------------------------------------------- goals

export const AUDIT_GOALS = [
  "build_awareness",
  "product_sampling",
  "drive_sales",
  "product_launch",
  "foot_traffic",
  "reach_new_customers",
  "community_engagement",
  "lead_generation",
  "generate_content",
  "retail_trial",
  "partnerships",
  "other",
] as const;
export type AuditGoal = (typeof AUDIT_GOALS)[number];

export const AUDIT_GOAL_OPTIONS: Record<AuditGoal, AuditOption> = {
  build_awareness: { label: "Increase Brand Awareness", description: "Get your brand known by more of the right people." },
  product_sampling: { label: "Drive Product Trial", description: "Get your product into people’s hands so they can try it." },
  drive_sales: { label: "Generate Sales", description: "Turn interest into purchases, online or in person." },
  product_launch: { label: "Launch A Product", description: "Introduce something new and build early momentum." },
  foot_traffic: { label: "Drive Foot Traffic", description: "Bring more people to your store, venue or pop-up." },
  reach_new_customers: { label: "Reach New Audiences", description: "Connect with customers you aren’t reaching today." },
  community_engagement: { label: "Build Community", description: "Create lasting relationships with the people who love your brand." },
  lead_generation: { label: "Generate Leads", description: "Collect contacts and inquiries you can follow up with." },
  generate_content: { label: "Create Content", description: "Capture photos, video and stories worth sharing." },
  retail_trial: { label: "Grow Retail Presence", description: "Earn shelf space, placements or new retail partners." },
  partnerships: { label: "Build Partnerships", description: "Team up with brands, venues and organizations that fit." },
  other: { label: "Other", description: "Have a goal we didn’t cover? Tell us what you’re working toward." },
};

// ---------------------------------------------------------------- challenges

export const AUDIT_CHALLENGES = [
  "finding_opportunities",
  "activation_locations",
  "reaching_audience",
  "product_trial",
  "local_awareness",
  "reliable_partners",
  "staffing_execution",
  "measuring_results",
  "budget_efficiency",
  "content_reach",
  "retail_access",
  "other",
] as const;
export type AuditChallenge = (typeof AUDIT_CHALLENGES)[number];

export const AUDIT_CHALLENGE_OPTIONS: Record<AuditChallenge, AuditOption> = {
  finding_opportunities: { label: "Finding The Right Opportunities", description: "Knowing which events, places and programs are worth your time." },
  activation_locations: { label: "Finding Places To Activate", description: "Securing venues, spaces or permission to show up in person." },
  reaching_audience: { label: "Reaching The Right Audience", description: "Getting in front of the people most likely to buy." },
  product_trial: { label: "Generating Product Trial", description: "Getting people to try your product for the first time." },
  local_awareness: { label: "Building Local Awareness", description: "Becoming known in the neighborhoods and markets you serve." },
  reliable_partners: { label: "Finding Reliable Partners", description: "Finding venues, vendors and collaborators you can count on." },
  staffing_execution: { label: "Staffing & Execution", description: "Having the people and time to run activations well." },
  measuring_results: { label: "Measuring Results & ROI", description: "Knowing what’s working and what it’s worth." },
  budget_efficiency: { label: "Budget Efficiency", description: "Making a limited marketing budget go further." },
  content_reach: { label: "Content & Social Reach", description: "Creating content that gets seen and shared." },
  retail_access: { label: "Retail & Placement Access", description: "Getting onto shelves, menus or into new stores." },
  other: { label: "Other", description: "Something else in the way? Tell us what’s making it harder." },
};

export const AUDIT_KINDS = ["goal", "challenge"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
export const isAuditKind = isOneOf(AUDIT_KINDS);

export const AUDIT_KEYS: Record<AuditKind, readonly string[]> = { goal: AUDIT_GOALS, challenge: AUDIT_CHALLENGES };
export const AUDIT_OPTIONS: Record<AuditKind, Record<string, AuditOption>> = { goal: AUDIT_GOAL_OPTIONS, challenge: AUDIT_CHALLENGE_OPTIONS };

export function auditOptionLabel(kind: AuditKind, key: string): string {
  return AUDIT_OPTIONS[kind][key]?.label ?? key;
}

export const AUDIT_DETAIL_MAX = 1000;

export interface AuditAnswerInput {
  key: string;
  detail: string | null;
}

export interface AuditAnswer {
  key: string;
  detail: string | null;
}

/** Validates one step's selections (Goals or Challenges): known keys only,
 * no duplicates, at least one choice, per-choice elaboration within the
 * limit, and Other always explained (it means nothing without its text). */
export function validateAuditAnswers(
  kind: AuditKind,
  input: AuditAnswerInput[]
): { ok: true; value: AuditAnswer[] } | { ok: false; error: string } {
  const allowed = AUDIT_KEYS[kind];
  const seen = new Set<string>();
  const value: AuditAnswer[] = [];
  for (const a of input) {
    if (!allowed.includes(a.key)) return { ok: false, error: "One of those choices isn’t available." };
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    const detail = a.detail?.trim() ? a.detail.trim() : null;
    if (detail && detail.length > AUDIT_DETAIL_MAX) return { ok: false, error: `Keep each note to ${AUDIT_DETAIL_MAX} characters.` };
    if (a.key === "other" && !detail) {
      return { ok: false, error: kind === "goal" ? "Tell us about your other goal." : "Tell us about your other challenge." };
    }
    value.push({ key: a.key, detail });
  }
  if (value.length === 0) return { ok: false, error: kind === "goal" ? "Choose at least one Goal." : "Choose at least one Challenge." };
  // Stored and shown in the canonical option order, whatever order they were tapped.
  value.sort((x, y) => allowed.indexOf(x.key) - allowed.indexOf(y.key));
  return { ok: true, value };
}

// ---------------------------------------------------------------- audit status

export const AUDIT_STATUSES = ["in_progress", "complete"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export interface AuditSummary {
  status: AuditStatus | null;
  goalCount: number;
  challengeCount: number;
  completedAt: string | null;
  updatedAt: string | null;
}

/** 0 / 50 / 100 — Goals and Challenges are the two answered steps; a
 * finished audit is 100 even if it is later edited. */
export function auditProgress(s: AuditSummary): number {
  if (s.status === "complete") return 100;
  return ((s.goalCount > 0 ? 1 : 0) + (s.challengeCount > 0 ? 1 : 0)) * 50;
}

export type AuditState = "not_started" | "in_progress" | "complete";

export function auditState(s: AuditSummary): AuditState {
  if (s.status === "complete") return "complete";
  return s.status === null && s.goalCount === 0 && s.challengeCount === 0 ? "not_started" : "in_progress";
}

/** The dashboard entry's call to action. */
export function auditActionLabel(s: AuditSummary): string {
  const state = auditState(s);
  if (state === "complete") return "Review & Update";
  return state === "not_started" ? "Start Brand Audit" : "Continue Brand Audit";
}

/** Which step a returning Brand lands on. */
export function auditResumeStep(s: AuditSummary): "intro" | "goals" | "challenges" | "review" {
  if (s.status === "complete") return "review";
  if (s.goalCount === 0) return auditState(s) === "not_started" ? "intro" : "goals";
  return s.challengeCount === 0 ? "challenges" : "review";
}

// ---------------------------------------------------------------- opportunity ideas

export const IDEA_TYPES = [
  "sampling",
  "residential",
  "workplace",
  "retail",
  "events",
  "hospitality",
  "wellness",
  "campus",
  "partnerships",
  "content",
  "sponsorship",
  "other",
] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];
export const isIdeaType = isOneOf(IDEA_TYPES);

export const IDEA_TYPE_LABELS: Record<IdeaType, string> = {
  sampling: "Sampling",
  residential: "Residential",
  workplace: "Workplace",
  retail: "Retail",
  events: "Events",
  hospitality: "Hospitality",
  wellness: "Wellness",
  campus: "Campus",
  partnerships: "Partnerships",
  content: "Content",
  sponsorship: "Sponsorship",
  other: "Other",
};

export const IDEA_STATUSES = ["draft", "published", "archived"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const isIdeaStatus = isOneOf(IDEA_STATUSES);
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = { draft: "Draft", published: "Published", archived: "Archived" };

export const IDEA_AUDIENCES = ["all_brands", "selected_businesses"] as const;
export type IdeaAudience = (typeof IDEA_AUDIENCES)[number];
export const isIdeaAudience = isOneOf(IDEA_AUDIENCES);
export const IDEA_AUDIENCE_LABELS: Record<IdeaAudience, string> = { all_brands: "All Brands", selected_businesses: "Selected Businesses" };

export const IDEA_RESPONSES = ["interested", "maybe", "not_for_us"] as const;
export type IdeaResponse = (typeof IDEA_RESPONSES)[number];
export const isIdeaResponse = isOneOf(IDEA_RESPONSES);
export const IDEA_RESPONSE_LABELS: Record<IdeaResponse, string> = { interested: "Interested", maybe: "Maybe", not_for_us: "Not For Us" };

export const IDEA_LIMITS = { title: 80, summary: 240, details: 2000, note: 1000, targets: 200 } as const;

export interface IdeaEligibilityInput {
  status: string;
  audience: string;
  /** Business ids of an idea targeted to Selected Businesses. */
  targetBusinessIds: readonly string[];
}

/** THE eligibility rule, used by every server read and write: only a
 * Published Idea, and only for All Brands or a Business it explicitly
 * targets. Draft and Archived never reach a Business. */
export function isIdeaEligible(idea: IdeaEligibilityInput, businessId: string): boolean {
  if (idea.status !== "published") return false;
  if (idea.audience === "all_brands") return true;
  return idea.audience === "selected_businesses" && idea.targetBusinessIds.includes(businessId);
}

/** Dashboard order: unanswered first (in display order), then answered —
 * still reachable to change, but never presented as waiting again. */
export function orderIdeasForBusiness<T extends { displayOrder: number; title: string; response: { value: IdeaResponse } | null }>(ideas: T[]): T[] {
  const byOrder = (a: T, b: T) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title);
  return [...ideas.filter((i) => !i.response).sort(byOrder), ...ideas.filter((i) => i.response).sort(byOrder)];
}

export interface IdeaFormInput {
  title: string | null;
  summary: string | null;
  details: string | null;
  idea_type: string | null;
  status: string | null;
  display_order: string | null;
  audience: string | null;
  target_business_ids: string[];
}

export interface IdeaFields {
  title: string;
  summary: string;
  details: string | null;
  idea_type: IdeaType;
  status: IdeaStatus;
  display_order: number;
  audience: IdeaAudience;
  target_business_ids: string[];
}

export function validateIdeaInput(input: IdeaFormInput): { ok: true; value: IdeaFields } | { ok: false; error: string } {
  const title = input.title?.trim() ?? "";
  if (!title) return { ok: false, error: "Add a title." };
  if (title.length > IDEA_LIMITS.title) return { ok: false, error: `Keep the title to ${IDEA_LIMITS.title} characters.` };
  const summary = input.summary?.trim() ?? "";
  if (!summary) return { ok: false, error: "Add a short description." };
  if (summary.length > IDEA_LIMITS.summary) return { ok: false, error: `Keep the short description to ${IDEA_LIMITS.summary} characters.` };
  const details = input.details?.trim() ? input.details.trim() : null;
  if ((details?.length ?? 0) > IDEA_LIMITS.details) return { ok: false, error: "Keep the longer explanation shorter." };
  if (!isIdeaType(input.idea_type)) return { ok: false, error: "Choose a type." };
  if (!isIdeaStatus(input.status)) return { ok: false, error: "Choose a status." };
  if (!isIdeaAudience(input.audience)) return { ok: false, error: "Choose who sees this Idea." };
  const order = Number.parseInt(input.display_order ?? "", 10);
  const display_order = Number.isFinite(order) ? Math.max(0, Math.min(order, 100_000)) : 100;
  const targets = [...new Set(input.target_business_ids.filter(Boolean))];
  if (targets.length > IDEA_LIMITS.targets) return { ok: false, error: "Choose fewer Businesses." };
  if (input.audience === "selected_businesses" && targets.length === 0) return { ok: false, error: "Choose at least one Business, or show this Idea to All Brands." };
  return {
    ok: true,
    value: {
      title,
      summary,
      details,
      idea_type: input.idea_type,
      status: input.status,
      display_order,
      audience: input.audience,
      target_business_ids: input.audience === "selected_businesses" ? targets : [],
    },
  };
}
