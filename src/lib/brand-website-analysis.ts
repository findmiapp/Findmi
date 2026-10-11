import "server-only";
import { getAdminSupabase } from "./admin/supabase-admin";
import { getCategories } from "./data";
import {
  findBusinessMatches,
  normalizeWebsiteHost,
  type BusinessMatch,
  type BusinessMatchInput,
} from "./business-matching";
import { claimHref, classifyBrandInput, searchHref } from "./brand-lookup";
import { brandCandidateHref, sanitizeBrandSeed, seedCandidate, type BrandPrefillStatus, type BrandSeed } from "./brand-candidate";
import { extractBrandProfile, type ExtractedBrandProfile } from "./brand-website-extract";
import { SAFE_FETCH_MAX_BYTES, safeFetchHtml, type SafeFetchFailure, type SafeFetchResult, type SafeFetchSizeLimit } from "./safe-fetch";
import { enrichBrandWithAi, type BrandAiEnrichment, type BrandAiInput, type BrandAiResult } from "./brand-ai-enrichment";
import { fetchVerifiedBrandImage, type BrandImageRole } from "./brand-images";
import { getBrandDraftSecret, type BrandDraftCandidate } from "./brand-draft";
import { recordWebsiteAnalysisAttempt, tryAcquireWebsiteFetchSlot } from "./brand-website-rate-limit";

/** Brand Onboarding V1.1B — website-assisted brand creation, run only
 * after /join/brand's existing matcher found nothing for a website:
 *
 *   signed-in visitor → rate limit → one safe HTTPS fetch (lib/safe-fetch)
 *     → deterministic extraction (lib/brand-website-extract)
 *     → Business matcher AGAIN on the strongest extracted identity signals
 *     → public match: the existing claim path
 *     → hidden match: the existing generic "already listed" assistance
 *     → genuinely new: the EXISTING /account/business/new form, prefilled
 *       through the one candidate serializer (lib/brand-candidate)
 *
 * createMemberBusiness then runs the matcher a third time and creates the
 * Business through create_owned_business (pending_review) exactly as
 * before. Nothing here writes to the database, stores images, grants
 * anything or calls a model. Every failure lands on the same manual form
 * with the visitor's website preserved — never a dead end. */

export const WEBSITE_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
export const WEBSITE_ANALYSIS_CACHE_MAX_ENTRIES = 200;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export type WebsiteAnalysisOutcome =
  | "auth_required"
  | "invalid_input"
  | "unsupported_site"
  | "rate_limited"
  | "busy"
  | SafeFetchFailure
  | "no_metadata"
  | "match_failed"
  | "public_match"
  | "hidden_match"
  | "prefilled";

export interface CachedExtraction {
  profile: ExtractedBrandProfile;
  finalUrl: string;
  /** V1.1C — memoized enrichment for this URL (AI result, verified image
   * candidates), so a repeat analysis doesn't re-call the model or
   * re-fetch images. Set once, after the first computation. */
  enrichment?: Enrichment;
}

interface Enrichment {
  ai: BrandAiResult | null;
  aiStatus: "used" | "skipped" | "failed";
  logo: string | null;
  cover: string | null;
}

export interface ExtractionCache {
  get(key: string, now: number): CachedExtraction | null;
  set(key: string, value: CachedExtraction, now: number): void;
}

/** In-memory, per-instance cache of SUCCESSFUL extractions only (never
 * HTML, never failures), 10-minute TTL, ~200 entries, oldest evicted. */
