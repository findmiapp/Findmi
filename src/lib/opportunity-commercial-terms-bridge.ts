// Opportunities — Commercial Terms Admin Builder (Pass 2): the small,
// dependency-free glue between the Pass 1 Option/Component domain module
// (src/lib/opportunity-commercial-terms-domain.ts) and two things that
// stay OUTSIDE that module on purpose:
//
//   1. projectSafeLegacyPricing() — a SAFE, TEMPORARY COMPATIBILITY
//      PROJECTION onto the legacy pricing_mode/price_cents/currency
//      columns. This is NOT "derive the real Commercial Terms" — the
//      Option/Component rows ARE that, and remain the source of truth.
//      It exists only because the still-legacy Business-facing
//      presentation (OpportunityAsideSections/OpportunityFacts/
//      BusinessOpportunityCard, via opportunityPriceParts/
//      formatOpportunityPrice in src/lib/opportunity-listings-domain.ts —
//      the ONLY two functions that ever read these columns for display)
//      is NOT touched until Pass 3, and still only knows how to render
//      those legacy columns under a single, directionless "Investment"
//      label.
//
//      Correction (Pass 2 review): an earlier version of this function
//      projected the FIRST authored Option's raw amount, regardless of
//      its commercial direction. That is unsafe — legacy's "Investment"
//      framing has only ever meant "what the Business pays"
//      (Participation Fee). Projecting Compensation or Project Budget the
//      same way would show a Business "$1,500 · Fixed" under "Investment"
//      for money THEY receive, or a budget figure that isn't a payment at
//      all — materially misleading. Multiple Options were also flattened
//      by picking whichever happened to be first, which has no commercial
//      meaning. projectSafeLegacyPricing() below replaces that: it only
//      ever writes an amount when doing so cannot misrepresent direction
//      or hide a second Option's different terms (see its own doc for the
//      exact rule); everything else gets the neutral legacy 'custom'
//      state ("Contact Findmi") rather than a guess. THE INVARIANT: better
//      to show no price than the wrong one.
//
//   2. Legacy-Opportunity CLASSIFICATION — the opposite direction. An
//      Opportunity authored before this pass has zero opportunity_options
//      rows and an ambiguous legacy pricing_mode/price_cents (e.g. the real
//      "Tabli Resident Demo $750 fixed" listing: is that $750 a
//      Participation Fee, Compensation, or Project Budget? Nothing in the
//      legacy row says). isLegacyUnclassified() below is the one place
//      that question is asked; nothing here ever guesses the answer, and
//      the Admin Server Actions (actions.ts) never touch an unclassified
//      listing's existing legacy pricing on an ordinary, unrelated edit —
//      see saveOpportunity's own comment on why.
//
// No imports on purpose: safe for server and client code, testable
// directly. Every function here is pure data shaping — none of it
// second-guesses or duplicates validateOption()/validateComponent() from
// the Pass 1 domain module; it only prepares that module's own output for
// the two concerns above.

// Deliberately NO import of opportunity-commercial-terms-domain.ts here —
// same "no imports on purpose" convention every other pure domain module
// in this codebase already follows (OptionFields/ComponentFields are
// structurally duck-typed below, not imported as a nominal type) —
// exactly the kind of small, scoped duplication already established
// elsewhere in this codebase, e.g. the Pro Access Request RPC's own
// comment on why it duplicates redeem_pro_invite()'s math instead of
// importing/refactoring it. This keeps every function below directly
// unit-testable with zero module-resolution concerns, and keeps this file
// safe for server and client code alike.

interface BridgeComponent {
  component_type: string;
  amount_mode: string | null;
  amount_min_cents: number | null;
  currency: string | null;
}

interface BridgeOption {
  commercial_mode: string;
  components: readonly BridgeComponent[];
}

// ---------------------------------------------------------------- legacy pricing bridge

export interface LegacyBridgePricing {
  pricing_mode: "fixed" | "starting_at" | "complimentary" | "custom";
  /** A dollar-amount string in the exact shape the legacy form/
   * validateListingInput's own "price" field already expects (so it can be
   * fed straight back through parsePriceToCents) — null when the legacy
   * pricing_mode carries no amount. */
  price: string | null;
  currency: string;
}

