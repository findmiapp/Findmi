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

// ---------------------------------------------------------------- V1.2 audience

export const AUDIT_AUDIENCES = [
  "gen_z",
  "young_professionals",
  "parents_families",
  "college_students",
  "creators",
  "entrepreneurs",
  "office_workers",
  "fitness_wellness",
  "food_drink",
  "beauty",
  "fashion",
  "tech",
  "sports_fans",
  "entertainment_culture",
  "travelers",
  "local_communities",
  "b2b",
  "other",
] as const;
export type AuditAudience = (typeof AUDIT_AUDIENCES)[number];

export const AUDIT_AUDIENCE_OPTIONS: Record<AuditAudience, AuditOption> = {
  gen_z: { label: "Gen Z", description: "Trend-forward consumers in their teens and twenties." },
  young_professionals: { label: "Young Professionals", description: "Early-career adults building their routines and tastes." },
  parents_families: { label: "Parents & Families", description: "Parents and households with kids." },
  college_students: { label: "College Students", description: "Students on and around campus." },
  creators: { label: "Creators & Influencers", description: "People who make and share content." },
  entrepreneurs: { label: "Entrepreneurs & Founders", description: "People starting and running businesses." },
  office_workers: { label: "Professionals & Office Workers", description: "People reached through the workday." },
  fitness_wellness: { label: "Fitness & Wellness Consumers", description: "Active, health-minded people." },
  food_drink: { label: "Food & Drink Enthusiasts", description: "People who seek out new tastes and spots." },
  beauty: { label: "Beauty Consumers", description: "Skincare, makeup and personal care shoppers." },
  fashion: { label: "Fashion Consumers", description: "Style-driven shoppers." },
  tech: { label: "Tech Enthusiasts", description: "Early adopters of new products and tools." },
  sports_fans: { label: "Sports Fans", description: "Fans at games, watch parties and clubs." },
  entertainment_culture: { label: "Entertainment & Culture Fans", description: "Music, arts, nightlife and culture lovers." },
  travelers: { label: "Travelers & Tourists", description: "Visitors and people on the move." },
  local_communities: { label: "Local Communities", description: "Neighbors and residents of the places you serve." },
  b2b: { label: "B2B & Industry Professionals", description: "Buyers, partners and people in your industry." },
  other: { label: "Other", description: "Someone we didn\u2019t list? Tell us who you want to reach." },
};

export const AUDIT_AGE_RANGES = ["under_18", "18_20", "21_24", "25_34", "35_44", "45_54", "55_64", "65_plus", "not_primary"] as const;
export type AuditAgeRange = (typeof AUDIT_AGE_RANGES)[number];
export const AUDIT_AGE_OPTIONS: Record<AuditAgeRange, AuditOption> = {
  under_18: { label: "Under 18", description: "" },
  "18_20": { label: "18–20", description: "" },
  "21_24": { label: "21–24", description: "" },
  "25_34": { label: "25–34", description: "" },
  "35_44": { label: "35–44", description: "" },
  "45_54": { label: "45–54", description: "" },
  "55_64": { label: "55–64", description: "" },
  "65_plus": { label: "65+", description: "" },
  not_primary: { label: "Age Isn\u2019t A Primary Targeting Factor", description: "" },
};

/** Declared Brand targeting preferences only — never inferred about
 * anyone. Lifestyle/life-stage segments (parents, students, creators,
 * professionals, founders) live in Target Audiences above, so they are
 * deliberately not repeated here. */
export const AUDIT_PRIORITIES = ["women", "men", "lgbtq", "multicultural", "no_priority", "other"] as const;
export type AuditPriority = (typeof AUDIT_PRIORITIES)[number];
export const AUDIT_PRIORITY_OPTIONS: Record<AuditPriority, AuditOption> = {
  women: { label: "Women", description: "" },
  men: { label: "Men", description: "" },
  lgbtq: { label: "LGBTQ+ Audiences", description: "" },
  multicultural: { label: "Multicultural Audiences", description: "" },
  no_priority: { label: "No Specific Demographic Priority", description: "" },
  other: { label: "Other", description: "" },
};

export const AUDIT_MARKET_SCOPES = ["local", "regional", "national", "multi_market"] as const;
export type AuditMarketScope = (typeof AUDIT_MARKET_SCOPES)[number];
export const AUDIT_MARKET_SCOPE_OPTIONS: Record<AuditMarketScope, AuditOption> = {
  local: { label: "Local", description: "One city or metro area." },
  regional: { label: "Regional", description: "Several nearby markets." },
  national: { label: "National", description: "Across the country." },
  multi_market: { label: "Multiple Markets", description: "Specific markets in different places." },
};

