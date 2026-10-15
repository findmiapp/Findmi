import "server-only";
import { getAdminSupabase } from "./admin/supabase-admin";
import { getCategories } from "./data";
import { findBusinessMatches, type BusinessMatch, type BusinessMatchInput } from "./business-matching";
import { brandBuildSignInHref, claimHref } from "./brand-lookup";
import { brandCandidateHref, sanitizeBrandSeed, seedCandidate, type BrandPrefillStatus, type BrandSeed } from "./brand-candidate";
import { isSvgCandidateUrl, manifestIconCandidates, type BrandPageSignals, type ExtractedBrandProfile } from "./brand-website-extract";
import { safeFetchBrandAboutPage, safeFetchBrandPage, safeFetchManifest, type SafeFetchFailure, type SafeFetchResult } from "./safe-fetch";
import { enrichBrandWithAi, type BrandAiEnrichment, type BrandAiInput } from "./brand-ai-enrichment";
import {
  discoverInstagram,
  instagramSearchEnabled,
  type InstagramDiscovery,
  type InstagramDiscoveryInput,
  type InstagramDiscoveryStatus,
} from "./brand-instagram-discovery";
import {
  clearStagedBrandImages,
  fetchVerifiedBrandImage,
  stageBrandImage,
  type BrandImageRole,
  type VerifiedBrandImage,
} from "./brand-images";
import {
  buildCandidateFromExtraction,
  fetchBrandWebsite,
  isDeliberateBlock,
  prepareBrandWebsite,
  withDefaultScheme,
  type BrandEnrichment,
} from "./brand-candidate-builder";
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
 * before. Nothing here writes to the database, stores images or grants
 * anything. Every failure lands on the same manual form with the
 * visitor's website preserved — never a dead end.
 *
 * Brand Ingestion P1 — the candidate-building work itself (input
 * normalization, safe fetch + extraction, matching, AI need/enrichment,
 * image verification, the proposed candidate) lives in the shared core,
 * lib/brand-candidate-builder.ts. This module is the PUBLIC ADAPTER: it
 * owns the sign-in requirement, per-user/IP limits, the per-instance
 * fetch slot, the 10-minute cache (placed between the core's stages),
 * the visitor's search seed (passed to the core as identity overrides),
 * hidden-match non-disclosure, claim/already-listed/review/manual URLs,
 * the signed-draft candidate and the brand_website_analysis log. */

export const WEBSITE_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
export const WEBSITE_ANALYSIS_CACHE_MAX_ENTRIES = 200;

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
  enrichment?: BrandEnrichment;
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
  /** VCL A3b — THIS request's Instagram search (null when none ran):
   * outcome status, paid searches actually performed and estimated cost
   * (tokens + searches). Never the query, results or handle. */
  igSearch: InstagramDiscoveryStatus | null;
  igSearches: number | null;
  igSearchCostUsd: number | null;
  match: "none" | "public" | "hidden" | null;
}

/** TEMPORARY diagnostic for the real Brand Build path (VCL A3 root cause).
 * Hosts, statuses, counts, source kinds and reason codes only — never
 * full URLs, query strings, HTML, page text, cookies, keys or user ids. */
export interface BrandBuildDiagnostic {
  event: "brand_build_diagnostic";
  host: string;
  outcome: WebsiteAnalysisOutcome;
  cached: boolean;
  /** Images are only verified (and offered) when signed drafts are enabled. */
  imagesEnabled: boolean;
  fetch: { status: number | null; contentType: string | null; finalHost: string | null; redirects: number | null; bytes: number | null; size: string | null; challenge?: boolean } | null;
  signals: BrandPageSignals | null;
  candidates: { logo: number; logoStrong: number; svgLogo: number; cover: number; manifestUrl: boolean } | null;
  verifications: { role: BrandImageRole; kind: "raster" | "svg"; host: string; ok: boolean; reason: string | null }[];
  manifest: { attempted: boolean; icons: number; failed: boolean } | null;
  result: {
    logo: "page_logo" | "icon" | "svg" | "manifest" | null;
    cover: boolean;
    instagram: "seed" | "page" | "search" | null;
    staged?: { logo: boolean; cover: boolean };
  } | null;
  /** "disabled" = A3b flag off (search never runs); else the search status or "not_run". */
  instagramSearch: string;
}

