import "server-only";
import { normalizeWebsiteHost, type BusinessMatch, type BusinessMatchInput } from "./business-matching";
import { classifyBrandInput } from "./brand-lookup";
import { extractBrandProfile, sameImageSource, type ExtractedBrandProfile } from "./brand-website-extract";
import { SAFE_FETCH_MAX_BYTES, type SafeFetchFailure, type SafeFetchResult, type SafeFetchSizeLimit } from "./safe-fetch";
import type { BrandAiEnrichment, BrandAiInput, BrandAiResult, BrandAiUsage } from "./brand-ai-enrichment";
import type { BrandImageRole } from "./brand-images";
import type { InstagramDiscovery, InstagramDiscoveryInput, InstagramDiscoveryResult, InstagramDiscoveryStatus, InstagramDiscoveryUsage } from "./brand-instagram-discovery";

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
  /** Diagnostics only: last HTTP status, media type and host seen. */
  status?: number | null;
  contentType?: string | null;
  finalHost?: string | null;
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
    fetch.status = fetched.status ?? null;
    fetch.contentType = fetched.contentType ?? null;
    fetch.finalHost = fetched.host ?? null;
    return { ok: false, code: fetched.code, fetch };
  }
  fetch.status = 200;
  fetch.contentType = fetched.contentType ?? null;
  fetch.finalHost = fetched.url.hostname;
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

/** The AI policy (Brand Candidate Quality pass): the one bounded AI call
 * runs only when deterministic extraction left the CATEGORY or a usable
 * neutral SHORT DESCRIPTION missing. About is optional — a missing About
 * alone never pays for a call (when the call does run for category or
 * short description, it may still return an About). Shared by the public
 * Brand Builder and Admin Brand Import; the single place it is decided. */
export function brandAiNeed(input: { deterministicCategoryId: string | null; shortDescription: string | null }): boolean {
  return !input.deterministicCategoryId || !input.shortDescription;
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
  /** VCL A3b — the search-fallback Instagram verdict (memoized so a site is
   * never searched twice within the cache lifetime). Absent → no search ran. */
  instagram?: InstagramDiscoveryResult | null;
}

