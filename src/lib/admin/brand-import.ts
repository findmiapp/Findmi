import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { findBusinessMatches, type BusinessMatch, type BusinessMatchInput } from "../business-matching";
import {
  buildCandidateFromExtraction,
  fetchBrandWebsite,
  prepareBrandWebsite,
  type BrandAiActivity,
  type BrandCandidateDeps,
  type BrandCandidateProposal,
} from "../brand-candidate-builder";
import { safeFetchHtml, type SafeFetchResult } from "../safe-fetch";
import { enrichBrandWithAi } from "../brand-ai-enrichment";
import { fetchVerifiedBrandImage } from "../brand-images";

/** Brand Ingestion P3 — Admin bulk Brand Import: batch creation and
 * one-candidate-at-a-time processing over the P2 tables
 * (brand_import_batches / brand_import_candidates), using the P1 shared
 * Brand candidate core. Admin-only and server-only: callers MUST have
 * passed requireAdminSupabase() and pass its service-role client in.
 *
 * Never writes canonical data. It READS businesses (matching) and writes
 * only the two import tables. No Business insert/update/delete, no
 * membership, no market, no media storage — candidate images are fetched
 * and verified (as the public flow does) but never stored. */

export const BRAND_IMPORT_MAX_INPUTS = 20;
export const BRAND_IMPORT_INPUT_MAX_CHARS = 200;
/** A `processing` claim older than this is considered abandoned (the
 * request that held it has long hit maxDuration). */
export const BRAND_IMPORT_LEASE_MS = 2 * 60 * 1000;
/** At most this many fresh `processing` candidates at once, globally. */
export const BRAND_IMPORT_MAX_FRESH_PROCESSING = 3;
/** No candidate is processed more than this many times. */
export const BRAND_IMPORT_MAX_ATTEMPTS = 5;

export const BRAND_IMPORT_STATUSES = [
  "queued",
  "processing",
  "ready",
  "existing_business",
  "failed",
  "creating",
  "created",
  "discarded",
] as const;
export type BrandImportStatus = (typeof BRAND_IMPORT_STATUSES)[number];

// ── Batch creation ────────────────────────────────────────────────────────

export interface PlannedCandidate {
  position: number;
  submitted_input: string;
  normalized_host: string | null;
  status: "queued" | "failed";
  failure_code: "invalid_input" | "unsupported_site" | null;
}

export type BrandImportPlan =
  | { ok: true; candidates: PlannedCandidate[]; duplicatesSkipped: number }
  | { ok: false; error: "empty" | "too_many" };

/** Pure: pasted text → the rows to persist. Lines are trimmed, blank lines
 * dropped, order preserved; at most 20 usable lines. Each line goes
 * through the same website classification/normalization as the public
 * Brand Builder (prepareBrandWebsite). Unusable lines are kept as
 * `failed` with a safe code; a website whose normalized host already
 * appeared in THIS paste is skipped (not a failure). */
export function planBrandImport(text: string): BrandImportPlan {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, error: "empty" };
  if (lines.length > BRAND_IMPORT_MAX_INPUTS) return { ok: false, error: "too_many" };
  const seen = new Set<string>();
  const candidates: PlannedCandidate[] = [];
  let duplicatesSkipped = 0;
  for (const line of lines) {
    const submitted = line.slice(0, BRAND_IMPORT_INPUT_MAX_CHARS);
    const prepared = line.length > BRAND_IMPORT_INPUT_MAX_CHARS ? null : prepareBrandWebsite(line);
    if (prepared?.ok) {
      if (seen.has(prepared.website.host)) {
        duplicatesSkipped += 1;
        continue;
      }
      seen.add(prepared.website.host);
      candidates.push({ position: candidates.length + 1, submitted_input: submitted, normalized_host: prepared.website.host, status: "queued", failure_code: null });
    } else {
      const code = prepared && !prepared.ok ? prepared.code : "invalid_input";
      candidates.push({ position: candidates.length + 1, submitted_input: submitted, normalized_host: null, status: "failed", failure_code: code });
    }
  }
  return { ok: true, candidates, duplicatesSkipped };
}