export interface WebsiteAnalysisDeps {
  fetchHtml: (url: URL) => Promise<SafeFetchResult>;
  /** Modern site extraction — the ONE same-site About page (shorter
   * timeout). Absent → no About page is ever read. */
  fetchAboutPage?: (url: URL) => Promise<SafeFetchResult>;
  /** V1.1C — one bounded AI enrichment (null result = keep deterministic). */
  enrich: (input: BrandAiInput) => Promise<BrandAiEnrichment>;
  /** V1.1C — fetch + fully verify a logo/cover candidate. */
  verifyImage: (url: string, role: BrandImageRole) => Promise<boolean>;
  /** VCL A3 — manifest icons as identity candidates (failure path only). */
  fetchManifestIcons?: (manifestUrl: string) => Promise<string[]>;
  /** VCL A3b — present only when paid Instagram search is enabled. */
  discoverInstagram?: (input: InstagramDiscoveryInput) => Promise<InstagramDiscovery>;
  /** Diagnostics: verification WITH its rejection reason (optional; when
   * absent verifyImage is used and the reason is unknown). */
  verifyImageDetailed?: (url: string, role: BrandImageRole) => Promise<{ ok: boolean; reason: string | null; image?: VerifiedBrandImage }>;
  /** VCL A3 recovery — stage a VERIFIED image for this user (Findmi
   * storage) so Review and creation never re-fetch it; null on failure. */
  stageVerified?: (userId: string, image: VerifiedBrandImage) => Promise<string | null>;
  /** Removes this user's previously staged images (best effort). */
  clearStaged?: (userId: string) => Promise<void>;
  /** Diagnostics sink for BrandBuildDiagnostic (absent → not emitted). */
  diagnostic?: (entry: BrandBuildDiagnostic) => void;
  /** V1.1C — BRAND_DRAFT_SECRET configured: build an enriched signed draft.
   * Off → the bounded V1.1B text prefill (no About, no images). */
  draftsEnabled: boolean;
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  listCategories: () => Promise<{ id: string; slug: string; name: string }[]>;
  isRateLimited: (userKey: string, ipKey: string) => boolean;
  acquireSlot: () => (() => void) | null;
  cache: ExtractionCache;
  /** Analyses currently running in this process, by normalized source.
   * A second analysis of the same source waits for the first and then
   * reuses its cached extraction + enrichment instead of independently
   * fetching and calling the model (e.g. a double submit, or an automatic
   * post-sign-in resume racing a manual press). Optional: absent → no
   * sharing (each call runs on its own, as before). */
  inflight?: Map<string, Promise<void>>;
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

/** The public adapter around the shared core (exported for tests; real
 * deps below). */
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
    return { href: brandBuildSignInHref(value, seed), outcome: "auth_required" };
  }

  const prepared = prepareBrandWebsite(value);
  if (!prepared.ok && prepared.code === "invalid_input") return { href: "/join/brand", outcome: "invalid_input" };
  const websiteUrl = prepared.ok ? prepared.website.websiteUrl : prepared.websiteUrl;
  const host = prepared.ok ? prepared.website.host : prepared.host;
  const manual = (prefill: BrandPrefillStatus) => brandCandidateHref({ ...seedCandidate(seed), website_url: websiteUrl }, prefill);

  let log: WebsiteAnalysisLog = { event: "brand_website_analysis", outcome: "invalid_input", host, ms: 0, bytes: null, redirects: null, size: null, truncated: null, declaredSizeExceededOldLimit: null, cached: false, fields: null, ai: null, aiFromCache: null, aiCalled: null, aiModel: null, aiInputTokens: null, aiOutputTokens: null, aiCacheCreationInputTokens: null, aiCacheReadInputTokens: null, aiEstimatedCostUsd: null, igSearch: null, igSearches: null, igSearchCostUsd: null, match: null };
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

  if (!prepared.ok) return finish(manual("unavailable"), "unsupported_site");
  const { website } = prepared;

  if (deps.isRateLimited(input.userId, input.ip)) return finish(manual("limited"), "rate_limited");

  // The public 10-minute cache sits between the core's fetch and
  // candidate stages; the fetch slot covers the fetch only. Keyed by the
  // normalized source (lowercased host without a leading "www.", plus the
  // path without a trailing slash) so equivalent addresses share one
  // extraction/enrichment.
  const cacheKey = websiteAnalysisCacheKey(website.fetchUrl);
  const running = deps.inflight?.get(cacheKey);
  if (running) await running.catch(() => {});
  let settleInflight = () => {};
  if (deps.inflight) {
    let resolve!: () => void;
    const mine = new Promise<void>((r) => (resolve = r));
    deps.inflight.set(cacheKey, mine);
    settleInflight = () => {
      if (deps.inflight?.get(cacheKey) === mine) deps.inflight.delete(cacheKey);
      resolve();
    };
  }
  try {
    return await analyzeSource(website, cacheKey, deps, log, finish, manual, seed, input.userId);
  } finally {
    settleInflight();
  }
}

