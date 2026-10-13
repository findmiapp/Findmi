import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

/** Brand Onboarding V1.1C — the short-lived, signed Brand Identity draft
 * that carries the enriched candidate from website analysis to Review
 * Your Brand and creation (one active draft per browser).
 *
 * Trust model:
 *   - HMAC-SHA256 with BRAND_DRAFT_SECRET (server-only, dedicated, ≥ 32
 *     chars). No secret → no draft is ever created or accepted; callers
 *     fall back to the bounded V1.1B text prefill.
 *   - Signed payload has an explicit version, expiry (≤ 30 min) and the
 *     generating user's id. The id is NOT authentication: every consumer
 *     gets the current user from Supabase auth itself and rejects a draft
 *     signed for anyone else.
 *   - The draft grants nothing. It holds only public brand-identity
 *     candidates; the strict schema has no field for ownership, plan,
 *     invite, market, publication, membership or authorization.
 *   - The only thing a consumer trusts it for is WHICH remote logo/cover
 *     URL was analysed (so the browser can't substitute one). Editable
 *     text always comes from the submitted form, and every image is
 *     re-fetched and re-validated before preview or storage.
 *   - Contents are never logged. */

export const BRAND_DRAFT_COOKIE = "findmi_brand_draft";
export const BRAND_DRAFT_COOKIE_PATH = "/account/business";
export const BRAND_DRAFT_VERSION = 1;
export const BRAND_DRAFT_TTL_MS = 30 * 60 * 1000;
export const BRAND_DRAFT_MAX_TOKEN_CHARS = 3600;
const CLOCK_SKEW_MS = 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const DOMAIN = "findmi-brand-draft";

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

const stagedPath = z.string().regex(/^brand-drafts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/);

const websiteUrl = z
  .string()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
    } catch {
      return false;
    }
  });

/** The complete signed payload. `.strict()` — any other key is rejected. */
const BrandDraftSchema = z
  .object({
    v: z.literal(BRAND_DRAFT_VERSION),
    uid: z.string().min(1).max(64),
    exp: z.number().int().positive(),
    site: websiteUrl,
    name: z.string().min(1).max(200).optional(),
    cat: z.string().uuid().optional(),
    sd: z.string().min(1).max(160).optional(),
    about: z.string().min(1).max(600).optional(),
    ig: z.string().regex(/^[a-z0-9._]{1,30}$/).optional(),
    city: z.string().min(1).max(80).optional(),
    state: z.string().min(1).max(40).optional(),
    logo: httpsUrl(1024).optional(),
    cover: httpsUrl(1024).optional(),
    /** VCL A3 recovery — the verified candidate's staged copy in Findmi
     * storage (brand-drafts/<uid>/<uuid>.<ext>); re-checked on every use. */
    logoStaged: stagedPath.optional(),
    coverStaged: stagedPath.optional(),
  })
  .strict();

export type BrandDraft = z.infer<typeof BrandDraftSchema>;

/** What analysis puts in a draft (everything except v/uid/exp). */
export interface BrandDraftCandidate {
  site: string;
  name?: string | null;
  cat?: string | null;
  sd?: string | null;
  about?: string | null;
  ig?: string | null;
  city?: string | null;
  state?: string | null;
  logo?: string | null;
  cover?: string | null;
  logoStaged?: string | null;
  coverStaged?: string | null;
}

/** When a draft is too large, optional fields are dropped in this fixed
 * order (never truncated): About, cover, logo, short description. */
export const BRAND_DRAFT_DROP_ORDER = ["about", "cover", "logo", "sd"] as const;

/** VCL A3 recovery — validates each optional field on its own and DROPS
 * only the invalid ones (reported in `dropped`), instead of discarding the
 * whole draft — which used to silently lose every image and the About
 * whenever any single field (e.g. a long CDN image URL) failed. */