export function centsToDollarString(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

const NEUTRAL_LEGACY_PRICING: LegacyBridgePricing = { pricing_mode: "custom", price: null, currency: "USD" };

/** THE safe, temporary compatibility projection onto legacy pricing_mode/
 * price_cents/currency — see the top-of-file note for why this exists and
 * what it replaced. Never derives "the real Commercial Terms" (the Option/
 * Component rows already are that); only ever writes a legacy amount when
 * doing so is provably truthful under the CURRENT legacy "Investment"
 * rendering, which only ever means "what the Business pays" and only ever
 * shows ONE number with no sense of "or more, depending on which Option":
 *
 *   - EVERY Option Complimentary (any optional In-Kind on any of them
 *     doesn't change this) -> legacy 'complimentary'. Truthful regardless
 *     of count.
 *   - Otherwise, an amount is projected ONLY when EVERY Option is
 *     Structured with a Participation Fee component (never Compensation —
 *     the Business RECEIVES that, never Project Budget — a budget figure
 *     is not a payment), using Fixed or Starting At (never Range/
 *     Undisclosed, which have no single honest floor), in the SAME
 *     currency. The projected amount is the MINIMUM floor across every
 *     Option, surfaced as 'starting_at' whenever more than one Option
 *     exists (a true lower bound — never overclaiming one exact price
 *     when a different Option could cost more); a single Option keeps its
 *     own exact Fixed/Starting At shape. Array position/"first Option" is
 *     never used as the selector — every Option must independently
 *     qualify, or the whole projection falls through.
 *   - Everything else (In-Kind-only, Custom, a mix of Complimentary with
 *     something else, mixed monetary directions, mixed amount shapes,
 *     mixed currencies, or zero Options) -> the neutral legacy 'custom'
 *     state ("Contact Findmi"). Never a guess. */
export function projectSafeLegacyPricing(options: readonly BridgeOption[]): LegacyBridgePricing {
  if (options.length === 0) return NEUTRAL_LEGACY_PRICING;

  if (options.every((o) => o.commercial_mode === "complimentary")) {
    return { pricing_mode: "complimentary", price: null, currency: "USD" };
  }

  const floors: { cents: number; currency: string; mode: "fixed" | "starting_at" }[] = [];
  for (const o of options) {
    if (o.commercial_mode !== "structured") return NEUTRAL_LEGACY_PRICING;
    const fee = o.components.find((c) => c.component_type === "participation_fee");
    if (!fee) return NEUTRAL_LEGACY_PRICING;
    if (fee.amount_mode !== "fixed" && fee.amount_mode !== "starting_at") return NEUTRAL_LEGACY_PRICING;
    if (fee.amount_min_cents == null) return NEUTRAL_LEGACY_PRICING;
    floors.push({ cents: fee.amount_min_cents, currency: fee.currency ?? "USD", mode: fee.amount_mode });
  }

  const currency = floors[0].currency;
  if (!floors.every((f) => f.currency === currency)) return NEUTRAL_LEGACY_PRICING;

  const lowest = floors.reduce((min, f) => (f.cents < min.cents ? f : min));
  const singleExactFixed = floors.length === 1 && floors[0].mode === "fixed";
  return {
    pricing_mode: singleExactFixed ? "fixed" : "starting_at",
    price: centsToDollarString(lowest.cents),
    currency,
  };
}

// ---------------------------------------------------------------- legacy classification

/** THE rule for whether a listing still needs explicit Admin
 * classification into the new model: zero opportunity_options rows, full
 * stop. A listing's legacy pricing_mode (even 'complimentary' or 'custom')
 * is never read to infer this — only real Option rows count as
 * "classified". Never auto-true for a brand-new Opportunity created
 * through the new builder, which always writes >=1 Option in the same
 * save. */
export function isLegacyUnclassified(optionCount: number): boolean {
  return optionCount === 0;
}

/** The one default Option a brand-new Opportunity's builder starts from:
 * Structured, unnamed (meaningless to name a single configuration), no
 * Components yet. Saving with no Component added surfaces validateOption's
 * own friendly "needs a monetary term or a required In-Kind contribution"
 * message rather than silently defaulting to Complimentary — most
 * Opportunities are commercial, so Structured is the more honest default
 * starting point, not Complimentary. */
export function buildDefaultOption(): { name: null; description: null; commercial_mode: "structured"; custom_terms_note: null; components: [] } {
  return { name: null, description: null, commercial_mode: "structured", custom_terms_note: null, components: [] };
}

// ---------------------------------------------------------------- RPC payload shaping

interface PersistableComponent {
  component_type: string;
  amount_mode: string | null;
  amount_min_cents: number | null;
  amount_max_cents: number | null;
  currency: string | null;
  in_kind_category: string | null;
  in_kind_description: string | null;
  in_kind_provider: string | null;
  in_kind_required: boolean;
  estimated_value_cents: number | null;
}

/** Structurally compatible with OptionFields (src/lib/
 * opportunity-commercial-terms-domain.ts) + an `id` — deliberately not
 * imported as a nominal type (see the top-of-file note on why this module
 * has no imports); any validateOption() result is already assignable here
 * by shape. */
export interface OptionForPersistence {
  name: string | null;
  description: string | null;
  commercial_mode: string;
  custom_terms_note: string | null;
  components: readonly PersistableComponent[];
  /** The Option's existing DB id when editing an already-persisted Option
   * (preserves it across the edit); null for a new or duplicated Option,
   * which the RPC then inserts fresh. */
  id: string | null;
}

/** OptionFields (+ id) -> the exact jsonb shape
 * public.replace_opportunity_options expects. Pure reshaping only — every
 * value here already passed validateOption()/validateComponent(); this
 * function makes no decision of its own. */
export function toCommercialTermsRpcPayload(options: readonly OptionForPersistence[]): Record<string, unknown>[] {
  return options.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    commercial_mode: o.commercial_mode,
    custom_terms_note: o.custom_terms_note,
    components: o.components.map((c) => ({
      component_type: c.component_type,
      amount_mode: c.amount_mode,
      amount_min_cents: c.amount_min_cents,
      amount_max_cents: c.amount_max_cents,
      currency: c.currency,
      in_kind_category: c.in_kind_category,
      in_kind_description: c.in_kind_description,
      in_kind_provider: c.in_kind_provider,
      in_kind_required: c.in_kind_required,
      estimated_value_cents: c.estimated_value_cents,
    })),
  }));
}