/** Normalized analysis source key (see analyzeBrandWebsite). */
export function websiteAnalysisCacheKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}

async function analyzeSource(
  website: Extract<ReturnType<typeof prepareBrandWebsite>, { ok: true }>["website"],
  cacheKey: string,
  deps: WebsiteAnalysisDeps,
  log: WebsiteAnalysisLog,
  finishOuter: (href: string, outcome: WebsiteAnalysisOutcome, extra?: Partial<WebsiteAnalysisLog>, result?: Partial<WebsiteAnalysisResult>) => WebsiteAnalysisResult,
  manual: (prefill: BrandPrefillStatus) => string,
  seed: BrandSeed,
  userId: string
): Promise<WebsiteAnalysisResult> {
  // Verified bytes captured during THIS Build (url|role → image), reused
  // for staging so a verified candidate is never fetched again.
  const verifiedImages = new Map<string, VerifiedBrandImage>();
  // ── TEMPORARY diagnostics (see BrandBuildDiagnostic) ──
  const diag: BrandBuildDiagnostic = {
    event: "brand_build_diagnostic",
    host: website.host,
    outcome: "invalid_input",
    cached: false,
    imagesEnabled: deps.draftsEnabled,
    fetch: null,
    signals: null,
    candidates: null,
    verifications: [],
    manifest: null,
    result: null,
    instagramSearch: deps.discoverInstagram ? "not_run" : "disabled",
  };
  const hostOf = (url: string) => {
    if (url.startsWith("data:")) return "inline";
    try {
      return new URL(url).hostname;
    } catch {
      return "invalid";
    }
  };
  const finish: typeof finishOuter = (href, outcome, extra, result) => {
    diag.outcome = outcome;
    try {
      deps.diagnostic?.(diag);
    } catch {
      // diagnostics never affect the Build
    }
    return finishOuter(href, outcome, extra, result);
  };
  const buildDeps: WebsiteAnalysisDeps = {
    ...deps,
    verifyImage: async (url, role) => {
      let ok = false;
      let reason: string | null = null;
      try {
        if (deps.verifyImageDetailed) {
          const r = await deps.verifyImageDetailed(url, role);
          ({ ok, reason } = r);
          if (r.ok && r.image) verifiedImages.set(`${role}|${url}`, r.image);
        } else ok = await deps.verifyImage(url, role);
      } catch {
        reason = "threw";
      }
      if (diag.verifications.length < 20) diag.verifications.push({ role, kind: isSvgCandidateUrl(url) ? "svg" : "raster", host: hostOf(url), ok, reason: ok ? null : (reason ?? "rejected") });
      return ok;
    },
    ...(deps.fetchManifestIcons
      ? {
          fetchManifestIcons: async (manifestUrl: string) => {
            try {
              const icons = await deps.fetchManifestIcons!(manifestUrl);
              diag.manifest = { attempted: true, icons: icons.length, failed: false };
              return icons;
            } catch (err) {
              diag.manifest = { attempted: true, icons: 0, failed: true };
              throw err;
            }
          },
        }
      : {}),
  };

  let cached = deps.cache.get(cacheKey, deps.now());
  if (cached) {
    log.cached = true;
  } else {
    const release = deps.acquireSlot();
    if (!release) return finish(manual("unavailable"), "busy");
    // Released when the fetch settles (success, failure or throw) —
    // before extraction, exactly as before. fetchBrandWebsite calls
    // fetchHtml first, so the slot can never be left held.
    const fetched = await fetchBrandWebsite(website.fetchUrl, {
      fetchHtml: async (url) => {
        try {
          return await deps.fetchHtml(url);
        } finally {
          release();
        }
      },
    });
    log.redirects = fetched.fetch.redirects;
    log.declaredSizeExceededOldLimit = fetched.fetch.declaredSizeExceededOldLimit;
    log.size = fetched.fetch.size;
    log.bytes = fetched.fetch.bytes;
    log.truncated = fetched.fetch.truncated;
    diag.fetch = {
      status: fetched.fetch.status ?? null,
      contentType: fetched.fetch.contentType ?? null,
      finalHost: fetched.fetch.finalHost ?? null,
      redirects: fetched.fetch.redirects,
      bytes: fetched.fetch.bytes,
      size: fetched.fetch.size,
      ...(fetched.fetch.challenge ? { challenge: true } : {}),
    };
    // A deliberate refusal is told apart from "couldn't read it" (plain
    // words on Review; name + website still carried, Add It Myself as ever).
    if (!fetched.ok) return finish(manual(isDeliberateBlock(fetched.code, fetched.fetch) ? "blocked" : "unavailable"), fetched.code);
    cached = { profile: fetched.extraction.profile, finalUrl: fetched.extraction.finalUrl };
    deps.cache.set(cacheKey, cached, deps.now());
  }
  const entry = cached;
  diag.cached = log.cached;
  diag.signals = entry.profile.signals ?? null;
  diag.candidates = {
    logo: entry.profile.logoCandidates?.length ?? 0,
    logoStrong: entry.profile.logoStrongCount ?? 0,
    svgLogo: entry.profile.svgLogoCandidates?.length ?? 0,
    cover: entry.profile.coverCandidates?.length ?? 0,
    manifestUrl: Boolean(entry.profile.manifestUrl),
  };

  const built = await buildCandidateFromExtraction(
    website,
    { profile: entry.profile, finalUrl: entry.finalUrl },
    buildDeps,
    {
      verifyImages: deps.draftsEnabled,
      // The visitor's original name / Instagram search is preferred over
      // the weaker extracted equivalents (and its replaced extracted
      // values are matched too).
      identity: { name: seed.name ?? null, instagram: seed.instagram ?? null },
      reuseEnrichment: entry.enrichment ?? null,
    }
  );
  log.fields = built.fields;
  if (built.status === "failed") return finish(manual("unavailable"), built.code);
  if (built.status === "matched") {
    if (built.publicMatch) return finish(claimHref(built.publicMatch.slug, true), "public_match", { match: "public" });
    // Hidden (non-public) match: the generic assistance state only —
    // never any detail of the record.
    return finish(ALREADY_LISTED_HREF, "hidden_match", { match: "hidden" });
  }

  // Memoize the enrichment on the cache entry (never usage), so a repeat
  // analysis neither re-calls the model nor re-fetches images — and can
  // never look like a new paid invocation.
  if (!built.ai.reused) entry.enrichment = built.enrichment;
  log.aiFromCache = built.ai.reused;
  log.aiCalled = built.ai.called;
  if (built.ai.usage) {
    log.aiModel = built.ai.usage.model;
    log.aiInputTokens = built.ai.usage.inputTokens;
    log.aiOutputTokens = built.ai.usage.outputTokens;
    log.aiCacheCreationInputTokens = built.ai.usage.cacheCreationInputTokens;
    log.aiCacheReadInputTokens = built.ai.usage.cacheReadInputTokens;
    log.aiEstimatedCostUsd = built.ai.usage.estimatedCostUsd;
  }
  log.ai = built.ai.status;
  {
    const p = built.proposal;
    const logos = entry.profile.logoCandidates ?? [];
    const logoIndex = p.logoUrl ? logos.indexOf(p.logoUrl) : -1;
    diag.result = {
      logo: !p.logoUrl
        ? null
        : (entry.profile.svgLogoCandidates ?? []).includes(p.logoUrl)
          ? "svg"
          : logoIndex >= 0
            ? logoIndex < (entry.profile.logoStrongCount ?? logos.length)
              ? "page_logo"
              : "icon"
            : "manifest",
      cover: Boolean(p.coverUrl),
      instagram: seed.instagram ? "seed" : entry.profile.instagramHandle ? "page" : p.instagramHandle ? "search" : null,
    };
    if (built.ai.instagramSearch) diag.instagramSearch = built.ai.instagramSearch.status;
    else if (built.ai.reused && deps.discoverInstagram) diag.instagramSearch = "cached";
  }
  if (built.ai.instagramSearch) {
    log.igSearch = built.ai.instagramSearch.status;
    log.igSearches = built.ai.instagramSearch.usage?.searches ?? null;
    log.igSearchCostUsd = built.ai.instagramSearch.usage?.estimatedCostUsd ?? null;
  }

  const { proposal } = built;
  const fallbackHref = brandCandidateHref(
    {
      name: proposal.name,
      website_url: proposal.websiteUrl,
      instagram_url: proposal.instagramUrl,
      short_description: proposal.shortDescription,
      city: proposal.city,
      state: proposal.state,
      category_id: proposal.categoryId,
    },
    "website"
  );
  if (!deps.draftsEnabled) return finish(fallbackHref, "prefilled", { match: "none" });

  // Stage each verified image ONCE (its bytes were already verified in
  // this Build; after a cache hit they are verified one more time). Review
  // shows the staged copy and creation re-hosts it — no further third-party
  // fetch. A failed staging falls back to the remote URL as before.
  const staged: Record<BrandImageRole, string | null> = { logo: null, cover: null };
  if (deps.stageVerified && deps.draftsEnabled) {
    await deps.clearStaged?.(userId).catch(() => {});
    for (const [role, url] of [["logo", proposal.logoUrl], ["cover", proposal.coverUrl]] as const) {
      if (!url) continue;
      let image = verifiedImages.get(`${role}|${url}`);
      if (!image && deps.verifyImageDetailed) image = (await deps.verifyImageDetailed(url, role).catch(() => null))?.image;
      staged[role] = image ? await deps.stageVerified(userId, image).catch(() => null) : null;
    }
  }
  if (diag.result && deps.stageVerified && deps.draftsEnabled) diag.result = { ...diag.result, staged: { logo: Boolean(staged.logo), cover: Boolean(staged.cover) } };
  const draft: BrandDraftCandidate = {
    site: proposal.websiteUrl,
    name: proposal.name,
    cat: proposal.categoryId,
    sd: proposal.shortDescription,
    about: proposal.about,
    ig: proposal.instagramHandle,
    city: proposal.city,
    state: proposal.state,
    // The remote URL only when no staged copy exists (fallback path).
    logo: staged.logo ? null : proposal.logoUrl,
    cover: staged.cover ? null : proposal.coverUrl,
    ...(staged.logo ? { logoStaged: staged.logo } : {}),
    ...(staged.cover ? { coverStaged: staged.cover } : {}),
  };
  return finish(BRAND_DRAFT_REVIEW_HREF, "prefilled", { match: "none" }, { draft, fallbackHref });
}