export const AUDIT_ENVIRONMENTS = [
  "retail",
  "residential",
  "workplaces",
  "campuses",
  "fitness_wellness",
  "hospitality",
  "restaurants_cafes",
  "festivals_events",
  "street",
  "community_events",
  "creator_events",
  "conferences",
  "other",
] as const;
export type AuditEnvironment = (typeof AUDIT_ENVIRONMENTS)[number];
export const AUDIT_ENVIRONMENT_OPTIONS: Record<AuditEnvironment, AuditOption> = {
  retail: { label: "Retail", description: "Stores, shops and shopping districts." },
  residential: { label: "Residential Buildings", description: "Apartment and condo communities." },
  workplaces: { label: "Workplaces", description: "Offices, coworking and corporate campuses." },
  campuses: { label: "College Campuses", description: "Universities and student life." },
  fitness_wellness: { label: "Fitness & Wellness", description: "Gyms, studios, runs and wellness spaces." },
  hospitality: { label: "Hospitality", description: "Hotels, lobbies and guest experiences." },
  restaurants_cafes: { label: "Restaurants & Cafes", description: "Dining rooms, coffee shops and bars." },
  festivals_events: { label: "Festivals & Events", description: "Fairs, concerts and seasonal events." },
  street: { label: "Street & High-Foot-Traffic", description: "Busy sidewalks, transit and plazas." },
  community_events: { label: "Community Events", description: "Neighborhood and local gatherings." },
  creator_events: { label: "Creator & Influencer Events", description: "Experiences built around creators." },
  conferences: { label: "Conferences & Industry Events", description: "Trade shows and professional events." },
  other: { label: "Other", description: "Somewhere else? Tell us where." },
};

export const AUDIT_KINDS = ["goal", "challenge", "audience", "age_range", "audience_priority", "market_scope", "environment"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];
export const isAuditKind = isOneOf(AUDIT_KINDS);

export const AUDIT_KEYS: Record<AuditKind, readonly string[]> = {
  goal: AUDIT_GOALS,
  challenge: AUDIT_CHALLENGES,
  audience: AUDIT_AUDIENCES,
  age_range: AUDIT_AGE_RANGES,
  audience_priority: AUDIT_PRIORITIES,
  market_scope: AUDIT_MARKET_SCOPES,
  environment: AUDIT_ENVIRONMENTS,
};
export const AUDIT_OPTIONS: Record<AuditKind, Record<string, AuditOption>> = {
  goal: AUDIT_GOAL_OPTIONS,
  challenge: AUDIT_CHALLENGE_OPTIONS,
  audience: AUDIT_AUDIENCE_OPTIONS,
  age_range: AUDIT_AGE_OPTIONS,
  audience_priority: AUDIT_PRIORITY_OPTIONS,
  market_scope: AUDIT_MARKET_SCOPE_OPTIONS,
  environment: AUDIT_ENVIRONMENT_OPTIONS,
};

/** A choice that means "none of the others" — it can't be combined. */
export const EXCLUSIVE_KEYS: Partial<Record<AuditKind, string>> = { age_range: "not_primary", audience_priority: "no_priority" };
/** Kinds where only one choice is allowed. */
const SINGLE_CHOICE: ReadonlySet<AuditKind> = new Set(["market_scope"]);

/** The Audit sections a Brand profile is made of (progress counts these). */
export const AUDIT_SECTIONS = ["goals", "challenges", "audience", "markets", "environments"] as const;
export type AuditSection = (typeof AUDIT_SECTIONS)[number];
export const AUDIT_SECTION_LABELS: Record<AuditSection, string> = {
  goals: "Goals",
  challenges: "Challenges",
  audience: "Target Audience",
  markets: "Markets",
  environments: "Activation Environments",
};
/** Which answer kinds belong to which section. */
export const SECTION_OF_KIND: Record<AuditKind, AuditSection> = {
  goal: "goals",
  challenge: "challenges",
  audience: "audience",
  age_range: "audience",
  audience_priority: "audience",
  market_scope: "markets",
  environment: "environments",
};

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

