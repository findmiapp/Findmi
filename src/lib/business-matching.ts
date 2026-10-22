import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Brand Onboarding V1 · Pass 1 — the ONE Business matching foundation:
 * "Does this Business already exist on Findmi?"
 *
 * Server-only infrastructure. It never establishes ownership — finding
 * example.com never means "this user owns Example"; ownership stays with
 * create_owned_business (new rows) and the admin-approved claim flow
 * (business_claim_requests → approve_business_claim → business_members).
 * It reads with whichever already-authorized service-role client its
 * caller holds and performs no authorization of its own (same contract as
 * lib/locationCreation.ts's findLikelyDuplicateLocations, its sibling for
 * Locations). Deliberately Business-only: Location / Event / Appearance
 * matching stay in their own modules.
 *
 * Signals, strongest first (each deterministic, none fuzzy):
 *   1. website — same canonical website host (normalizeWebsiteHost), or the
 *      same exact account path on a shared platform (normalizeWebsiteIdentity);
 *   2. instagram — same canonical Instagram handle (normalizeInstagramHandle);
 *   3. name_location — same normalized name (normalizeBusinessName) AND a
 *      compatible location (isLocationCompatible). */

// ── Website ───────────────────────────────────────────────────────────────

/** Hosts that many unrelated businesses share (social/link-in-bio/
 * marketplace platforms, where identity lives in the PATH). Two businesses
 * whose "website" is instagram.com/a and instagram.com/b are NOT the same,
 * so these hosts are never a website identity. */
const SHARED_PLATFORM_HOSTS = new Set([
  "instagram.com",
  "m.instagram.com",
  "instagr.am",
  "facebook.com",
  "fb.com",
  "m.facebook.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "pinterest.com",
  "threads.net",
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "linkin.bio",
  "campsite.bio",
  "etsy.com",
  "amazon.com",
  "yelp.com",
  "google.com",
  "sites.google.com",
  "maps.google.com",
  "goo.gl",
  "bit.ly",
  "eventbrite.com",
  "lu.ma",
  "partiful.com",
]);

/** Canonical website identity: the lowercase host, with a single leading
 * "www." removed. Scheme (http/https), port, path, query, fragment and
 * trailing slashes are ignored — they don't change WHOSE site it is.
 * Other subdomains are kept as-is (shop.example.com ≠ example.com ≠
 * events.example.com): unrelated parties can share a parent domain, so
 * collapsing them would create false matches. Returns null for empty or
 * malformed input, non-http(s) schemes, URLs with userinfo, hosts without
 * a dot (localhost), raw IP addresses and SHARED_PLATFORM_HOSTS. */
export function normalizeWebsiteHost(input: string | null | undefined): string | null {
  const parsed = parseWebsite(input);
  return parsed && !SHARED_PLATFORM_HOSTS.has(parsed.host) ? parsed.host : null;
}

/** The website signal used for matching. A normal site is its canonical
 * host (normalizeWebsiteHost). On a SHARED platform the account lives in
 * the path, so the identity is host + lowercase path without trailing
 * slashes, query or fragment ("linktr.ee/brand", "etsy.com/shop/brand") —
 * an exact-path match, never the bare platform host. Instagram URLs are
 * handled by the Instagram signal instead (null here). */
export function normalizeWebsiteIdentity(input: string | null | undefined): string | null {
  const parsed = parseWebsite(input);
  if (!parsed) return null;
  if (!SHARED_PLATFORM_HOSTS.has(parsed.host)) return parsed.host;
  if (INSTAGRAM_HOSTS.has(parsed.host)) return null;
  const path = parsed.url.pathname.toLowerCase().replace(/\/+$/, "");
  return path ? `${parsed.host}${path}` : null;
}

