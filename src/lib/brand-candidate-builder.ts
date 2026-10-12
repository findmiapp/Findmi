import "server-only";
import { normalizeWebsiteHost, type BusinessMatch, type BusinessMatchInput } from "./business-matching";
import { classifyBrandInput } from "./brand-lookup";
import { extractBrandProfile, type ExtractedBrandProfile } from "./brand-website-extract";
import { SAFE_FETCH_MAX_BYTES, type SafeFetchFailure, type SafeFetchResult, type SafeFetchSizeLimit } from "./safe-fetch";
import type { BrandAiEnrichment, BrandAiInput, BrandAiResult, BrandAiUsage } from "./brand-ai-enrichment";
import type { BrandImageRole } from "./brand-images";

/** Brand Ingestion P1 — the shared Brand candidate core: the actual
 * candidate-building work behind the public Brand Builder (and, later,
 * Admin bulk import), with no knowledge of redirects, login/claim URLs,
 * cookies, the signed-in user, request IPs, public rate limits, the
 * public fetch slot, the public 10-minute cache or page copy. Those stay
 * in the caller (lib/brand-website-analysis.ts for the public flow).
 *
 *   prepareBrandWebsite      input → normalized https website (no I/O)
 *   fetchBrandWebsite        one safe fetch → deterministic extraction
 *   buildCandidateFromExtraction
 *                            Business matching → AI need/enrichment →
 *                            image verification → proposed candidate
 *   buildBrandCandidate      all three in order (callers with no cache)
 *
 * The stages are exported separately because the public adapter places
 * its own cache and fetch slot BETWEEN them (cache before the fetch, slot
 * around the fetch only, enrichment memoized on the cache entry) — the
 * order and semantics are exactly the V1.1C ones. Nothing here writes
 * data, stores images or creates a Business; extracted values are
 * untrusted CANDIDATES for human review. */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** The submitted website as typed, with https:// added when it has no
 * scheme (shared with the adapter's manual-form fallback). */
export function withDefaultScheme(value: string): string {
  return HAS_SCHEME.test(value) ? value : `https://${value}`;
}

// ── Stage 1: input ────────────────────────────────────────────────────────

export interface PreparedBrandWebsite {
  /** Submitted website (scheme added), kept for prefill/matching. */
  websiteUrl: string;
  /** Canonical website identity (lib/business-matching). */
  host: string;
  /** Always https://host/path — query and fragment dropped. */
  fetchUrl: URL;
}

export type PrepareBrandWebsiteResult =
  | { ok: true; website: PreparedBrandWebsite }
  /** invalid_input: not a website at all (no URL to keep).
   * unsupported_site: a URL, but not one Findmi fetches (shared platform,
   * IP, localhost…) — websiteUrl is kept for the caller's fallback. */
  | { ok: false; code: "invalid_input"; websiteUrl: null; host: null }
  | { ok: false; code: "unsupported_site"; websiteUrl: string; host: string | null };

export function prepareBrandWebsite(raw: string | null | undefined): PrepareBrandWebsiteResult {
  const classified = classifyBrandInput((raw ?? "").trim(), "website");
  if (!classified.ok) return { ok: false, code: "invalid_input", websiteUrl: null, host: null };
  const websiteUrl = withDefaultScheme(classified.value);
  const host = normalizeWebsiteHost(websiteUrl);
  // HTTPS only: the site is always requested as https://host/path. Never
  // retried over http.
  let fetchUrl: URL;
  try {
    const parsed = new URL(websiteUrl);
    fetchUrl = new URL(`https://${parsed.host}${parsed.pathname}`);
  } catch {
    return { ok: false, code: "unsupported_site", websiteUrl, host };
  }
  if (!host) return { ok: false, code: "unsupported_site", websiteUrl, host };
  return { ok: true, website: { websiteUrl, host, fetchUrl } };
}

// ── Stage 2: fetch + deterministic extraction ─────────────────────────────

export type BrandHtmlSize = "complete_html" | "successful_truncated_html" | "streamed_limit" | "header_limit" | "declared_limit";

/** Safe acquisition metadata (never content). bytes/truncated are null
 * when the fetch failed. */
export interface BrandFetchMeta {
  redirects: number;
  bytes: number | null;
  truncated: boolean | null;
  size: BrandHtmlSize | null;
  /** The server declared a Content-Length over the old 1 MB limit. */
  declaredSizeExceededOldLimit: boolean | null;
}

const SIZE_LIMIT: Record<SafeFetchSizeLimit, BrandHtmlSize> = {
  declared: "declared_limit",
  streamed: "streamed_limit",
  headers: "header_limit",
};

/** A successful extraction (the unit the public cache memoizes). */
export interface BrandWebsiteExtraction {
  profile: ExtractedBrandProfile;
  /** The post-redirect page URL. */
  finalUrl: string;
}

export type BrandWebsiteFetchResult =
  | { ok: true; extraction: BrandWebsiteExtraction; fetch: BrandFetchMeta }
  | { ok: false; code: SafeFetchFailure | "no_metadata"; fetch: BrandFetchMeta };

function hasAnyField(p: ExtractedBrandProfile): boolean {
  return Boolean(p.name || p.shortDescription || p.instagramHandle || p.city || p.state || p.categorySlug);
}

/** One safe fetch, then deterministic extraction. A thrown fetchHtml
 * propagates (the real safeFetchHtml never throws). */
export async function fetchBrandWebsite(
  fetchUrl: URL,
  deps: { fetchHtml: (url: URL) => Promise<SafeFetchResult> }
): Promise<BrandWebsiteFetchResult> {
  const fetched = await deps.fetchHtml(fetchUrl);
  const fetch: BrandFetchMeta = {
    redirects: fetched.redirects,
    bytes: null,
    truncated: null,
    size: null,
    declaredSizeExceededOldLimit: fetched.declaredBytes != null ? fetched.declaredBytes > SAFE_FETCH_MAX_BYTES : null,
  };
  if (!fetched.ok) {
    if (fetched.limit) fetch.size = SIZE_LIMIT[fetched.limit];
    return { ok: false, code: fetched.code, fetch };
  }
  fetch.bytes = fetched.bytes;
  fetch.truncated = fetched.truncated;
  fetch.size = fetched.truncated ? "successful_truncated_html" : "complete_html";
  let profile: ExtractedBrandProfile;
  try {
    profile = extractBrandProfile(fetched.html, fetched.url);
  } catch {
    return { ok: false, code: "no_metadata", fetch };
  }
  if (!hasAnyField(profile)) return { ok: false, code: "no_metadata", fetch };
  return { ok: true, extraction: { profile, finalUrl: fetched.url.href }, fetch };
}

/** Which identity fields deterministic extraction found (booleans only). */
export type BrandProfileFields = Record<"name" | "description" | "about" | "instagram" | "city" | "state" | "category" | "logo" | "cover", boolean>;

export function brandProfileFields(profile: ExtractedBrandProfile): BrandProfileFields {
  return {
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
}

// ── Stage 3: match → AI → images → candidate ──────────────────────────────

/** The CURRENT (V1.1C) AI policy, unchanged: AI is needed when
 * deterministic extraction left the category, the short description OR
 * the About empty. A later phase may change this deliberately; this is
 * the single place it is decided. */
export function brandAiNeed(input: {
  deterministicCategoryId: string | null;
  shortDescription: string | null;
  aboutDescription: string | null;
}): boolean {
  return !input.deterministicCategoryId || !input.shortDescription || !input.aboutDescription;
}

/** Caller-supplied identity values that take precedence over the weaker
 * extracted equivalents (the public flow passes the visitor's validated
 * search seed). Already validated/normalized by the caller. */
export interface BrandIdentityOverrides {
  name?: string | null;
  /** A normalized Instagram handle. */
  instagram?: string | null;
}

/** The memoizable enrichment for one extraction: AI result + verified
 * image candidates. Contains no per-request usage. */
export interface BrandEnrichment {
  ai: BrandAiResult | null;
  aiStatus: "used" | "skipped" | "failed";
  logo: string | null;
  cover: string | null;
}

export interface BrandCandidateDeps {
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  listCategories: () => Promise<{ id: string; slug: string; name: string }[]>;
  /** One bounded AI enrichment (null result = keep deterministic). */
  enrich: (input: BrandAiInput) => Promise<BrandAiEnrichment>;
  /** Fetch + fully verify a logo/cover candidate. */
  verifyImage: (url: string, role: BrandImageRole) => Promise<boolean>;
}

export interface BrandCandidateOptions {
  /** Verify logo/cover candidates (public: only when signed drafts are
   * available). Off → both null, nothing fetched. */
  verifyImages: boolean;
  identity?: BrandIdentityOverrides | null;
  /** A previously computed enrichment for this same extraction: reused
   * as-is — no AI call, no image fetches, no new usage. */
  reuseEnrichment?: BrandEnrichment | null;
}

/** AI activity for THIS build. `called`/`usage` describe a request sent
 * to Anthropic now; a reused enrichment is never a new call. */
export interface BrandAiActivity {
  status: "used" | "skipped" | "failed";
  reused: boolean;
  called: boolean;
  usage: BrandAiUsage | null;
}

/** The proposed Brand — untrusted candidate values for human review. */
export interface BrandCandidateProposal {
  name: string | null;
  /** Submitted website (scheme added). */
  websiteUrl: string;
  /** Post-redirect page URL. */
  finalUrl: string;
  instagramHandle: string | null;
  instagramUrl: string | null;
  categoryId: string | null;
  shortDescription: string | null;
  about: string | null;
  city: string | null;
  state: string | null;
  /** Verified candidate URLs (still re-verified before any storage). */
  logoUrl: string | null;
  coverUrl: string | null;
}

export type BrandCandidateCompleteness = Record<"name" | "category" | "shortDescription" | "about" | "instagram" | "logo" | "cover", boolean>;

export type BrandCandidateBuild =
  /** Existing Business(es). publicMatch is the first public one, if any;
   * a non-public match must not be disclosed by a public caller. */
  | { status: "matched"; fields: BrandProfileFields; matches: BusinessMatch[]; publicMatch: BusinessMatch | null }
  | { status: "failed"; fields: BrandProfileFields; code: "match_failed" }
  | {
      status: "candidate";
      fields: BrandProfileFields;
      proposal: BrandCandidateProposal;
      completeness: BrandCandidateCompleteness;
      ai: BrandAiActivity;
      /** Memoizable by the caller (see BrandCandidateOptions.reuseEnrichment). */
      enrichment: BrandEnrichment;
    };

const instagramUrlOf = (handle: string | null | undefined) => (handle ? `https://www.instagram.com/${handle}` : null);

/** Matching, AI and images for one extraction. Never throws for a
 * failing dependency except a thrown findMatches (→ match_failed). */
export async function buildCandidateFromExtraction(
  website: PreparedBrandWebsite,
  extraction: BrandWebsiteExtraction,
  deps: BrandCandidateDeps,
  options: BrandCandidateOptions
): Promise<BrandCandidateBuild> {
  const { websiteUrl, host } = website;
  const { profile, finalUrl } = extraction;
  const fields = brandProfileFields(profile);
  const identity = options.identity ?? {};
  const name = identity.name ?? profile.name;
  const instagramHandle = identity.instagram ?? profile.instagramHandle;
  const instagramUrl = instagramUrlOf(instagramHandle);

  // Match with the strongest identity signals: the website + Instagram +
  // name/location (override first, else extracted), plus any extracted
  // name / Instagram an override replaced and the post-redirect website
  // when it is a different host — none of them may be a duplicate.
  let matches: BusinessMatch[];
  try {
    const finalHost = normalizeWebsiteHost(finalUrl);
    const lookups: Promise<BusinessMatch[]>[] = [
      deps.findMatches({ websiteUrl, instagramUrl, name, city: profile.city, state: profile.state }),
    ];
    if (finalHost && finalHost !== host) lookups.push(deps.findMatches({ websiteUrl: finalUrl }));
    if (identity.instagram && profile.instagramHandle && profile.instagramHandle !== identity.instagram) {
      lookups.push(deps.findMatches({ instagramUrl: instagramUrlOf(profile.instagramHandle) }));
    }
    if (identity.name && profile.name && profile.name !== identity.name) {
      lookups.push(deps.findMatches({ name: profile.name, city: profile.city, state: profile.state }));
    }
    matches = (await Promise.all(lookups)).flat();
  } catch {
    return { status: "failed", fields, code: "match_failed" };
  }
  if (matches.length > 0) return { status: "matched", fields, matches, publicMatch: matches.find((m) => m.isPublic) ?? null };

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

  // Enrichment: the bounded AI call only when brandAiNeed says so, and
  // (when enabled) the logo/cover candidates fetched and fully verified,
  // in parallel — or a previous enrichment of this extraction, reused.
  let enrichment = options.reuseEnrichment ?? null;
  let ai: BrandAiActivity;
  if (enrichment) {
    ai = { status: enrichment.aiStatus, reused: true, called: false, usage: null };
  } else {
    const needsAi = brandAiNeed({
      deterministicCategoryId,
      shortDescription: profile.shortDescription,
      aboutDescription: profile.aboutDescription,
    });
    const verify = async (url: string | null, role: BrandImageRole) => {
      if (!options.verifyImages || !url) return null;
      try {
        return (await deps.verifyImage(url, role)) ? url : null;
      } catch {
        return null;
      }
    };
    const [enriched, logo, cover] = await Promise.all([
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
    const result = enriched?.result ?? null;
    const aiStatus = !needsAi ? "skipped" : result ? "used" : "failed";
    enrichment = { ai: result, aiStatus, logo, cover };
    ai = { status: aiStatus, reused: false, called: enriched?.called ?? false, usage: enriched?.usage ?? null };
  }

  const aiResult = enrichment.ai;
  const proposal: BrandCandidateProposal = {
    name,
    websiteUrl,
    finalUrl,
    instagramHandle,
    instagramUrl,
    categoryId: deterministicCategoryId ?? aiResult?.categoryId ?? null,
    shortDescription: profile.shortDescription ?? aiResult?.shortDescription ?? null,
    about: profile.aboutDescription ?? aiResult?.about ?? null,
    city: profile.city,
    state: profile.state,
    logoUrl: enrichment.logo,
    coverUrl: enrichment.cover,
  };
  const completeness: BrandCandidateCompleteness = {
    name: Boolean(proposal.name),
    category: Boolean(proposal.categoryId),
    shortDescription: Boolean(proposal.shortDescription),
    about: Boolean(proposal.about),
    instagram: Boolean(proposal.instagramHandle),
    logo: Boolean(proposal.logoUrl),
    cover: Boolean(proposal.coverUrl),
  };
  return { status: "candidate", fields, proposal, completeness, ai, enrichment };
}

// ── Whole pipeline (no cache) ─────────────────────────────────────────────

export type BrandCandidateResult =
  | { status: "rejected"; code: "invalid_input" | "unsupported_site"; host: string | null }
  | { status: "failed"; code: SafeFetchFailure | "no_metadata"; website: PreparedBrandWebsite; fetch: BrandFetchMeta }
  | (BrandCandidateBuild & { website: PreparedBrandWebsite; fetch: BrandFetchMeta });

/** Website → candidate, all stages in order, for callers that bring no
 * cache or fetch slot of their own (they bound concurrency themselves). */
export async function buildBrandCandidate(
  raw: string,
  deps: BrandCandidateDeps & { fetchHtml: (url: URL) => Promise<SafeFetchResult> },
  options: BrandCandidateOptions
): Promise<BrandCandidateResult> {
  const prepared = prepareBrandWebsite(raw);
  if (!prepared.ok) return { status: "rejected", code: prepared.code, host: prepared.host };
  const { website } = prepared;
  const fetched = await fetchBrandWebsite(website.fetchUrl, deps);
  if (!fetched.ok) return { status: "failed", code: fetched.code, website, fetch: fetched.fetch };
  const built = await buildCandidateFromExtraction(website, fetched.extraction, deps, options);
  return { ...built, website, fetch: fetched.fetch };
}
