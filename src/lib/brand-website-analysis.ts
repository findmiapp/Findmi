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
import { brandCandidateHref, type BrandPrefillStatus } from "./brand-candidate";
import { extractBrandProfile, type ExtractedBrandProfile } from "./brand-website-extract";
import { safeFetchHtml, type SafeFetchFailure, type SafeFetchResult } from "./safe-fetch";
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
  cached: boolean;
  fields: Record<"name" | "description" | "instagram" | "city" | "state" | "category" | "logo", boolean> | null;
  match: "none" | "public" | "hidden" | null;
}

export interface WebsiteAnalysisDeps {
  fetchHtml: (url: URL) => Promise<SafeFetchResult>;
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  listCategories: () => Promise<{ id: string; slug: string }[]>;
  isRateLimited: (userKey: string, ipKey: string) => boolean;
  acquireSlot: () => (() => void) | null;
  cache: ExtractionCache;
  log: (entry: WebsiteAnalysisLog) => void;
  now: () => number;
}

export interface WebsiteAnalysisResult {
  href: string;
  outcome: WebsiteAnalysisOutcome;
}

/** Where a hidden (non-public) extracted match sends the visitor: the
 * existing generic assistance state — no detail of the record. */
export const ALREADY_LISTED_HREF = "/join/brand?notice=already_listed";

function hasAnyField(p: ExtractedBrandProfile): boolean {
  return Boolean(p.name || p.shortDescription || p.instagramHandle || p.city || p.state || p.categorySlug);
}

/** Pure orchestration core (exported for tests; real deps below). */
export async function analyzeBrandWebsite(
  input: { website: string; userId: string | null; ip: string },
  deps: WebsiteAnalysisDeps
): Promise<WebsiteAnalysisResult> {
  const started = deps.now();
  const value = (input.website ?? "").trim();
  if (!input.userId) {
    // Analysis is account-only: sign in, then return to the same no-match
    // result to choose Build My Brand Profile again explicitly.
    return { href: `/login?next=${encodeURIComponent(searchHref(value, "website"))}`, outcome: "auth_required" };
  }

  const classified = classifyBrandInput(value, "website");
  if (!classified.ok) return { href: "/join/brand", outcome: "invalid_input" };
  const websiteUrl = HAS_SCHEME.test(classified.value) ? classified.value : `https://${classified.value}`;
  const host = normalizeWebsiteHost(websiteUrl);
  const manual = (prefill: BrandPrefillStatus) => brandCandidateHref({ website_url: websiteUrl }, prefill);

  let log: WebsiteAnalysisLog = { event: "brand_website_analysis", outcome: "invalid_input", host, ms: 0, bytes: null, redirects: null, cached: false, fields: null, match: null };
  const finish = (href: string, outcome: WebsiteAnalysisOutcome, extra: Partial<WebsiteAnalysisLog> = {}): WebsiteAnalysisResult => {
    log = { ...log, ...extra, outcome, ms: deps.now() - started };
    deps.log(log);
    return { href, outcome };
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
    if (!fetched.ok) return finish(manual("unavailable"), fetched.code);
    log.bytes = fetched.bytes;
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
    instagram: Boolean(profile.instagramHandle),
    city: Boolean(profile.city),
    state: Boolean(profile.state),
    category: Boolean(profile.categorySlug),
    logo: Boolean(profile.logoCandidateUrl),
  };
  const instagramUrl = profile.instagramHandle ? `https://www.instagram.com/${profile.instagramHandle}` : null;

  // Match AGAIN with the strongest extracted identity signals: the
  // visitor's website + extracted Instagram + extracted name/location, and
  // the post-redirect website when it is a different host.
  let matches: BusinessMatch[];
  try {
    const finalHost = normalizeWebsiteHost(finalUrl);
    const lookups: Promise<BusinessMatch[]>[] = [
      deps.findMatches({ websiteUrl, instagramUrl, name: profile.name, city: profile.city, state: profile.state }),
    ];
    if (finalHost && finalHost !== host) lookups.push(deps.findMatches({ websiteUrl: finalUrl }));
    matches = (await Promise.all(lookups)).flat();
  } catch {
    return finish(manual("unavailable"), "match_failed");
  }
  const publicMatch = matches.find((m) => m.isPublic);
  if (publicMatch) return finish(claimHref(publicMatch.slug, true), "public_match", { match: "public" });
  if (matches.length > 0) return finish(ALREADY_LISTED_HREF, "hidden_match", { match: "hidden" });

  let categoryId: string | null = null;
  if (profile.categorySlug) {
    try {
      categoryId = (await deps.listCategories()).find((c) => c.slug === profile.categorySlug)?.id ?? null;
    } catch {
      categoryId = null;
    }
  }

  const href = brandCandidateHref(
    {
      name: profile.name,
      website_url: websiteUrl,
      instagram_url: instagramUrl,
      short_description: profile.shortDescription,
      city: profile.city,
      state: profile.state,
      category_id: categoryId,
    },
    "website"
  );
  return finish(href, "prefilled", { match: "none" });
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
    listCategories: async () => (await getCategories()).map((c) => ({ id: c.id, slug: c.slug })),
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
export function manualBrandFormHref(website: string): string {
  const value = website.trim();
  return brandCandidateHref({ website_url: HAS_SCHEME.test(value) ? value : `https://${value}` }, "unavailable");
}