function parseWebsite(input: string | null | undefined): { host: string; url: URL } | null {
  const raw = (input ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Userinfo never belongs to a business site ("mailto:hi@example.com"
  // would otherwise parse as user "mailto" on host example.com).
  if (url.username || url.password) return null;
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((label) => !label)) return null;
  return { host, url };
}

// ── Instagram ─────────────────────────────────────────────────────────────

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"]);
/** First path segments that are Instagram pages, never a profile handle. */
const INSTAGRAM_RESERVED_PATHS = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "developer", "legal", "web"]);
const INSTAGRAM_HANDLE = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;

/** Canonical Instagram handle (lowercase, no "@") for input that is
 * EXPLICITLY Instagram data (an Instagram field). Accepts "@brand",
 * "brand", and instagram.com / www.instagram.com / instagr.am profile
 * URLs with or without scheme, trailing slash, query (?igsh=…, ?utm_…) or
 * fragment. Returns null for empty/malformed input, URLs on other hosts,
 * non-profile Instagram pages (/p/…, /reel/…) and anything that isn't a
 * valid handle (spaces, illegal characters, > 30 chars). Free-form text is
 * never coerced into a handle. */
export function normalizeInstagramHandle(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  let candidate: string;
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(www\.|m\.)?instagr(\.am|am\.com)(\/|$)/i.test(raw) || raw.includes("/");
  if (looksLikeUrl) {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;
    const segment = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!segment || INSTAGRAM_RESERVED_PATHS.has(segment.toLowerCase())) return null;
    candidate = segment;
  } else {
    candidate = raw.replace(/^@/, "");
  }
  const handle = candidate.toLowerCase();
  return INSTAGRAM_HANDLE.test(handle) ? handle : null;
}

/** The Instagram handle a WEBSITE field reveals, when it is an Instagram
 * profile URL (some businesses list Instagram as their only site). Plain
 * domains never count — only an explicit instagram.com/instagr.am URL. */
function instagramHandleFromWebsite(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  return /instagr(\.am|am\.com)/i.test(raw) ? normalizeInstagramHandle(raw) : null;
}

// ── Name + location ───────────────────────────────────────────────────────

/** Conservative, Unicode-aware name normalization:
 *   1. Unicode NFKC (composed accents; full-width / compatibility forms
 *      folded: "ＣＡＦＥ" → "CAFE", decomposed "e\u0301" → "é");
 *   2. toLowerCase() (locale-independent; scripts without case unchanged);
 *   3. every run of characters that are not a Unicode letter, number or
 *      combining mark (\p{L}\p{N}\p{M}) collapses to one space; trimmed.
 * "Joe's  Pizza!" → "joe s pizza"; "Café Findmi" → "café findmi";
 * "東京珈琲" → "東京珈琲"; "Кофе" → "кофе". Letters and diacritics are kept
 * as written — no transliteration ("Café" ≠ "Cafe"), no cross-script or
 * look-alike folding, no fuzzy/edit-distance matching: similar names are
 * never treated as the same Business. */
export function normalizeBusinessName(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}

/** The normalized name's tokens (Unicode letters/numbers/marks only). */
function nameTokens(value: string | null | undefined): string[] {
  return normalizeBusinessName(value).split(" ").filter(Boolean);
}

/** Precise candidate filter for the name signal (exported for tests): a
 * case-insensitive POSIX regex (PostgREST `imatch`, Postgres `~*`) that
 * matches a stored name ONLY when its token sequence is exactly the
 * input's, allowing any punctuation/space between, before and after:
 *   ^[^[:alnum:]]*joe[^[:alnum:]]+s[^[:alnum:]]+pizza[^[:alnum:]]*$
 * Tokens contain only Unicode letters/numbers/marks, none of which are
 * regex metacharacters, so user input can't alter the pattern. Sent as its
 * own filter (never inside an or() expression). */
export function buildExactNameRegex(name: string | null | undefined): string | null {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return null;
  return `^[^[:alnum:]]*${tokens.join("[^[:alnum:]]+")}[^[:alnum:]]*$`;
}