export function createExtractionCache(
  ttlMs: number = WEBSITE_ANALYSIS_CACHE_TTL_MS,
  maxEntries: number = WEBSITE_ANALYSIS_CACHE_MAX_ENTRIES
): ExtractionCache & { size(): number } {
  const entries = new Map<string, { value: CachedExtraction; at: number }>();
  return {
    get(key, now) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (now - hit.at >= ttlMs) {
        entries.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value, now) {
      entries.delete(key);
      entries.set(key, { value, at: now });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size: () => entries.size,
  };
}

export interface WebsiteAnalysisLog {
  event: "brand_website_analysis";
  outcome: WebsiteAnalysisOutcome;
  host: string | null;
  ms: number;
  bytes: number | null;
  redirects: number | null;
  /** HTML acquisition (safe observability — never content):
   * complete_html = read to EOF; successful_truncated_html = stopped on
   * purpose after the head + bounded body; streamed_limit = hard ceiling
   * hit before the head ended; header_limit = response headers too large;
   * declared_limit = refused on Content-Length (not used for HTML). */
  size: "complete_html" | "successful_truncated_html" | "streamed_limit" | "header_limit" | "declared_limit" | null;
  truncated: boolean | null;
  /** The server declared a Content-Length over the old 1 MB limit. */
  declaredSizeExceededOldLimit: boolean | null;
  cached: boolean;
  fields: Record<"name" | "description" | "about" | "instagram" | "city" | "state" | "category" | "logo" | "cover", boolean> | null;
  /** Status of the candidate's AI enrichment — may come from Findmi's
   * 10-minute cache (see aiFromCache); NOT proof of a new Anthropic call. */
  ai: "used" | "skipped" | "failed" | null;
  /** The enrichment (ai status) was reused from Findmi's cache. */
  aiFromCache: boolean | null;
  /** THIS request sent a request to Anthropic (the paid-call signal). */
  aiCalled: boolean | null;
  /** Anthropic usage for THIS request's call only; all null when there was
   * no call or no response. Never prompts, page text or output. */
  aiModel: string | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  aiCacheCreationInputTokens: number | null;
  aiCacheReadInputTokens: number | null;
  aiEstimatedCostUsd: number | null;
  match: "none" | "public" | "hidden" | null;
}

const SIZE_LIMIT_LOG: Record<SafeFetchSizeLimit, WebsiteAnalysisLog["size"]> = {
  declared: "declared_limit",
  streamed: "streamed_limit",
  headers: "header_limit",
};

export interface WebsiteAnalysisDeps {
  fetchHtml: (url: URL) => Promise<SafeFetchResult>;
  /** V1.1C — one bounded AI enrichment (null result = keep deterministic). */
  enrich: (input: BrandAiInput) => Promise<BrandAiEnrichment>;
  /** V1.1C — fetch + fully verify a logo/cover candidate. */
  verifyImage: (url: string, role: BrandImageRole) => Promise<boolean>;
  /** V1.1C — BRAND_DRAFT_SECRET configured: build an enriched signed draft.
   * Off → the bounded V1.1B text prefill (no About, no images). */
  draftsEnabled: boolean;
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  listCategories: () => Promise<{ id: string; slug: string; name: string }[]>;
  isRateLimited: (userKey: string, ipKey: string) => boolean;
  acquireSlot: () => (() => void) | null;
  cache: ExtractionCache;
  log: (entry: WebsiteAnalysisLog) => void;
  now: () => number;
}

export interface WebsiteAnalysisResult {
  href: string;
  outcome: WebsiteAnalysisOutcome;
  /** V1.1C — present only for a "prefilled" result with drafts enabled:
   * the caller signs it into the draft cookie and redirects to `href`
   * (the minimal Review route). If signing fails it redirects to
   * `fallbackHref` (the bounded V1.1B text prefill) instead. */
  draft?: BrandDraftCandidate;
  fallbackHref?: string;
}

/** Minimal routing state for Review Your Brand — the candidate itself
 * travels in the signed draft cookie (lib/brand-draft.ts). */
export const BRAND_DRAFT_REVIEW_HREF = "/account/business/new?source=brand&prefill=website&draft=1";

/** Where a hidden (non-public) extracted match sends the visitor: the
 * existing generic assistance state — no detail of the record. */
export const ALREADY_LISTED_HREF = "/join/brand?notice=already_listed";

function hasAnyField(p: ExtractedBrandProfile): boolean {
  return Boolean(p.name || p.shortDescription || p.instagramHandle || p.city || p.state || p.categorySlug);
}

/** Pure orchestration core (exported for tests; real deps below). */
export async function analyzeBrandWebsite(
  input: { website: string; userId: string | null; ip: string; seed?: BrandSeed | null },
  deps: WebsiteAnalysisDeps
): Promise<WebsiteAnalysisResult> {
  const started = deps.now();
  const value = (input.website ?? "").trim();
  // The visitor's original name / Instagram search (bounded, validated) —
  // preferred over the weaker extracted equivalents, still editable.
  const seed = sanitizeBrandSeed(input.seed ?? {});
  if (!input.userId) {
    // Analysis is account-only: sign in, then return to the same no-match
    // result to choose Build My Brand Profile again explicitly.
    return { href: `/login?next=${encodeURIComponent(searchHref(value, "website", seed))}`, outcome: "auth_required" };
  }

  const classified = classifyBrandInput(value, "website");
  if (!classified.ok) return { href: "/join/brand", outcome: "invalid_input" };
  const websiteUrl = HAS_SCHEME.test(classified.value) ? classified.value : `https://${classified.value}`;
  const host = normalizeWebsiteHost(websiteUrl);
  const manual = (prefill: BrandPrefillStatus) => brandCandidateHref({ ...seedCandidate(seed), website_url: websiteUrl }, prefill);

  let log: WebsiteAnalysisLog = { event: "brand_website_analysis", outcome: "invalid_input", host, ms: 0, bytes: null, redirects: null, size: null, truncated: null, declaredSizeExceededOldLimit: null, cached: false, fields: null, ai: null, aiFromCache: null, aiCalled: null, aiModel: null, aiInputTokens: null, aiOutputTokens: null, aiCacheCreationInputTokens: null, aiCacheReadInputTokens: null, aiEstimatedCostUsd: null, match: null };
  const finish = (
    href: string,
    outcome: WebsiteAnalysisOutcome,
    extra: Partial<WebsiteAnalysisLog> = {},
    result: Partial<WebsiteAnalysisResult> = {}
  ): WebsiteAnalysisResult => {
    log = { ...log, ...extra, outcome, ms: deps.now() - started };
    deps.log(log);
    return { ...result, href, outcome };
  };

  // HTTPS only: the visitor's site is always requested as https://host/path
  // (query and fragment dropped). Never retried over http.
  let fetchUrl: URL;
  try {
    const parsed = new URL(websiteUrl);
    fetchUrl = new URL(`https://${parsed.host}${parsed.pathname}`);
  } catch {
    return finish(manual("unavailable"), "unsupported_site");
  }
  if (!host) return finish(manual("unavailable"), "unsupported_site");

  if (deps.isRateLimited(input.userId, input.ip)) return finish(manual("limited"), "rate_limited");

  const cacheKey = fetchUrl.href;
  let cached = deps.cache.get(cacheKey, deps.now());
  if (cached) {
    log.cached = true;
  } else {
    const release = deps.acquireSlot();
    if (!release) return finish(manual("unavailable"), "busy");
    let fetched: SafeFetchResult;
    try {
      fetched = await deps.fetchHtml(fetchUrl);
    } finally {
      release();
    }
    log.redirects = fetched.redirects;
    if (fetched.declaredBytes != null) log.declaredSizeExceededOldLimit = fetched.declaredBytes > SAFE_FETCH_MAX_BYTES;
    if (!fetched.ok) {
      if (fetched.limit) log.size = SIZE_LIMIT_LOG[fetched.limit];
      return finish(manual("unavailable"), fetched.code);
    }
    log.bytes = fetched.bytes;
    log.truncated = fetched.truncated;
    log.size = fetched.truncated ? "successful_truncated_html" : "complete_html";
    let profile: ExtractedBrandProfile;
    try {
      profile = extractBrandProfile(fetched.html, fetched.url);
    } catch {
      return finish(manual("unavailable"), "no_metadata");
    }
    if (!hasAnyField(profile)) return finish(manual("unavailable"), "no_metadata");
    cached = { profile, finalUrl: fetched.url.href };
    deps.cache.set(cacheKey, cached, deps.now());
  }

  const { profile, finalUrl } = cached;
  log.fields = {
    name: Boolean(profile.name),
    description: Boolean(profile.shortDescription),
    about: Boolean(profile.aboutDescription),
    instagram: Boolean(profile.instagramHandle),
    city: Boolean(profile.city),
    state: Boolean(profile.state),
    category: Boolean(profile.categorySlug),
    logo: Boolean(profile.logoCandidateUrl),
    cover: Boolean(profile.coverCandidateUrl),
  };
  const igUrl = (handle: string | null | undefined) => (handle ? `https://www.instagram.com/${handle}` : null);
  const name = seed.name ?? profile.name;
  const instagramUrl = igUrl(seed.instagram ?? profile.instagramHandle);

  // Match AGAIN with the strongest identity signals: the visitor's website
  // + Instagram + name/location (seed first, else extracted), plus any
  // extracted name / Instagram the seed overrode and the post-redirect
  // website when it is a different host — none of them may be a duplicate.
  let matches: BusinessMatch[];
  try {
    const finalHost = normalizeWebsiteHost(finalUrl);
    const lookups: Promise<BusinessMatch[]>[] = [
      deps.findMatches({ websiteUrl, instagramUrl, name, city: profile.city, state: profile.state }),
    ];
    if (finalHost && finalHost !== host) lookups.push(deps.findMatches({ websiteUrl: finalUrl }));
    if (seed.instagram && profile.instagramHandle && profile.instagramHandle !== seed.instagram) {
      lookups.push(deps.findMatches({ instagramUrl: igUrl(profile.instagramHandle) }));
    }
    if (seed.name && profile.name && profile.name !== seed.name) {
      lookups.push(deps.findMatches({ name: profile.name, city: profile.city, state: profile.state }));
    }
    matches = (await Promise.all(lookups)).flat();
  } catch {
    return finish(manual("unavailable"), "match_failed");
  }
  const publicMatch = matches.find((m) => m.isPublic);
  if (publicMatch) return finish(claimHref(publicMatch.slug, true), "public_match", { match: "public" });
  if (matches.length > 0) return finish(ALREADY_LISTED_HREF, "hidden_match", { match: "hidden" });

  let categories: { id: string; slug: string; name: string }[] = [];
  try {
    categories = await deps.listCategories();
  } catch {
    categories = [];
  }
  // Deterministic structured type wins; AI is only a fallback below.
  const deterministicCategoryId = profile.categorySlug
    ? (categories.find((c) => c.slug === profile.categorySlug)?.id ?? null)
    : null;

  // V1.1C enrichment — computed once per URL (cached with the
  // extraction): the bounded AI call only when deterministic extraction
  // left the category or a description empty, and (drafts only) the
  // logo/cover candidates fetched and fully verified, in parallel.
  let enrichment = cached.enrichment;
  log.aiFromCache = Boolean(enrichment);
  log.aiCalled = false;
  if (!enrichment) {
    const needsAi = !deterministicCategoryId || !profile.shortDescription || !profile.aboutDescription;
    const verify = async (url: string | null, role: BrandImageRole) => {
      if (!deps.draftsEnabled || !url) return null;
      try {
        return (await deps.verifyImage(url, role)) ? url : null;
      } catch {
        return null;
      }
    };
    const [ai, logo, cover] = await Promise.all([
      needsAi
        ? deps
            .enrich({ brandName: name, website: websiteUrl, excerpt: profile.excerpt, categories: categories.map((c) => ({ id: c.id, name: c.name })) })
            // enrichBrandWithAi never throws; an unexpected throw is
            // counted as a call with unknown usage, never as zero tokens.
            .catch((): BrandAiEnrichment => ({ result: null, called: true, usage: null }))
        : Promise.resolve<BrandAiEnrichment | null>(null),
      verify(profile.logoCandidateUrl, "logo"),
      verify(profile.coverCandidateUrl, "cover"),
    ]);
    const result = ai?.result ?? null;
    enrichment = { ai: result, aiStatus: !needsAi ? "skipped" : result ? "used" : "failed", logo, cover };
    cached.enrichment = enrichment;
    // Usage is logged only on the request that made the call — it is not
    // cached, so a reuse can never look like a new paid invocation.
    log.aiCalled = ai?.called ?? false;
    if (ai?.usage) {
      log.aiModel = ai.usage.model;
      log.aiInputTokens = ai.usage.inputTokens;
      log.aiOutputTokens = ai.usage.outputTokens;
      log.aiCacheCreationInputTokens = ai.usage.cacheCreationInputTokens;
      log.aiCacheReadInputTokens = ai.usage.cacheReadInputTokens;
      log.aiEstimatedCostUsd = ai.usage.estimatedCostUsd;
    }
  }
  log.ai = enrichment.aiStatus;

  const ai = enrichment.ai;
  const categoryId = deterministicCategoryId ?? ai?.categoryId ?? null;
  const shortDescription = profile.shortDescription ?? ai?.shortDescription ?? null;
  const about = profile.aboutDescription ?? ai?.about ?? null;

  const fallbackHref = brandCandidateHref(
    {
      name,
      website_url: websiteUrl,
      instagram_url: instagramUrl,
      short_description: shortDescription,
      city: profile.city,
      state: profile.state,
      category_id: categoryId,
    },
    "website"
  );
  if (!deps.draftsEnabled) return finish(fallbackHref, "prefilled", { match: "none" });

  const draft: BrandDraftCandidate = {
    site: websiteUrl,
    name,
    cat: categoryId,
    sd: shortDescription,
    about,
    ig: seed.instagram ?? profile.instagramHandle,
    city: profile.city,
    state: profile.state,
    logo: enrichment.logo,
    cover: enrichment.cover,
  };
  return finish(BRAND_DRAFT_REVIEW_HREF, "prefilled", { match: "none" }, { draft, fallbackHref });
}

const sharedCache = createExtractionCache();

/** Real dependencies. Null when the server isn't configured (no service
 * role), in which case callers fall back to the manual form. */
export function defaultWebsiteAnalysisDeps(): WebsiteAnalysisDeps | null {
  const admin = getAdminSupabase();
  if (!admin) return null;
  return {
    fetchHtml: (url) => safeFetchHtml(url),
    findMatches: (matchInput) => findBusinessMatches(admin, matchInput),
    listCategories: async () => (await getCategories()).map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
    enrich: (input) => enrichBrandWithAi(input),
    verifyImage: async (url, role) => (await fetchVerifiedBrandImage(url, role)).ok,
    draftsEnabled: Boolean(getBrandDraftSecret()),
    isRateLimited: (userKey, ipKey) => recordWebsiteAnalysisAttempt(userKey, ipKey),
    acquireSlot: tryAcquireWebsiteFetchSlot,
    cache: sharedCache,
    // Host, outcome, timings, counts and booleans only — never HTML,
    // extracted text, query strings, headers, cookies or user ids.
    log: (entry) => console.info(JSON.stringify(entry)),
    now: Date.now,
  };
}

/** Manual-form fallback for a website when analysis can't run at all. */
export function manualBrandFormHref(website: string, seed?: BrandSeed | null): string {
  const value = website.trim();
  return brandCandidateHref({ ...seedCandidate(seed), website_url: HAS_SCHEME.test(value) ? value : `https://${value}` }, "unavailable");
}
