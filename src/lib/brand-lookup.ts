import "server-only";
import { getSupabase } from "./supabase";
import { getAdminSupabase } from "./admin/supabase-admin";
import {
  findBusinessMatches,
  normalizeBusinessName,
  normalizeInstagramHandle,
  normalizeWebsiteIdentity,
  type BusinessMatch,
  type BusinessMatchInput,
} from "./business-matching";
import { brandCandidateHref, brandSeedEntries, seedCandidate, type BrandSeed } from "./brand-candidate";

/** Brand Onboarding V1 · Pass 2B — the server-only layer behind the public
 * /join/brand "Find Your Brand" page:
 *
 *   input → classify → normalize → Business matcher (lib/business-matching)
 *         → keep PUBLIC matches only → re-read approved display fields
 *           through the ordinary public (anon) path, live/non-demo only
 *         → narrow render model
 *
 * The raw matcher output (ids, reasons, publication state) never leaves
 * this module. There is no JSON API: the page renders the model on the
 * server. Matching never establishes ownership — a result only links into
 * the existing claim flow or the existing create flow, both of which
 * re-check everything themselves.
 *
 * Hidden-record rule: a non-public conflict is indistinguishable from "no
 * match" for anonymous visitors (same state, same fields). Only a
 * signed-in visitor with no public claim target gets the generic
 * "assistance" state — never any detail of the protected record. */

export const BRAND_QUERY_MIN_LENGTH = 2;
export const BRAND_QUERY_MAX_LENGTH = 200;
export const BRAND_PUBLIC_CANDIDATE_LIMIT = 5;

export type BrandInputKind = "website" | "instagram" | "name";

export type ClassifiedBrandInput =
  | { ok: true; kind: BrandInputKind; value: string; alternative: BrandInputKind | null }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "invalid"; kind: BrandInputKind | null };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const INSTAGRAM_HINT = /instagr(\.am|am\.com)/i;

function asKind(value: BrandInputKind, input: string): boolean {
  if (value === "instagram") return normalizeInstagramHandle(input) !== null;
  if (value === "website") return normalizeWebsiteIdentity(input) !== null;
  return normalizeBusinessName(input) !== "";
}

/** Deterministic classification — no AI, no network:
 *   1. `as=` override (website | instagram | name) when given and valid;
 *   2. Instagram — starts with "@" or mentions instagram.com / instagr.am;
 *   3. website — has a URL scheme, or is a single token with a dot that
 *      yields a website identity (lavazza.com, joe.coffee, linktr.ee/x);
 *   4. otherwise a Business name (must normalize to something).
 * A bare word is never treated as an Instagram handle unless the visitor
 * picks that interpretation. `alternative` is offered only when the input
 * is genuinely ambiguous (a dotted single token, or a single token that is
 * also a valid handle). */
export function classifyBrandInput(rawInput: string | null | undefined, as?: string | null): ClassifiedBrandInput {
  const value = (rawInput ?? "").trim();
  if (!value) return { ok: false, reason: "empty", kind: null };
  if (value.length < BRAND_QUERY_MIN_LENGTH) return { ok: false, reason: "too_short", kind: null };
  if (value.length > BRAND_QUERY_MAX_LENGTH) return { ok: false, reason: "too_long", kind: null };

  if (as === "website" || as === "instagram" || as === "name") {
    return asKind(as, value) ? { ok: true, kind: as, value, alternative: null } : { ok: false, reason: "invalid", kind: as };
  }

  if (value.startsWith("@") || INSTAGRAM_HINT.test(value)) {
    return asKind("instagram", value)
      ? { ok: true, kind: "instagram", value, alternative: null }
      : { ok: false, reason: "invalid", kind: "instagram" };
  }

  const singleToken = !/\s/.test(value);
  if (HAS_SCHEME.test(value)) {
    return asKind("website", value)
      ? { ok: true, kind: "website", value, alternative: null }
      : { ok: false, reason: "invalid", kind: "website" };
  }
  if (singleToken && value.includes(".") && asKind("website", value)) {
    return { ok: true, kind: "website", value, alternative: asKind("name", value) ? "name" : null };
  }

  if (!asKind("name", value)) return { ok: false, reason: "invalid", kind: "name" };
  return { ok: true, kind: "name", value, alternative: singleToken && asKind("instagram", value) ? "instagram" : null };
}

function matcherInput(input: { kind: BrandInputKind; value: string }): BusinessMatchInput {
  if (input.kind === "website") return { websiteUrl: input.value };
  if (input.kind === "instagram") return { instagramUrl: input.value };
  return { name: input.value };
}

/** The ONLY Business fields this feature ever renders — all already public
 * on /business/[slug]. No id, status, reason, website/social or contact. */
export interface PublicBrandCard {
  slug: string;
  name: string;
  logoUrl: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
}

export type BrandLookupResult =
  | { state: "strong"; candidates: PublicBrandCard[] }
  | { state: "possible"; candidates: PublicBrandCard[] }
  | { state: "none" }
  | { state: "assistance" };