export interface BrandCandidateDeps {
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  listCategories: () => Promise<{ id: string; slug: string; name: string }[]>;
  /** One bounded AI enrichment (null result = keep deterministic). */
  enrich: (input: BrandAiInput) => Promise<BrandAiEnrichment>;
  /** Fetch + fully verify a logo/cover candidate. */
  verifyImage: (url: string, role: BrandImageRole) => Promise<boolean>;
  /** VCL A3 — a site's web app manifest → its ranked identity icon URLs
   * (safe fetch + manifestIconCandidates). Optional; [] on any failure. */
  fetchManifestIcons?: (manifestUrl: string) => Promise<string[]>;
  /** VCL A3b — one bounded, verified Instagram search. Provided only when
   * paid search is explicitly enabled; absent → never searched. */
  discoverInstagram?: (input: InstagramDiscoveryInput) => Promise<InstagramDiscovery>;
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
  /** VCL A3b — this invocation's Instagram search, if one ran (telemetry). */
  instagramSearch?: { status: InstagramDiscoveryStatus; called: boolean; usage: InstagramDiscoveryUsage | null } | null;
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

/** At most this many ranked candidates per role are fetched + verified
 * (in parallel); the highest-ranked one that passes is used. */
export const BRAND_IMAGE_VERIFY_MAX = 3;

/** The best VERIFIED candidate of a ranked pool, or null: the first
 * BRAND_IMAGE_VERIFY_MAX candidates (minus `exclude`) are verified in
 * parallel and the highest-ranked pass wins. Missing beats wrong — a pool
 * with no verified candidate yields none. Exported for tests. */
export async function selectVerifiedImage(
  ranked: readonly string[],
  role: BrandImageRole,
  verifyImage: BrandCandidateDeps["verifyImage"],
  exclude: string | null = null
): Promise<string | null> {
  const pool = ranked.filter((url) => !sameImageSource(url, exclude)).slice(0, BRAND_IMAGE_VERIFY_MAX);
  const passed = await Promise.all(
    pool.map(async (url) => {
      try {
        return await verifyImage(url, role);
      } catch {
        return false;
      }
    })
  );
  return pool.find((_, i) => passed[i]) ?? null;
}

/** VCL A3 — the identity (logo) choice: the page's own ranked candidates
 * first, exactly as before; ONLY when none of them verifies, the site's
 * web app manifest icons (an extra small fetch on the failure path only —
 * never when the page already supplied a usable identity). A cover is
 * never considered here. Exported for tests. */
export async function selectVerifiedLogo(
  logoPool: readonly string[],
  manifestUrl: string | null | undefined,
  deps: Pick<BrandCandidateDeps, "verifyImage" | "fetchManifestIcons">,
  svg: { candidates?: readonly string[]; strongCount?: number } = {}
): Promise<string | null> {
  // VCL A3c — with an SVG logo candidate, the order is: strong raster logos
  // → strong SVG logos (rasterized + verified in lib/brand-images) → the
  // touch/site icon candidates → manifest icons. Without one, exactly the
  // A3a behaviour. An SVG is only processed when no strong raster verified.
  const svgPool = (svg.candidates ?? []).slice(0, 2);
  let fromPage: string | null;
  if (svgPool.length === 0) {
    fromPage = await selectVerifiedImage(logoPool, "logo", deps.verifyImage);
  } else {
    const strongCount = Math.min(svg.strongCount ?? logoPool.length, logoPool.length);
    fromPage =
      (await selectVerifiedImage(logoPool.slice(0, strongCount), "logo", deps.verifyImage)) ??
      (await selectVerifiedImage(svgPool, "logo", deps.verifyImage)) ??
      (await selectVerifiedImage(logoPool.slice(strongCount), "logo", deps.verifyImage));
  }
  if (fromPage || !manifestUrl || !deps.fetchManifestIcons) return fromPage;
  let icons: string[];
  try {
    icons = await deps.fetchManifestIcons(manifestUrl);
  } catch {
    return null;
  }
  const fresh = icons.filter((url) => !logoPool.some((tried) => sameImageSource(tried, url)));
  return selectVerifiedImage(fresh, "logo", deps.verifyImage);
}

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
    const needsAi = brandAiNeed({ deterministicCategoryId, shortDescription: profile.shortDescription });
    // Ranked pools (an older extraction without pools → its single pick).
    const pool = (list: string[] | undefined, single: string | null) => (list && list.length ? list : single ? [single] : []);
    const logoPool = pool(profile.logoCandidates, profile.logoCandidateUrl);
    const coverPool = pool(profile.coverCandidates, profile.coverCandidateUrl);
    const images = options.verifyImages
      ? Promise.all([selectVerifiedLogo(logoPool, profile.manifestUrl, deps, { candidates: profile.svgLogoCandidates, strongCount: profile.logoStrongCount }), selectVerifiedImage(coverPool, "cover", deps.verifyImage)])
      : Promise.resolve<[string | null, string | null]>([null, null]);
    // VCL A3b — search ONLY when no Instagram exists from the visitor's own
    // seed or the page itself, and only on the enriched (signed-in, drafts)
    // path with search explicitly enabled. Runs in parallel; never blocks.
    const searchInstagram = Boolean(options.verifyImages && deps.discoverInstagram && !instagramHandle);
    const discovery = searchInstagram
      ? deps.discoverInstagram!({ name, host: website.host }).catch(
          (): InstagramDiscovery => ({ result: { handle: null, confidence: "none", status: "failed" }, called: true, usage: null })
        )
      : Promise.resolve<InstagramDiscovery | null>(null);
    const [enriched, verifiedImages, discovered] = await Promise.all([
      needsAi
        ? deps
            .enrich({ brandName: name, website: websiteUrl, excerpt: profile.excerpt, categories: categories.map((c) => ({ id: c.id, name: c.name })) })
            // enrichBrandWithAi never throws; an unexpected throw is
            // counted as a call with unknown usage, never as zero tokens.
            .catch((): BrandAiEnrichment => ({ result: null, called: true, usage: null }))
        : Promise.resolve<BrandAiEnrichment | null>(null),
      images,
      discovery,
    ]);
    // The cover is never the selected logo (pools already exclude every
    // logo candidate; this holds even for an older single-pick extraction).
    const [logo, verifiedCover] = verifiedImages;
    const cover = sameImageSource(logo, verifiedCover) ? null : verifiedCover;
    const result = enriched?.result ?? null;
    const aiStatus = !needsAi ? "skipped" : result ? "used" : "failed";
    enrichment = { ai: result, aiStatus, logo, cover, ...(discovered ? { instagram: discovered.result } : {}) };
    ai = {
      status: aiStatus,
      reused: false,
      called: enriched?.called ?? false,
      usage: enriched?.usage ?? null,
      ...(discovered ? { instagramSearch: { status: discovered.result.status, called: discovered.called, usage: discovered.usage } } : {}),
    };
  }

  const aiResult = enrichment.ai;
  // Deterministic Instagram always wins; a searched one only at HIGH confidence.
  const searchedHandle = enrichment.instagram?.confidence === "high" ? enrichment.instagram.handle : null;
  const proposedInstagram = instagramHandle ?? searchedHandle;
  const proposal: BrandCandidateProposal = {
    name,
    websiteUrl,
    finalUrl,
    instagramHandle: proposedInstagram,
    instagramUrl: instagramUrlOf(proposedInstagram),
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
