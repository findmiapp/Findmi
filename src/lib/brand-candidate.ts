import { normalizeInstagramHandle, normalizeWebsiteHost } from "./business-matching";

/** Brand Onboarding V1.1B — the ONE place a Business-creation candidate
 * becomes a /account/business/new URL. Every prefill link (the Find Your
 * Brand "Add" link and the website-analysis handoff) is built here.
 *
 * A candidate carries NO authority: it is public business information the
 * visitor could have typed, rendered into the existing create form for
 * review, and createMemberBusiness re-validates everything (including the
 * Business matcher) on submit. Only the whitelisted fields below can ever
 * be serialized; `authorized`, plan/Pro, invite, ref, market, publication
 * or membership state, ownership and any other id can't be expressed. */

export const BRAND_CANDIDATE_FIELDS = [
  "name",
  "website_url",
  "instagram_url",
  "short_description",
  "city",
  "state",
  "category_id",
] as const;
export type BrandCandidateField = (typeof BRAND_CANDIDATE_FIELDS)[number];
export type BrandCandidate = Partial<Record<BrandCandidateField, string>>;

export const SHORT_DESCRIPTION_MAX_LENGTH = 160;
const NAME_MAX = 200;
const WEBSITE_MAX = 300;
const CITY_MAX = 80;
const STATE_MAX = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Banner flag for the create form — a fixed enum, never extracted data:
 *   website     — fields were suggested from the visitor's website;
 *   unavailable — the website couldn't be read; manual entry;
 *   limited     — analysis was rate limited; manual entry;
 *   blocked     — the site deliberately doesn't let Findmi read it (a
 *                 refusal or a challenge page); manual entry. */
export const BRAND_PREFILL_STATUSES = ["website", "unavailable", "limited", "blocked"] as const;
export type BrandPrefillStatus = (typeof BRAND_PREFILL_STATUSES)[number];

export const CREATE_BUSINESS_PATH = "/account/business/new";

/** Presentation flag for the create form when it is reached from Brand
 * Onboarding (/join/brand): "Review Your Brand" copy, no Free/Pro picker,
 * and a Business Profile landing after creation. It carries NO authority —
 * it never sets a plan, grants anything or skips a check. Every URL built
 * by this module is a Brand Onboarding URL, so it always carries it. */
export const BRAND_SOURCE = "brand";

export function parseBrandSource(value: string | null | undefined): boolean {
  return value === BRAND_SOURCE;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

function plain(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

function website(value: unknown): string | null {
  const s = plain(value, WEBSITE_MAX);
  if (!s) return null;
  try {
    const url = new URL(s);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  } catch {
    return null;
  }
  return s;
}

/** Whitelist + per-field validation. Unknown keys are dropped; a field
 * that fails validation is dropped (never coerced into something else). */
export function sanitizeBrandCandidate(input: Record<string, unknown>): BrandCandidate {
  const out: BrandCandidate = {};
  const name = plain(input.name, NAME_MAX);
  if (name) out.name = name;
  const site = website(input.website_url);
  if (site) out.website_url = site;
  const handle = typeof input.instagram_url === "string" ? normalizeInstagramHandle(input.instagram_url) : null;
  if (handle) out.instagram_url = `https://www.instagram.com/${handle}`;
  const description = plain(input.short_description, SHORT_DESCRIPTION_MAX_LENGTH);
  if (description) out.short_description = description;
  const city = plain(input.city, CITY_MAX);
  if (city) out.city = city;
  const state = plain(input.state, STATE_MAX);
  if (state) out.state = state;
  if (typeof input.category_id === "string" && UUID.test(input.category_id)) out.category_id = input.category_id.toLowerCase();
  return out;
}

/** The create-form URL for a candidate (sanitized here, whatever the
 * caller passed) plus an optional banner flag. */
export function brandCandidateHref(candidate: Record<string, unknown>, prefill?: BrandPrefillStatus): string {
  const clean = sanitizeBrandCandidate(candidate);
  const params = new URLSearchParams();
  for (const field of BRAND_CANDIDATE_FIELDS) {
    const value = clean[field];
    if (value) params.set(field, value);
  }
  if (prefill && (BRAND_PREFILL_STATUSES as readonly string[]).includes(prefill)) params.set("prefill", prefill);
  params.set("source", BRAND_SOURCE);
  return `${CREATE_BUSINESS_PATH}?${params.toString()}`;
}

// ── Seeds ─────────────────────────────────────────────────────────────────

/** What the visitor originally searched for (a name or an Instagram
 * handle) when they then add a website on /join/brand. Bounded,
 * validated, and only ever re-serialized through this module; it
 * pre-fills the create form's name / Instagram, which stay editable. */
export interface BrandSeed {
  name?: string;
  /** Canonical handle, no "@". */
  instagram?: string;
}

export const BRAND_SEED_PARAMS = { name: "seed_name", instagram: "seed_instagram" } as const;

export function sanitizeBrandSeed(input: { name?: unknown; instagram?: unknown }): BrandSeed {
  const seed: BrandSeed = {};
  const name = plain(input.name, NAME_MAX);
  if (name) seed.name = name;
  const handle = typeof input.instagram === "string" ? normalizeInstagramHandle(input.instagram) : null;
  if (handle) seed.instagram = handle;
  return seed;
}

/** The seed as /join/brand query/form fields (only these two names). */
export function brandSeedEntries(seed: BrandSeed | null | undefined): [string, string][] {
  const clean = sanitizeBrandSeed(seed ?? {});
  const entries: [string, string][] = [];
  if (clean.name) entries.push([BRAND_SEED_PARAMS.name, clean.name]);
  if (clean.instagram) entries.push([BRAND_SEED_PARAMS.instagram, clean.instagram]);
  return entries;
}

/** Candidate fields a seed contributes to the create form. */
export function seedCandidate(seed: BrandSeed | null | undefined): { name?: string; instagram_url?: string } {
  const clean = sanitizeBrandSeed(seed ?? {});
  return {
    ...(clean.name ? { name: clean.name } : {}),
    ...(clean.instagram ? { instagram_url: `https://www.instagram.com/${clean.instagram}` } : {}),
  };
}

/** Parses the create form's `prefill` banner flag (unknown → null). */
export function parseBrandPrefillStatus(value: string | null | undefined): BrandPrefillStatus | null {
  return (BRAND_PREFILL_STATUSES as readonly string[]).includes(value ?? "") ? (value as BrandPrefillStatus) : null;
}

/** Display host for the create form's banner ("lavazza.com"), or null. */
export function prefillHostLabel(websiteUrl: string | null | undefined): string | null {
  return normalizeWebsiteHost(websiteUrl);
}