// ── Proposal (the reviewable candidate) ───────────────────────────────────

const httpsUrl = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    });

/** The persisted proposal: the Review Your Brand draft's fields and bounds
 * (lib/brand-draft.ts), plus the post-redirect URL. `.strict()` — nothing
 * else (no HTML, page text, prompt, AI output beyond the sanitized
 * fields, IPs or secrets) can be stored. Validated before every write. */
export const BrandImportProposalSchema = z
  .object({
    site: z
      .string()
      .max(300)
      .refine((v) => {
        try {
          const u = new URL(v);
          return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
        } catch {
          return false;
        }
      }),
    finalUrl: httpsUrl(2048),
    name: z.string().min(1).max(200).optional(),
    cat: z.string().uuid().optional(),
    sd: z.string().min(1).max(160).optional(),
    about: z.string().min(1).max(600).optional(),
    ig: z.string().regex(/^[a-z0-9._]{1,30}$/).optional(),
    city: z.string().min(1).max(80).optional(),
    state: z.string().min(1).max(40).optional(),
    logo: httpsUrl(512).optional(),
    cover: httpsUrl(512).optional(),
  })
  .strict();

export type BrandImportProposal = z.infer<typeof BrandImportProposalSchema>;

/** P1 candidate → stored proposal (nulls omitted). Over-long image URLs
 * are dropped (as the draft does) rather than failing the candidate. */