const OTHER_PROMPT: Record<AuditKind, string> = {
  goal: "Tell us about your other goal.",
  challenge: "Tell us about your other challenge.",
  audience: "Tell us about the other audience you want to reach.",
  age_range: "Tell us more.",
  audience_priority: "Tell us about your other audience priority.",
  market_scope: "Tell us more.",
  environment: "Tell us about the other environment.",
};

/** Validates one kind's selections: known keys only,
 * no duplicates, at least one choice, per-choice elaboration within the
 * limit, and Other always explained (it means nothing without its text). */
export function validateAuditAnswers(
  kind: AuditKind,
  input: AuditAnswerInput[],
  opts: { allowEmpty?: boolean } = {}
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
      return { ok: false, error: OTHER_PROMPT[kind] };
    }
    value.push({ key: a.key, detail });
  }
  const exclusive = EXCLUSIVE_KEYS[kind];
  if (exclusive && seen.has(exclusive) && value.length > 1) {
    return { ok: false, error: `\u201c${AUDIT_OPTIONS[kind][exclusive].label}\u201d can\u2019t be combined with other choices.` };
  }
  if (SINGLE_CHOICE.has(kind) && value.length > 1) return { ok: false, error: "Choose one." };
  if (value.length === 0 && !opts.allowEmpty) return { ok: false, error: kind === "goal" ? "Choose at least one Goal." : kind === "challenge" ? "Choose at least one Challenge." : "Choose at least one option." };
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
  /** V1.2 sections (absent = 0). Audience counts audiences, ages and
   * priorities; markets counts the scope plus every market/area entry. */
  audienceCount?: number;
  marketCount?: number;
  environmentCount?: number;
}

export function auditSectionsAnswered(s: AuditSummary): Record<AuditSection, boolean> {
  return {
    goals: s.goalCount > 0,
    challenges: s.challengeCount > 0,
    audience: (s.audienceCount ?? 0) > 0,
    markets: (s.marketCount ?? 0) > 0,
    environments: (s.environmentCount ?? 0) > 0,
  };
}

export function auditMissingSections(s: AuditSummary): AuditSection[] {
  const answered = auditSectionsAnswered(s);
  return AUDIT_SECTIONS.filter((k) => !answered[k]);
}

/** Share of the five profile sections answered (0–100, steps of 20). A
 * completed V1 Audit (Goals + Challenges only) stays Complete and reads
 * 40% until the newer sections are added. */
export function auditProgress(s: AuditSummary): number {
  return Math.round(((AUDIT_SECTIONS.length - auditMissingSections(s).length) / AUDIT_SECTIONS.length) * 100);
}

export type AuditState = "not_started" | "in_progress" | "complete";

export function auditState(s: AuditSummary): AuditState {
  if (s.status === "complete") return "complete";
  return s.status === null && auditMissingSections(s).length === AUDIT_SECTIONS.length ? "not_started" : "in_progress";
}

/** The dashboard entry's call to action. */
export function auditActionLabel(s: AuditSummary): string {
  const state = auditState(s);
  if (state === "complete") return auditMissingSections(s).length > 0 ? "Complete Your Profile" : "Review & Update";
  return state === "not_started" ? "Start Brand Audit" : "Continue Brand Audit";
}

export type AuditStep = "intro" | "goals" | "challenges" | "audience" | "markets" | "environments" | "review";

/** Which step a returning Brand lands on: the first unanswered section
 * (Goals and Challenges first), else Review. A completed Audit with new
 * sections still open resumes on the first of them. */
export function auditResumeStep(s: AuditSummary): AuditStep {
  const missing = auditMissingSections(s);
  if (auditState(s) === "not_started") return "intro";
  return missing[0] ?? "review";
}

// ---------------------------------------------------------------- V1.2 geography

export const GEO_INTENTS = ["current", "priority"] as const;
export type GeoIntent = (typeof GEO_INTENTS)[number];
export const GEO_INTENT_LABELS: Record<GeoIntent, string> = { current: "Current Markets", priority: "Priority / Growth Markets" };
export type GeoLevel = "market" | "area" | "neighborhood" | "place";

/** NYC neighborhoods a Brand can name as priority areas. A small curated
 * suggestion set (Findmi is NYC-first), keyed by stable slugs — NOT a
 * geography system. FUTURE AREA SEAM: when canonical Findmi Areas exist,
 * these keys (and Brand-entered ones) map to them by place_key. */
