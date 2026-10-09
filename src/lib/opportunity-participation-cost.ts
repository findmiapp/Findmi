// Opportunities — Participation Cost Explore Semantics (Pass 3).
//
// THE one place "does this listing fit within a Business's chosen
// Participation Cost ceiling" is decided — for both legacy-unclassified
// listings (zero opportunity_options rows, still only pricing_mode/
// price_cents) and structured listings (>=1 Option). Locked rule, never
// relaxed here: ONLY participation_fee ever counts as "what the Business
// pays to participate" — compensation, project_budget, and estimated
// In-Kind value are never inspected, regardless of amount.
//
// Model: a BUDGET CAP, not a discrete price band. The Business's question
// is "what's financially realistic for me to participate in at or under
// $X" — not "which exact price bucket does one stored number fall into."
// This resolves the Starting At / Range ambiguity with a single rule
// instead of per-shape special-casing: every Participation Fee shape has
// a FLOOR (Fixed -> the amount itself; Starting At -> its floor; Range ->
// the range minimum), and a listing matches a selected cap iff
// floor <= cap. Undisclosed has no floor and never matches a numeric cap.
//
// No imports on purpose: safe for server and client code, testable
// directly (tests/opportunity-participation-cost.test.mjs). Component/
// Option/legacy-pricing shapes are duck-typed below rather than imported
// from opportunity-commercial-terms-domain.ts / opportunity-listings-
// domain.ts — the same "small, scoped duplication" convention already
// established by opportunity-commercial-terms-bridge.ts, chosen here so
// this exact-semantics-critical predicate stays directly unit-testable
// with real assertions, not just static source guards.

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

// ---------------------------------------------------------------- filter values

/** "Any Participation Cost" is the UI's default/no-filter state — it is
 * deliberately NOT a member of this list (an unfiltered Explore legitimately
 * includes Participation Fee, Complimentary, Compensation, Project Budget,
 * Custom, In-Kind-only, and Undisclosed listings alike; "any" is the
 * absence of a filter, never a semantic claim that a Participation Fee
 * exists). `complimentary` matches only a listing whose relevant
 * commercial semantics are genuinely Complimentary — it is never
 * auto-included in a numeric cap search. */
export const PARTICIPATION_COST_FILTERS = ["complimentary", "up_to_500", "up_to_1000", "up_to_2500"] as const;
export type ParticipationCostFilter = (typeof PARTICIPATION_COST_FILTERS)[number];
export const isParticipationCostFilter = isOneOf(PARTICIPATION_COST_FILTERS);

export const PARTICIPATION_COST_FILTER_LABELS: Record<ParticipationCostFilter, string> = {
  complimentary: "Free to Participate",
  up_to_500: "Up to $500",
  up_to_1000: "Up to $1,000",
  up_to_2500: "Up to $2,500",
};

const CAP_CENTS: Partial<Record<ParticipationCostFilter, number>> = {
  up_to_500: 50_000,
  up_to_1000: 100_000,
  up_to_2500: 250_000,
};

// ---------------------------------------------------------------- shapes (duck-typed, no import)

interface ParticipationFeeComponent {
  component_type: string;
  amount_mode: string | null;
  amount_min_cents: number | null;
}

interface StructuredOption {
  commercial_mode: string;
  components: readonly ParticipationFeeComponent[];
}

interface LegacyPricing {
  pricing_mode: string;
  price_cents: number | null;
}

/** One Option's Participation Fee floor, or null when it has none / its
 * amount has no comparable floor (Undisclosed) / it isn't a qualifying
 * monetary term at all. Never reads compensation/project_budget. */
function participationFeeFloor(option: StructuredOption): number | null {
  if (option.commercial_mode !== "structured") return null;
  const fee = option.components.find((c) => c.component_type === "participation_fee");
  if (!fee) return null;
  if (fee.amount_mode === "undisclosed" || fee.amount_mode == null) return null;
  return fee.amount_min_cents;
}

/** THE Participation Cost filter predicate. `options` is the listing's
 * real Option rows — pass an empty array for a legacy-unclassified
 * listing (zero opportunity_options rows), which then falls back to its
 * own pricing_mode/price_cents, read with the exact same floor/cap rule
 * (legacy 'fixed'/'starting_at' has always meant "what the Business
 * pays" — the original, pre-Option system's own sole meaning — so this is
 * not a new assumption, just the same rule applied to the one column
 * pair legacy data has). `filter` null/undefined means "Any Participation
 * Cost" — no commercial filtering occurs at all. */
export function matchesParticipationCost(
  filter: ParticipationCostFilter | null | undefined,
  legacy: LegacyPricing,
  options: readonly StructuredOption[]
): boolean {
  if (!filter) return true;

  if (filter === "complimentary") {
    if (options.length > 0) return options.some((o) => o.commercial_mode === "complimentary");
    return legacy.pricing_mode === "complimentary";
  }

  const cap = CAP_CENTS[filter];
  if (cap == null) return false;

  if (options.length > 0) {
    return options.some((o) => {
      const floor = participationFeeFloor(o);
      return floor != null && floor <= cap;
    });
  }

  if (legacy.pricing_mode !== "fixed" && legacy.pricing_mode !== "starting_at") return false;
  return legacy.price_cents != null && legacy.price_cents <= cap;
}