const sharedCache = createExtractionCache();
const sharedInflight = new Map<string, Promise<void>>();

/** Real dependencies. Null when the server isn't configured (no service
 * role), in which case callers fall back to the manual form. */
export function defaultWebsiteAnalysisDeps(): WebsiteAnalysisDeps | null {
  const admin = getAdminSupabase();
  if (!admin) return null;
  return {
    // The homepage: safeFetchHtml + the shared one-time 429/503 retry.
    fetchHtml: (url) => safeFetchBrandPage(url),
    // At most ONE About page, no retry, a shorter deadline (Build budget).
    fetchAboutPage: (url) => safeFetchBrandAboutPage(url),
    findMatches: (matchInput) => findBusinessMatches(admin, matchInput),
    listCategories: async () => (await getCategories()).map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
    enrich: (input) => enrichBrandWithAi(input),
    verifyImage: async (url, role) => (await fetchVerifiedBrandImage(url, role)).ok,
    verifyImageDetailed: async (url, role) => {
      const r = await fetchVerifiedBrandImage(url, role);
      return r.ok ? { ok: true, reason: null, image: r.image } : { ok: false, reason: r.reason };
    },
    stageVerified: (userId, image) => stageBrandImage(admin, userId, image),
    clearStaged: (userId) => clearStagedBrandImages(admin, userId),
    // TEMPORARY (VCL A3 root cause): one safe structured line per Build.
    diagnostic: (entry) => console.info(JSON.stringify(entry)),
    fetchManifestIcons: async (manifestUrl) => {
      const fetched = await safeFetchManifest(manifestUrl);
      return fetched.ok ? manifestIconCandidates(fetched.text, fetched.url) : [];
    },
    // VCL A3b — paid search only when explicitly enabled (server-only
    // BRAND_INSTAGRAM_SEARCH_ENABLED=1 + ANTHROPIC_API_KEY); off by default.
    ...(instagramSearchEnabled() ? { discoverInstagram: (input: InstagramDiscoveryInput) => discoverInstagram(input) } : {}),
    draftsEnabled: Boolean(getBrandDraftSecret()),
    isRateLimited: (userKey, ipKey) => recordWebsiteAnalysisAttempt(userKey, ipKey),
    acquireSlot: tryAcquireWebsiteFetchSlot,
    cache: sharedCache,
    inflight: sharedInflight,
    // Host, outcome, timings, counts and booleans only — never HTML,
    // extracted text, query strings, headers, cookies or user ids.
    log: (entry) => console.info(JSON.stringify(entry)),
    now: Date.now,
  };
}

/** Manual-form fallback for a website when analysis can't run at all. */
export function manualBrandFormHref(website: string, seed?: BrandSeed | null): string {
  const value = website.trim();
  return brandCandidateHref({ ...seedCandidate(seed), website_url: withDefaultScheme(value) }, "unavailable");
}