/** Location compatibility (unchanged from the original member duplicate
 * check): city is compatible when either side has no city or both
 * normalize equal; state likewise; both must be compatible. Missing data
 * never blocks a match, but two different known cities (or states) do. */
export function isLocationCompatible(
  a: { city: string | null | undefined; state: string | null | undefined },
  b: { city: string | null | undefined; state: string | null | undefined }
): boolean {
  const same = (x: string | null | undefined, y: string | null | undefined) =>
    !x || !y || normalizeBusinessName(x) === normalizeBusinessName(y);
  return same(a.city, b.city) && same(a.state, b.state);
}

// ── Matching ──────────────────────────────────────────────────────────────

export type BusinessMatchReason = "website" | "instagram" | "name_location";
const REASON_RANK: Record<BusinessMatchReason, number> = { website: 0, instagram: 1, name_location: 2 };

export interface BusinessMatchInput {
  name?: string | null;
  city?: string | null;
  state?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
}

export interface BusinessMatchCandidateRow {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
  instagram_url: string | null;
  publication_status: string | null;
  archived_at: string | null;
  trashed_at: string | null;
}

export interface BusinessMatch {
  id: string;
  slug: string;
  name: string;
  /** Every signal this candidate matched on, strongest first. */
  reasons: BusinessMatchReason[];
  /** Publicly visible (live, not archived/trashed). Non-public matches
   * still block duplicate creation, but callers must not reveal their
   * name/slug to the visitor. */
  isPublic: boolean;
}

export const BUSINESS_MATCH_CANDIDATE_QUERY_LIMIT = 200;
export const BUSINESS_MATCH_RESULT_LIMIT = 5;

interface NormalizedInput {
  host: string | null;
  handle: string | null;
  name: string;
  city: string | null;
  state: string | null;
}

function normalizeInput(input: BusinessMatchInput): NormalizedInput {
  return {
    host: normalizeWebsiteIdentity(input.websiteUrl),
    handle: normalizeInstagramHandle(input.instagramUrl) ?? instagramHandleFromWebsite(input.websiteUrl),
    name: normalizeBusinessName(input.name),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
  };
}

/** `%tok%tok%` ilike pattern from [a-z0-9] tokens only — nothing a user
 * typed (commas, parentheses, quotes, %, _, backslashes, dots) can reach
 * the PostgREST or() expression or act as a LIKE wildcard. */
function tokenPattern(value: string): string | null {
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.length ? `%${tokens.join("%")}%` : null;
}

/** Same `%tok%tok%` shape for NAMES, from Unicode letter/number/mark
 * tokens (none of which are PostgREST or() reserved characters or LIKE
 * wildcards), so non-Latin names still narrow in the database. */
function namePattern(value: string): string | null {
  const tokens = nameTokens(value);
  return tokens.length ? `%${tokens.join("%")}%` : null;
}

/** One bounded or() filter PER SIGNAL (exported for tests) — queried
 * separately so a broad name pattern ("cafe") can never crowd a strong
 * website/Instagram candidate out of the row limit. Every value is
 * tokenPattern() output, so each expression is injection-safe; the final
 * decision is always the exact normalized comparison in
 * rankBusinessMatches, never the ilike. */
export function buildBusinessCandidateFilters(input: BusinessMatchInput): string[] {
  const n = normalizeInput(input);
  const filters: string[] = [];
  const host = n.host ? tokenPattern(n.host) : null;
  if (host) filters.push(`website_url.ilike.${host}`);
  const handle = n.handle ? tokenPattern(n.handle) : null;
  if (handle) filters.push(`instagram_url.ilike.${handle},website_url.ilike.${handle}`);
  const name = n.name ? namePattern(n.name) : null;
  if (name) filters.push(`name.ilike.${name}`);
  return filters;
}

/** Pure, deterministic ranking (exported for tests). A row matches when
 * any signal agrees exactly after normalization; candidates are ordered
 * by strongest reason (website > instagram > name_location), then number
 * of agreeing signals, then public before non-public, then slug. */