const CANDIDATE_KEYS = new Set(["site", "name", "cat", "sd", "about", "ig", "city", "state", "logo", "cover", "logoStaged", "coverStaged"]);
export function sanitizeBrandDraftCandidate(candidate: BrandDraftCandidate): { clean: Record<string, unknown>; dropped: string[]; unknown: string[] } {
  const shape = BrandDraftSchema.shape as Record<string, z.ZodTypeAny>;
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(candidate)) {
    if (!CANDIDATE_KEYS.has(key)) {
      unknown.push(key);
      continue;
    }
    if (value === null || value === undefined || value === "") continue;
    if (shape[key].safeParse(value).success) clean[key] = value;
    else dropped.push(key);
  }
  return { clean, dropped, unknown };
}

export function getBrandDraftSecret(): string | null {
  const secret = process.env.BRAND_DRAFT_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`${DOMAIN}.v${BRAND_DRAFT_VERSION}.${body}`).digest("base64url");
}

function encode(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(secret, body)}`;
}

/** Signs a draft for `userId`, or null (no secret, invalid candidate, or
 * still too large after the documented drops). */
export function signBrandDraft(
  candidate: BrandDraftCandidate,
  userId: string,
  now: number,
  secret: string | null
): string | null {
  if (!secret || !userId) return null;
  const { clean, unknown } = sanitizeBrandDraftCandidate(candidate);
  // An unknown key (e.g. anything authority-bearing) is never signed: the
  // whole draft is refused. Only invalid VALUES of known optional fields
  // are dropped.
  if (unknown.length) return null;
  const payload: Record<string, unknown> = { v: BRAND_DRAFT_VERSION, uid: userId, exp: now + BRAND_DRAFT_TTL_MS, ...clean };
  if (!BrandDraftSchema.safeParse(payload).success) return null;
  let token = encode(payload, secret);
  for (const key of BRAND_DRAFT_DROP_ORDER) {
    if (token.length <= BRAND_DRAFT_MAX_TOKEN_CHARS) break;
    delete payload[key];
    token = encode(payload, secret);
  }
  return token.length <= BRAND_DRAFT_MAX_TOKEN_CHARS ? token : null;
}

/** Verifies signature, schema, version, expiry and user binding. Any
 * failure → null (the caller then behaves as if there were no draft). */
export function verifyBrandDraft(
  token: string | null | undefined,
  userId: string | null | undefined,
  now: number,
  secret: string | null
): BrandDraft | null {
  if (!secret || !userId || !token || token.length > BRAND_DRAFT_MAX_TOKEN_CHARS) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  const [, body, sig] = match;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = BrandDraftSchema.safeParse(parsed);
  if (!result.success) return null;
  const draft = result.data;
  if (draft.exp <= now || draft.exp > now + BRAND_DRAFT_TTL_MS + CLOCK_SKEW_MS) return null;
  if (draft.uid !== userId) return null;
  return draft;
}

export function brandDraftCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: BRAND_DRAFT_COOKIE_PATH,
    maxAge: BRAND_DRAFT_TTL_MS / 1000,
  };
}

// ── Request-bound helpers (Server Actions / Server Components) ─────────

/** Sets (replacing any previous) draft. Server Actions only. */
export async function writeBrandDraftCookie(token: string): Promise<void> {
  (await cookies()).set(BRAND_DRAFT_COOKIE, token, brandDraftCookieOptions());
}

/** Clears the draft. Server Actions only. */
export async function clearBrandDraftCookie(): Promise<void> {
  (await cookies()).set(BRAND_DRAFT_COOKIE, "", { ...brandDraftCookieOptions(), maxAge: 0 });
}

/** Reads + verifies the draft for the CURRENT authenticated user (the
 * caller passes the id it got from Supabase auth itself). */
export async function readBrandDraft(currentUserId: string | null | undefined): Promise<BrandDraft | null> {
  const token = (await cookies()).get(BRAND_DRAFT_COOKIE)?.value;
  return verifyBrandDraft(token, currentUserId, Date.now(), getBrandDraftSecret());
}
