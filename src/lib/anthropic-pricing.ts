import type Anthropic from "@anthropic-ai/sdk";

/** Brand Builder AI cost TELEMETRY (not billing). One central table of
 * Anthropic first-party API list prices, keyed by the EXACT model id that
 * Anthropic returns in `response.model`. Anything not listed here — an
 * `ANTHROPIC_BRAND_MODEL` override, a dated variant, a new model — gets
 * `null`, never a guessed cost.
 *
 * Pricing basis (USD per million tokens), verified 2026-10-11 against
 * https://platform.claude.com/docs/en/about-claude/pricing (Model pricing
 * table, "Claude Opus 5" row):
 *   base input $5 · 5m cache writes $6.25 · 1h cache writes $10 ·
 *   cache hits and refreshes $0.50 · output $25.
 * Claude 4.6+ bills the full context window at standard rates (no
 * long-context surcharge). Not modelled, so they yield `null`: US-only
 * inference (`inference_geo` other than global, 1.1×), Batch/Priority
 * service tiers, and cache writes without a 5m/1h breakdown. */
interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
}

export const ANTHROPIC_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheWrite5mPerMTok: 6.25, cacheWrite1hPerMTok: 10, cacheReadPerMTok: 0.5 },
};

/** The usage fields the estimate reads (a subset of the SDK's `Usage`). */
export type AnthropicUsageForCost = Pick<Anthropic.Messages.Usage, "input_tokens" | "output_tokens"> &
  Partial<Pick<Anthropic.Messages.Usage, "cache_creation_input_tokens" | "cache_read_input_tokens" | "cache_creation" | "inference_geo" | "service_tier">>;

const count = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);

/** Estimated USD cost of ONE Messages API response, rounded to 1e-6, or
 * null when the model or any billed token class can't be priced exactly. */
export function estimateAnthropicCostUsd(model: string, usage: AnthropicUsageForCost): number | null {
  const price = Object.hasOwn(ANTHROPIC_PRICING, model) ? ANTHROPIC_PRICING[model] : null;
  if (!price) return null;
  if (usage.service_tier != null && usage.service_tier !== "standard") return null;
  if (usage.inference_geo != null && usage.inference_geo !== "global") return null;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  if (input === null || output === null) return null;
  const read = count(usage.cache_read_input_tokens ?? 0);
  const written = count(usage.cache_creation_input_tokens ?? 0);
  if (read === null || written === null) return null;
  let write5m = 0;
  let write1h = 0;
  if (written > 0) {
    const w5 = count(usage.cache_creation?.ephemeral_5m_input_tokens);
    const w1 = count(usage.cache_creation?.ephemeral_1h_input_tokens);
    if (w5 === null || w1 === null || w5 + w1 !== written) return null;
    write5m = w5;
    write1h = w1;
  }
  const usd =
    (input * price.inputPerMTok +
      output * price.outputPerMTok +
      read * price.cacheReadPerMTok +
      write5m * price.cacheWrite5mPerMTok +
      write1h * price.cacheWrite1hPerMTok) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