export function rankBusinessMatches(
  input: BusinessMatchInput,
  rows: BusinessMatchCandidateRow[],
  limit: number = BUSINESS_MATCH_RESULT_LIMIT
): BusinessMatch[] {
  const n = normalizeInput(input);
  const matches: BusinessMatch[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const reasons: BusinessMatchReason[] = [];
    if (n.host && normalizeWebsiteIdentity(row.website_url) === n.host) reasons.push("website");
    if (
      n.handle &&
      (normalizeInstagramHandle(row.instagram_url) === n.handle || instagramHandleFromWebsite(row.website_url) === n.handle)
    ) {
      reasons.push("instagram");
    }
    if (n.name && normalizeBusinessName(row.name) === n.name && isLocationCompatible(n, row)) reasons.push("name_location");
    if (reasons.length === 0) continue;
    matches.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      reasons,
      isPublic: row.publication_status === "live" && !row.archived_at && !row.trashed_at,
    });
  }
  matches.sort(
    (a, b) =>
      REASON_RANK[a.reasons[0]] - REASON_RANK[b.reasons[0]] ||
      b.reasons.length - a.reasons.length ||
      Number(b.isPublic) - Number(a.isPublic) ||
      a.slug.localeCompare(b.slug)
  );
  return matches.slice(0, limit);
}

/** The strongest match this user already belongs to, or null. A match the
 * signed-in creator already owns is their own Business — most often the one
 * an earlier submit of the same form just created (a double tap, or a
 * resubmit after the transition looked like a failure) — so creation lands
 * on it instead of making a second one or telling its owner to contact
 * Findmi. `matches` keeps findBusinessMatches' order. */
export function ownedBusinessMatch<M extends Pick<BusinessMatch, "id">>(matches: readonly M[], ownedBusinessIds: Iterable<string>): M | null {
  const owned = new Set(ownedBusinessIds);
  return matches.find((m) => owned.has(m.id)) ?? null;
}

/** "Does this Business already exist on Findmi?" — ranked candidates
 * (strongest first, at most BUSINESS_MATCH_RESULT_LIMIT), each with its
 * match reasons and whether it is public. Demo rows are never candidates;
 * every real row — live, pending_review, draft, paused, rejected,
 * archived, trashed — is, so a business still in review (or hidden) can't
 * be created a second time. Reads a few bounded, targeted queries (never
 * the whole table):
 *   - one per signal (website / Instagram / name `%tok%tok%` ilike);
 *   - for names, ALSO a precise anchored-regex query (buildExactNameRegex)
 *     returning only names whose exact token sequence matches, so an exact
 *     name candidate never depends on falling inside the broad ilike
 *     query's row window. The broad query stays as a safety net for stored
 *     names the database regex can't see as equal (e.g. different Unicode
 *     composition) — ranking decides exactly either way. */
export async function findBusinessMatches(admin: SupabaseClient, input: BusinessMatchInput): Promise<BusinessMatch[]> {
  const filters = buildBusinessCandidateFilters(input);
  const exactName = buildExactNameRegex(input.name);
  if (filters.length === 0 && !exactName) return [];
  const base = () =>
    admin
      .from("businesses")
      .select("id, slug, name, city, state, website_url, instagram_url, publication_status, archived_at, trashed_at")
      .eq("is_demo", false);
  const results = await Promise.all([
    ...filters.map((filter) => base().or(filter).order("id", { ascending: true }).limit(BUSINESS_MATCH_CANDIDATE_QUERY_LIMIT)),
    ...(exactName
      ? [base().filter("name", "imatch", exactName).order("id", { ascending: true }).limit(BUSINESS_MATCH_CANDIDATE_QUERY_LIMIT)]
      : []),
  ]);
  const rows = results.flatMap(({ data }) => (data ?? []) as BusinessMatchCandidateRow[]);
  return rankBusinessMatches(input, rows);
}
