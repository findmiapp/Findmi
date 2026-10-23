// Canonical Commercial Intents V1 — the ONE vocabulary for WHY a Business
// pursues a counterparty. Targets store these codes (business_targets.intents);
// later Inquiries, Open To signals and Opportunity matching speak the same
// list. Code-level only — there is no intents table. Pure (client + server).
//
// Which intents fit depends only on the counterparty KIND (Business, Location,
// Event) — never on its Category.

export const COMMERCIAL_INTENTS = [
  "placement",
  "wholesale",
  "distribution",
  "collaboration",
  "sponsorship",
  "sampling",
  "activation",
  "pop_up",
  "event_participation",
  "vending",
  "content",
  "booking",
] as const;
export type CommercialIntent = (typeof COMMERCIAL_INTENTS)[number];

export const COMMERCIAL_INTENT_LABELS: Record<CommercialIntent, string> = {
  placement: "Placement",
  wholesale: "Wholesale",
  distribution: "Distribution",
  collaboration: "Collaboration",
  sponsorship: "Sponsorship",
  sampling: "Sampling",
  activation: "Activation",
  pop_up: "Pop-Up",
  event_participation: "Event Participation",
  vending: "Vending",
  content: "Content",
  booking: "Booking",
};

export const TARGET_KINDS = ["location", "business", "event"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** The intents each counterparty kind can carry, in display order. */
export const INTENTS_BY_KIND: Record<TargetKind, readonly CommercialIntent[]> = {
  location: ["placement", "sampling", "activation", "pop_up", "vending", "booking"],
  business: ["wholesale", "distribution", "collaboration", "sponsorship", "sampling", "activation", "content", "booking"],
  event: ["event_participation", "sponsorship", "sampling", "activation", "vending", "content"],
};

/** Preselected when a Target is created (the Location lens is placement-first). */
export const DEFAULT_INTENTS_BY_KIND: Record<TargetKind, readonly CommercialIntent[]> = {
  location: ["placement"],
  business: [],
  event: ["event_participation"],
};

export const isCommercialIntent = (v: unknown): v is CommercialIntent => typeof v === "string" && (COMMERCIAL_INTENTS as readonly string[]).includes(v);
export const isTargetKind = (v: unknown): v is TargetKind => typeof v === "string" && (TARGET_KINDS as readonly string[]).includes(v);

export function isIntentCompatible(kind: TargetKind, intent: CommercialIntent): boolean {
  return INTENTS_BY_KIND[kind].includes(intent);
}

/** Untrusted intents for one kind → deduplicated, in canonical display order.
 * At least one is required; any code that doesn't fit the kind is refused. */
export function validateTargetIntents(kind: TargetKind, raw: unknown): { ok: true; value: CommercialIntent[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return { ok: false, error: "Choose at least one reason." };
  if (list.length > COMMERCIAL_INTENTS.length) return { ok: false, error: "Choose fewer reasons." };
  for (const v of list) {
    if (!isCommercialIntent(v) || !isIntentCompatible(kind, v)) return { ok: false, error: "That reason doesn’t fit this Target." };
  }
  return { ok: true, value: INTENTS_BY_KIND[kind].filter((i) => list.includes(i)) };
}

export function intentsPhrase(intents: readonly CommercialIntent[]): string {
  return intents.map((i) => COMMERCIAL_INTENT_LABELS[i]).join(", ");
}

// ── How the existing vocabularies map onto the canonical codes ──────────────
// Documentation + future matching only: none of these systems is migrated or
// rewritten. null = not a commercial intent (an outcome, an audience or an
// environment such as "residential"), so it never implies one.

export const INTENT_MAP_OPPORTUNITY_TYPE: Record<string, CommercialIntent | null> = {
  activation: "activation",
  sampling_demo: "sampling",
  vending: "vending",
  sponsorship: "sponsorship",
  content: "content",
  partnership: "collaboration",
  other: null,
};

/** business_opportunity_goals.opportunity_interests */
export const INTENT_MAP_GOAL_INTEREST: Record<string, CommercialIntent | null> = {
  pop_ups: "pop_up",
  sampling_demos: "sampling",
  residential: null,
  retail: "placement",
  markets_festivals: "event_participation",
  corporate_office: null,
  hospitality: null,
  sponsorships: "sponsorship",
  vending: "vending",
  content_creator: "content",
  partnerships: "collaboration",
  experiential: "activation",
  open_to_ideas: null,
};

/** business_opportunity_goals.objectives and brand_audit_answers kind=goal
 * (outcomes; only those that name a channel map). */
export const INTENT_MAP_GOAL_OBJECTIVE: Record<string, CommercialIntent | null> = {
  product_sampling: "sampling",
  retail_trial: "placement",
  increase_distribution: "distribution",
  partnerships: "collaboration",
  sponsorship: "sponsorship",
  generate_content: "content",
};

/** opportunity_ideas.idea_type (environments map to null). */
export const INTENT_MAP_IDEA_TYPE: Record<string, CommercialIntent | null> = {
  sampling: "sampling",
  retail: "placement",
  events: "event_participation",
  partnerships: "collaboration",
  content: "content",
  sponsorship: "sponsorship",
  residential: null,
  workplace: null,
  hospitality: null,
  wellness: null,
  campus: null,
  other: null,
};