export interface BrandLookupDeps {
  findMatches: (input: BusinessMatchInput) => Promise<BusinessMatch[]>;
  /** Re-reads display fields through the PUBLIC path for these slugs,
   * returning only rows that are live, non-demo, not archived/trashed. */
  readPublicCards: (slugs: string[]) => Promise<PublicBrandCard[]>;
}

/** Pure decision core (exported for tests). */
export async function lookupBrand(
  input: { kind: BrandInputKind; value: string },
  authenticated: boolean,
  deps: BrandLookupDeps
): Promise<BrandLookupResult> {
  const matches = await deps.findMatches(matcherInput(input));
  const publicSlugs = matches.filter((m) => m.isPublic).map((m) => m.slug);
  const bySlug = new Map((publicSlugs.length ? await deps.readPublicCards(publicSlugs) : []).map((c) => [c.slug, c]));
  // Matcher order (strongest first), and only what the public re-read
  // confirmed — a row the matcher thought public but the public path won't
  // show is treated as protected, never displayed.
  const candidates = publicSlugs
    .map((slug) => bySlug.get(slug))
    .filter((c): c is PublicBrandCard => Boolean(c))
    .slice(0, BRAND_PUBLIC_CANDIDATE_LIMIT);

  if (candidates.length > 0) return { state: input.kind === "name" ? "possible" : "strong", candidates };
  const protectedConflict = matches.length > 0;
  return protectedConflict && authenticated ? { state: "assistance" } : { state: "none" };
}

async function readPublicCardsViaAnon(slugs: string[]): Promise<PublicBrandCard[]> {
  const supabase = getSupabase();
  if (!supabase || slugs.length === 0) return [];
  const { data, error } = await supabase
    .from("businesses")
    .select("id, slug, name, logo_url, city, state")
    .in("slug", slugs)
    .eq("is_demo", false)
    .eq("publication_status", "live")
    .is("archived_at", null)
    .is("trashed_at", null);
  if (error) throw new Error("public brand re-read failed");
  const rows = (data ?? []) as { id: string; slug: string; name: string; logo_url: string | null; city: string | null; state: string | null }[];
  if (rows.length === 0) return [];
  const { data: catRows } = await supabase
    .from("business_categories")
    .select("business_id, categories!inner(name)")
    .eq("categories.kind", "business")
    .in("business_id", rows.map((r) => r.id));
  const categoryByBusiness = new Map<string, string>();
  for (const r of (catRows ?? []) as { business_id: string; categories: { name: string } | { name: string }[] | null }[]) {
    const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
    if (cat?.name && !categoryByBusiness.has(r.business_id)) categoryByBusiness.set(r.business_id, cat.name);
  }
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    logoUrl: r.logo_url,
    category: categoryByBusiness.get(r.id) ?? null,
    city: r.city,
    state: r.state,
  }));
}

/** The real dependencies: service-role matcher (server-only) + anon re-read. */
export function defaultBrandLookupDeps(): BrandLookupDeps | null {
  const admin = getAdminSupabase();
  if (!admin) return null;
  return { findMatches: (input) => findBusinessMatches(admin, input), readPublicCards: readPublicCardsViaAnon };
}

// ── Handoff links ─────────────────────────────────────────────────────────

/** Claim reuses the existing ClaimButton flow: its ?claim=1 reopens the
 * modal; guests go through /login (which carries `next` into signup and
 * the email-confirmation callback). */
export function claimHref(slug: string, authenticated: boolean): string {
  const target = `/business/${encodeURIComponent(slug)}?claim=1`;
  return authenticated ? target : `/login?next=${encodeURIComponent(target)}`;
}

/** Create reuses /account/business/new, whose form already prefills
 * name / website_url / instagram_url from the query string (and whose
 * createMemberBusiness re-checks duplicates on submit). Only the visitor's
 * own input is carried — never matcher data — and the URL itself is built
 * by the one candidate serializer (lib/brand-candidate.ts). Website values
 * are made absolute because the field is type="url"; Instagram becomes the
 * canonical profile URL. Middleware keeps the full query string through
 * /login → signup → auth callback. */
export function createHref(input: { kind: BrandInputKind; value: string }, seed?: BrandSeed | null): string {
  if (input.kind === "name") return brandCandidateHref({ name: input.value });
  if (input.kind === "website") {
    // A website reached from a name/Instagram search keeps that original
    // name/handle (bounded seed) for the form — never matcher data.
    return brandCandidateHref({ ...seedCandidate(seed), website_url: HAS_SCHEME.test(input.value) ? input.value : `https://${input.value}` });
  }
  return brandCandidateHref({ instagram_url: input.value });
}

/** Re-search link for an alternate interpretation of the same input. */
export function searchHref(value: string, as?: BrandInputKind, seed?: BrandSeed | null): string {
  const params = new URLSearchParams({ q: value });
  if (as) params.set("as", as);
  for (const [key, v] of brandSeedEntries(seed)) params.set(key, v);
  return `/join/brand?${params.toString()}`;
}