export function toBrandImportProposal(p: BrandCandidateProposal): BrandImportProposal | null {
  const raw: Record<string, string> = { site: p.websiteUrl, finalUrl: p.finalUrl };
  const put = (key: string, value: string | null) => {
    if (value) raw[key] = value;
  };
  put("name", p.name);
  put("cat", p.categoryId);
  put("sd", p.shortDescription);
  put("about", p.about);
  put("ig", p.instagramHandle);
  put("city", p.city);
  put("state", p.state);
  put("logo", p.logoUrl && p.logoUrl.length <= 512 ? p.logoUrl : null);
  put("cover", p.coverUrl && p.coverUrl.length <= 512 ? p.coverUrl : null);
  const parsed = BrandImportProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Reads a stored proposal back — untrusted until it parses. */
export function parseBrandImportProposal(value: unknown): BrandImportProposal | null {
  const parsed = BrandImportProposalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ── AI usage accumulation ─────────────────────────────────────────────────

export interface BrandImportAiColumns {
  ai_status: "used" | "skipped" | "failed" | null;
  ai_model: string | null;
  ai_input_tokens: number | null;
  ai_output_tokens: number | null;
  ai_cache_creation_input_tokens: number | null;
  ai_cache_read_input_tokens: number | null;
  ai_estimated_cost_usd: number | null;
}

const addKnown = (a: number | null, b: number | null): number | null => (b == null ? a : (a ?? 0) + b);

/** Only the AI columns of a candidate row. */
export function aiColumnsOf(row: BrandImportAiColumns): BrandImportAiColumns {
  return {
    ai_status: row.ai_status,
    ai_model: row.ai_model,
    ai_input_tokens: row.ai_input_tokens,
    ai_output_tokens: row.ai_output_tokens,
    ai_cache_creation_input_tokens: row.ai_cache_creation_input_tokens,
    ai_cache_read_input_tokens: row.ai_cache_read_input_tokens,
    ai_estimated_cost_usd: row.ai_estimated_cost_usd,
  };
}

/** Semantics (documented and tested):
 *   - ai_status: the latest attempt that reached the AI decision.
 *   - ai_model: the model of the latest attempt that got an Anthropic
 *     response; unchanged otherwise.
 *   - token counts and cost: the SUM of actual usage across attempts.
 *     Only a request actually sent to Anthropic (`called`) with a usage
 *     response adds anything; a skipped, reused or no-response attempt
 *     adds nothing (never a fabricated zero). A null field (unknown cache
 *     tokens, an unpriced model's cost) adds nothing to that field, so
 *     the cost is the sum of KNOWN estimates. */
export function accumulateAiUsage(current: BrandImportAiColumns, ai: BrandAiActivity): BrandImportAiColumns {
  const next: BrandImportAiColumns = { ...aiColumnsOf(current), ai_status: ai.status };
  if (!ai.called || ai.reused || !ai.usage) return next;
  const u = ai.usage;
  const cost = addKnown(current.ai_estimated_cost_usd, u.estimatedCostUsd);
  return {
    ...next,
    ai_model: u.model,
    ai_input_tokens: addKnown(current.ai_input_tokens, u.inputTokens),
    ai_output_tokens: addKnown(current.ai_output_tokens, u.outputTokens),
    ai_cache_creation_input_tokens: addKnown(current.ai_cache_creation_input_tokens, u.cacheCreationInputTokens),
    ai_cache_read_input_tokens: addKnown(current.ai_cache_read_input_tokens, u.cacheReadInputTokens),
    ai_estimated_cost_usd: cost == null ? null : Math.round(cost * 1_000_000) / 1_000_000,
  };
}

// ── Store (the two P2 tables) ─────────────────────────────────────────────

export interface BrandImportCandidateRow extends BrandImportAiColumns {
  id: string;
  batch_id: string;
  status: BrandImportStatus;
  attempt_count: number;
  processing_started_at: string | null;
  submitted_input: string;
  normalized_host: string | null;
}

/** Fields a processing attempt may finish with. */
export type BrandImportFinishPatch = Partial<BrandImportAiColumns> & {
  status: "ready" | "existing_business" | "failed";
  failure_code: string | null;
  proposal: BrandImportProposal | null;
  matched_business_id: string | null;
  processing_started_at: null;
};

export interface BrandImportStore {
  /** Inserts the batch and its candidates (removing the batch again if the
   * candidates can't be written). */
  createBatch(candidates: PlannedCandidate[]): Promise<string>;
  getCandidate(id: string): Promise<BrandImportCandidateRow | null>;
  /** `processing` candidates whose lease started at/after `freshSinceIso`. */
  countFreshProcessing(freshSinceIso: string): Promise<number>;
  /** Atomically claims the candidate for attempt `expectedAttempts + 1`:
   * only if attempt_count is still `expectedAttempts` AND it is queued,
   * failed, or processing with a lease older than `staleBeforeIso`. */
  claim(id: string, expectedAttempts: number, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  /** Writes an attempt's result — only while that attempt still owns the
   * candidate (status processing, attempt_count unchanged). */
  finish(id: string, attempt: number, patch: BrandImportFinishPatch): Promise<boolean>;
}

const CANDIDATE_COLUMNS =
  "id, batch_id, status, attempt_count, processing_started_at, submitted_input, normalized_host, ai_status, ai_model, ai_input_tokens, ai_output_tokens, ai_cache_creation_input_tokens, ai_cache_read_input_tokens, ai_estimated_cost_usd";

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** The real store over the service-role client (Admin-only callers). */
export function supabaseBrandImportStore(admin: SupabaseClient): BrandImportStore {
  return {
    async createBatch(candidates) {
      const { data: batch, error } = await admin
        .from("brand_import_batches")
        .insert({ submitted_count: candidates.length })
        .select("id")
        .single();
      if (error || !batch) throw new Error("brand_import_batch_insert_failed");
      const batchId = (batch as { id: string }).id;
      const { error: rowsError } = await admin
        .from("brand_import_candidates")
        .insert(candidates.map((c) => ({ ...c, batch_id: batchId })));
      if (rowsError) {
        await admin.from("brand_import_batches").delete().eq("id", batchId);
        throw new Error("brand_import_candidates_insert_failed");
      }
      return batchId;
    },
    async getCandidate(id) {
      const { data } = await admin.from("brand_import_candidates").select(CANDIDATE_COLUMNS).eq("id", id).maybeSingle();
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        ...(row as unknown as BrandImportCandidateRow),
        ai_input_tokens: numOrNull(row.ai_input_tokens),
        ai_output_tokens: numOrNull(row.ai_output_tokens),
        ai_cache_creation_input_tokens: numOrNull(row.ai_cache_creation_input_tokens),
        ai_cache_read_input_tokens: numOrNull(row.ai_cache_read_input_tokens),
        ai_estimated_cost_usd: numOrNull(row.ai_estimated_cost_usd),
      };
    },
    async countFreshProcessing(freshSinceIso) {
      const { count, error } = await admin
        .from("brand_import_candidates")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .gte("processing_started_at", freshSinceIso);
      if (error) throw new Error("brand_import_count_failed");
      return count ?? 0;
    },
    async claim(id, expectedAttempts, nowIso, staleBeforeIso) {
      const { data, error } = await admin
        .from("brand_import_candidates")
        .update({ status: "processing", processing_started_at: nowIso, attempt_count: expectedAttempts + 1 })
        .eq("id", id)
        .eq("attempt_count", expectedAttempts)
        .or(`status.in.(queued,failed),and(status.eq.processing,processing_started_at.lt."${staleBeforeIso}")`)
        .select("id");
      if (error) throw new Error("brand_import_claim_failed");
      return (data ?? []).length === 1;
    },
    async finish(id, attempt, patch) {
      const { data, error } = await admin
        .from("brand_import_candidates")
        .update(patch)
        .eq("id", id)
        .eq("attempt_count", attempt)
        .eq("status", "processing")
        .select("id");
      if (error) throw new Error("brand_import_finish_failed");
      return (data ?? []).length === 1;
    },
  };
}

// ── Processing one candidate ──────────────────────────────────────────────

export interface BrandImportEngineDeps extends BrandCandidateDeps {
  fetchHtml: (url: URL) => Promise<SafeFetchResult>;
}

export interface BrandImportProcessDeps {
  store: BrandImportStore;
  engine: BrandImportEngineDeps;
  now: () => number;
  log: (entry: BrandImportLog) => void;
}

export type BrandImportProcessOutcome =
  /** This request processed the candidate; `status` is its new state. */
  | { outcome: "processed"; status: "ready" | "existing_business" | "failed" }
  /** Global processing limit reached — try again shortly. */
  | { outcome: "busy" }
  /** Not queued/failed/expired, attempt limit reached, or another request
   * claimed it first. */
  | { outcome: "not_eligible" }
  /** The attempt's lease was taken over before it finished (result discarded). */
  | { outcome: "lease_lost" }
  | { outcome: "not_found" };

/** Safe operational log: host, codes, counts and timings only — never
 * input text, URLs, HTML, proposals, prompts, error messages or ids. */
export interface BrandImportLog {
  event: "brand_import_candidate";
  outcome: BrandImportProcessOutcome["outcome"];
  status: string | null;
  failure: string | null;
  host: string | null;
  attempt: number | null;
  ms: number;
  aiCalled: boolean | null;
  aiModel: string | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  aiEstimatedCostUsd: number | null;
  errorType: string | null;
}

/** A candidate this request may claim right now (before the global guard). */
export function isClaimable(row: Pick<BrandImportCandidateRow, "status" | "attempt_count" | "processing_started_at">, nowMs: number): boolean {
  if (row.attempt_count >= BRAND_IMPORT_MAX_ATTEMPTS) return false;
  if (row.status === "queued" || row.status === "failed") return true;
  if (row.status !== "processing") return false;
  const started = row.processing_started_at ? Date.parse(row.processing_started_at) : NaN;
  return !Number.isFinite(started) || nowMs - started >= BRAND_IMPORT_LEASE_MS;
}

/** Claims and processes ONE candidate. Never throws for a processing
 * failure (→ failed/internal_error); store errors before the claim
 * propagate to the caller. */
export async function processBrandImportCandidate(id: string, deps: BrandImportProcessDeps): Promise<BrandImportProcessOutcome> {
  const started = deps.now();
  const log = (outcome: BrandImportProcessOutcome["outcome"], extra: Partial<BrandImportLog> = {}) =>
    deps.log({
      event: "brand_import_candidate",
      outcome,
      status: null,
      failure: null,
      host: null,
      attempt: null,
      aiCalled: null,
      aiModel: null,
      aiInputTokens: null,
      aiOutputTokens: null,
      aiEstimatedCostUsd: null,
      errorType: null,
      ...extra,
      ms: deps.now() - started,
    });

  const row = await deps.store.getCandidate(id);
  if (!row) return { outcome: "not_found" };
  const nowMs = deps.now();
  if (!isClaimable(row, nowMs)) return { outcome: "not_eligible" };
  const staleBefore = new Date(nowMs - BRAND_IMPORT_LEASE_MS).toISOString();
  if ((await deps.store.countFreshProcessing(staleBefore)) >= BRAND_IMPORT_MAX_FRESH_PROCESSING) {
    log("busy", { host: row.normalized_host });
    return { outcome: "busy" };
  }
  if (!(await deps.store.claim(id, row.attempt_count, new Date(nowMs).toISOString(), staleBefore))) {
    return { outcome: "not_eligible" };
  }
  const attempt = row.attempt_count + 1;
  const host = row.normalized_host;

  let patch: BrandImportFinishPatch;
  let aiActivity: BrandAiActivity | null = null;
  let errorType: string | null = null;
  const failed = (code: string): BrandImportFinishPatch => ({
    status: "failed",
    failure_code: code,
    proposal: null,
    matched_business_id: null,
    processing_started_at: null,
  });
  try {
    patch = await runCandidate(row, deps.engine, (ai) => (aiActivity = ai));
  } catch (err) {
    // Never persisted or logged: the message (it may contain URLs or page
    // text). Only the error's class name goes to the log.
    errorType = err instanceof Error ? err.name.slice(0, 40) : "unknown";
    patch = failed("internal_error");
  }
  const activity = aiActivity as BrandAiActivity | null;
  if (activity) patch = { ...patch, ...accumulateAiUsage(aiColumnsOf(row), activity) };

  const written = await deps.store.finish(id, attempt, patch);
  const usage = activity?.called ? activity.usage : null;
  log(written ? "processed" : "lease_lost", {
    status: patch.status,
    failure: patch.failure_code,
    host,
    attempt,
    aiCalled: activity ? activity.called : null,
    aiModel: usage?.model ?? null,
    aiInputTokens: usage?.inputTokens ?? null,
    aiOutputTokens: usage?.outputTokens ?? null,
    aiEstimatedCostUsd: usage?.estimatedCostUsd ?? null,
    errorType,
  });
  return written ? { outcome: "processed", status: patch.status } : { outcome: "lease_lost" };
}

/** Match first, then the P1 core. Returns the patch for this attempt. */
async function runCandidate(
  row: BrandImportCandidateRow,
  engine: BrandImportEngineDeps,
  onAi: (ai: BrandAiActivity) => void
): Promise<BrandImportFinishPatch> {
  const base = { proposal: null, matched_business_id: null, processing_started_at: null } as const;
  const prepared = prepareBrandWebsite(row.submitted_input);
  if (!prepared.ok) return { ...base, status: "failed", failure_code: prepared.code };
  const { website } = prepared;

  // MATCH FIRST (Admin): an existing Business with this website identity
  // ends processing here — no website fetch, no AI, no image fetch.
  // Admin sees the match regardless of publication status.
  const websiteMatches = (await engine.findMatches({ websiteUrl: website.websiteUrl })).filter((m) => m.reasons.includes("website"));
  if (websiteMatches.length > 0) {
    return { ...base, status: "existing_business", failure_code: null, matched_business_id: websiteMatches[0].id };
  }

  const fetched = await fetchBrandWebsite(website.fetchUrl, engine);
  if (!fetched.ok) return { ...base, status: "failed", failure_code: fetched.code };

  // The P1 core: the same matching safeguards (Instagram, name+location,
  // redirect host), the CURRENT AI decision/enrichment and image checks.
  const built = await buildCandidateFromExtraction(website, fetched.extraction, engine, { verifyImages: true });
  if (built.status === "failed") return { ...base, status: "failed", failure_code: built.code };
  if (built.status === "matched") {
    const match: BusinessMatch = built.publicMatch ?? built.matches[0];
    return { ...base, status: "existing_business", failure_code: null, matched_business_id: match.id };
  }
  onAi(built.ai);
  const proposal = toBrandImportProposal(built.proposal);
  if (!proposal) return { ...base, status: "failed", failure_code: "invalid_proposal" };
  return { ...base, status: "ready", failure_code: null, proposal };
}

/** Real engine dependencies over the service-role client. Business
 * access is read-only (the matcher's SELECT). */
export function defaultBrandImportEngine(
  admin: SupabaseClient,
  listCategories: () => Promise<{ id: string; slug: string; name: string }[]>
): BrandImportEngineDeps {
  return {
    fetchHtml: (url) => safeFetchHtml(url),
    findMatches: (input: BusinessMatchInput) => findBusinessMatches(admin, input),
    listCategories,
    enrich: (input) => enrichBrandWithAi(input),
    verifyImage: async (url, role) => (await fetchVerifiedBrandImage(url, role)).ok,
  };
}

// ── Read models for the Admin pages (read-only) ───────────────────────────

export interface BrandImportCandidateView {
  id: string;
  position: number;
  submittedInput: string;
  normalizedHost: string | null;
  status: BrandImportStatus;
  failureCode: string | null;
  attemptCount: number;
  processingStartedAt: string | null;
  proposal: BrandImportProposal | null;
  matchedBusiness: { id: string; name: string } | null;
  aiStatus: "used" | "skipped" | "failed" | null;
  aiModel: string | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  aiCacheCreationInputTokens: number | null;
  aiCacheReadInputTokens: number | null;
  aiEstimatedCostUsd: number | null;
}

const VIEW_COLUMNS =
  "id, batch_id, position, submitted_input, normalized_host, status, failure_code, attempt_count, processing_started_at, proposal, matched_business_id, ai_status, ai_model, ai_input_tokens, ai_output_tokens, ai_cache_creation_input_tokens, ai_cache_read_input_tokens, ai_estimated_cost_usd";

async function toViews(admin: SupabaseClient, rows: Record<string, unknown>[]): Promise<BrandImportCandidateView[]> {
  const matchedIds = [...new Set(rows.map((r) => r.matched_business_id).filter((v): v is string => typeof v === "string"))];
  const names = new Map<string, string>();
  if (matchedIds.length > 0) {
    // Read-only lookup of the matched Businesses' names (Admin sees all).
    const { data } = await admin.from("businesses").select("id, name").in("id", matchedIds);
    for (const b of (data ?? []) as { id: string; name: string }[]) names.set(b.id, b.name);
  }
  return rows.map((r) => {
    const matchedId = typeof r.matched_business_id === "string" ? r.matched_business_id : null;
    return {
      id: String(r.id),
      position: Number(r.position),
      submittedInput: String(r.submitted_input),
      normalizedHost: (r.normalized_host as string | null) ?? null,
      status: r.status as BrandImportStatus,
      failureCode: (r.failure_code as string | null) ?? null,
      attemptCount: Number(r.attempt_count),
      processingStartedAt: (r.processing_started_at as string | null) ?? null,
      proposal: r.proposal == null ? null : parseBrandImportProposal(r.proposal),
      matchedBusiness: matchedId ? { id: matchedId, name: names.get(matchedId) ?? "Business" } : null,
      aiStatus: (r.ai_status as BrandImportCandidateView["aiStatus"]) ?? null,
      aiModel: (r.ai_model as string | null) ?? null,
      aiInputTokens: numOrNull(r.ai_input_tokens),
      aiOutputTokens: numOrNull(r.ai_output_tokens),
      aiCacheCreationInputTokens: numOrNull(r.ai_cache_creation_input_tokens),
      aiCacheReadInputTokens: numOrNull(r.ai_cache_read_input_tokens),
      aiEstimatedCostUsd: numOrNull(r.ai_estimated_cost_usd),
    };
  });
}

/** A read-model query FAILED (as opposed to legitimately finding no row).
 * Thrown so the page shows an error state, never a misleading 404; the
 * message is generic — no database detail reaches the browser. */
export class BrandImportLoadError extends Error {
  readonly target: "batch" | "batch_candidates" | "candidate";
  readonly code: string | null;
  constructor(target: BrandImportLoadError["target"], code: string | null) {
    super("brand_import_load_failed");
    this.name = "BrandImportLoadError";
    this.target = target;
    this.code = code;
  }
}

/** Logs the failure safely (target + PostgREST error code only — never
 * the message, ids or values) and throws. */
function loadFailed(target: BrandImportLoadError["target"], error: { code?: unknown } | null): never {
  const code = typeof error?.code === "string" ? error.code.slice(0, 16) : null;
  console.error(JSON.stringify({ event: "brand_import_load", outcome: "query_failed", target, code }));
  throw new BrandImportLoadError(target, code);
}

export async function loadBrandImportBatch(
  admin: SupabaseClient,
  batchId: string
): Promise<{ id: string; createdAt: string; submittedCount: number; candidates: BrandImportCandidateView[] } | null> {
  const { data: batch, error: batchError } = await admin.from("brand_import_batches").select("id, created_at, submitted_count").eq("id", batchId).maybeSingle();
  if (batchError) loadFailed("batch", batchError);
  if (!batch) return null;
  const { data: rows, error: rowsError } = await admin.from("brand_import_candidates").select(VIEW_COLUMNS).eq("batch_id", batchId).order("position");
  if (rowsError) loadFailed("batch_candidates", rowsError);
  const b = batch as { id: string; created_at: string; submitted_count: number };
  return { id: b.id, createdAt: b.created_at, submittedCount: b.submitted_count, candidates: await toViews(admin, (rows ?? []) as Record<string, unknown>[]) };
}

export async function loadBrandImportCandidate(
  admin: SupabaseClient,
  batchId: string,
  candidateId: string
): Promise<BrandImportCandidateView | null> {
  // Scoped to the requested batch: a candidate from another batch is
  // "not found" exactly like a nonexistent one. A failed query throws.
  const { data, error } = await admin.from("brand_import_candidates").select(VIEW_COLUMNS).eq("id", candidateId).eq("batch_id", batchId).maybeSingle();
  if (error) loadFailed("candidate", error);
  if (!data) return null;
  return (await toViews(admin, [data as Record<string, unknown>]))[0];
}

export async function listRecentBrandImportBatches(
  admin: SupabaseClient,
  limit = 10
): Promise<{ id: string; createdAt: string; submittedCount: number; counts: Partial<Record<BrandImportStatus, number>> }[]> {
  const { data: batches } = await admin.from("brand_import_batches").select("id, created_at, submitted_count").order("created_at", { ascending: false }).limit(limit);
  const list = (batches ?? []) as { id: string; created_at: string; submitted_count: number }[];
  if (list.length === 0) return [];
  const { data: rows } = await admin.from("brand_import_candidates").select("batch_id, status").in("batch_id", list.map((b) => b.id));
  const counts = new Map<string, Partial<Record<BrandImportStatus, number>>>();
  for (const r of (rows ?? []) as { batch_id: string; status: BrandImportStatus }[]) {
    const c = counts.get(r.batch_id) ?? {};
    c[r.status] = (c[r.status] ?? 0) + 1;
    counts.set(r.batch_id, c);
  }
  return list.map((b) => ({ id: b.id, createdAt: b.created_at, submittedCount: b.submitted_count, counts: counts.get(b.id) ?? {} }));
}