export const NYC_MARKET_SLUG = "nyc";
export const NYC_NEIGHBORHOODS: { key: string; label: string }[] = [
  { key: "soho", label: "SoHo" },
  { key: "tribeca", label: "Tribeca" },
  { key: "nolita", label: "Nolita" },
  { key: "lower-east-side", label: "Lower East Side" },
  { key: "east-village", label: "East Village" },
  { key: "west-village", label: "West Village" },
  { key: "chelsea", label: "Chelsea" },
  { key: "flatiron", label: "Flatiron" },
  { key: "midtown", label: "Midtown" },
  { key: "financial-district", label: "Financial District" },
  { key: "upper-east-side", label: "Upper East Side" },
  { key: "upper-west-side", label: "Upper West Side" },
  { key: "harlem", label: "Harlem" },
  { key: "williamsburg", label: "Williamsburg" },
  { key: "greenpoint", label: "Greenpoint" },
  { key: "bushwick", label: "Bushwick" },
  { key: "dumbo", label: "DUMBO" },
  { key: "park-slope", label: "Park Slope" },
  { key: "long-island-city", label: "Long Island City" },
  { key: "astoria", label: "Astoria" },
];

export function placeKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export interface GeoCatalog {
  markets: { id: string; slug: string; name: string }[];
  areas: { id: string; slug: string; name: string; market_id: string }[];
}

/** What the client sends: a market / area by id, a curated or Brand-named
 * NYC neighborhood, or a Brand-named market Findmi doesn't cover yet. */
export interface GeoInput {
  intent: string;
  level: string;
  id?: string | null;
  key?: string | null;
  label?: string | null;
}

export interface GeoEntry {
  intent: GeoIntent;
  level: GeoLevel;
  market_id: string | null;
  market_area_id: string | null;
  place_key: string;
  label: string;
}

export const GEO_LIMITS = { perIntent: 30, label: 60 } as const;

/** Server-side validation: ids must be real active markets/areas, curated
 * neighborhoods must be known (or a Brand-named one, normalized), labels
 * always come from Findmi's own data when it has them. */
export function validateGeo(input: GeoInput[], catalog: GeoCatalog): { ok: true; value: GeoEntry[] } | { ok: false; error: string } {
  const nyc = catalog.markets.find((m) => m.slug === NYC_MARKET_SLUG) ?? null;
  const out: GeoEntry[] = [];
  const seen = new Set<string>();
  for (const g of input) {
    if (g.intent !== "current" && g.intent !== "priority") return { ok: false, error: "That market choice isn\u2019t available." };
    let entry: GeoEntry | null = null;
    if (g.level === "market") {
      const m = catalog.markets.find((x) => x.id === g.id);
      if (!m) return { ok: false, error: "One of those markets isn\u2019t available." };
      entry = { intent: g.intent, level: "market", market_id: m.id, market_area_id: null, place_key: placeKey(m.slug), label: m.name };
    } else if (g.level === "area") {
      const a = catalog.areas.find((x) => x.id === g.id);
      if (!a) return { ok: false, error: "One of those areas isn\u2019t available." };
      entry = { intent: g.intent, level: "area", market_id: a.market_id, market_area_id: a.id, place_key: placeKey(a.slug), label: a.name };
    } else if (g.level === "neighborhood") {
      if (!nyc) return { ok: false, error: "Neighborhoods aren\u2019t available yet." };
      const curated = NYC_NEIGHBORHOODS.find((n) => n.key === g.key);
      const label = curated?.label ?? g.label?.trim() ?? "";
      const key = curated?.key ?? placeKey(label);
      if (!key || label.length > GEO_LIMITS.label) return { ok: false, error: "Name each neighborhood in 60 characters or fewer." };
      entry = { intent: g.intent, level: "neighborhood", market_id: nyc.id, market_area_id: null, place_key: key, label };
    } else if (g.level === "place") {
      const label = g.label?.trim() ?? "";
      const key = placeKey(label);
      if (!key || label.length > GEO_LIMITS.label) return { ok: false, error: "Name each market in 60 characters or fewer." };
      entry = { intent: g.intent, level: "place", market_id: null, market_area_id: null, place_key: key, label };
    } else {
      return { ok: false, error: "That market choice isn\u2019t available." };
    }
    const id = `${entry.intent}:${entry.level}:${entry.place_key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
  }
  for (const intent of GEO_INTENTS) {
    if (out.filter((e) => e.intent === intent).length > GEO_LIMITS.perIntent) return { ok: false, error: "Choose fewer places." };
  }
  return { ok: true, value: out };
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
