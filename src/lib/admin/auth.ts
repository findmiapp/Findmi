import { cookies } from "next/headers";

/**
 * Founder-only admin auth — one shared password (ADMIN_PASSWORD), no
 * accounts, no roles. The session cookie is a signed
 * "<expiry>.<version>.<hmac>" value; the HMAC key is derived from
 * ADMIN_PASSWORD itself so no second secret needs to be configured. This
 * is intentionally the smallest thing that's still safe: a forged cookie
 * is infeasible without knowing the password, and the cookie is httpOnly
 * so client JS never touches it.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) rather than
 * node:crypto specifically because this file is imported from
 * src/middleware.ts, which runs on the Edge runtime — node:crypto isn't
 * available there, but Web Crypto works in both Edge and Node.
 *
 * ---------------------------------------------------------------------
 * Security Pass 5 — session revocation. Two independent knobs invalidate
 * every outstanding session, immediately and unconditionally regardless
 * of a token's remaining TTL:
 *
 *   1. Rotating ADMIN_PASSWORD — already true before this pass. The HMAC
 *      key is derived from it, so a token signed under the old password
 *      fails verification the moment the new one is deployed.
 *
 *   2. Rotating ADMIN_SESSION_VERSION (new, optional) — a counter baked
 *      into every signed token and explicitly compared against the
 *      current deployment's value on every verify. Bumping it (any
 *      change — "1" -> "2" is enough) invalidates every previously
 *      issued token outright, independent of ADMIN_PASSWORD. Leave it
 *      unset and nothing changes: it defaults to a stable constant.
 *      Must not contain a "." character (the token's field separator).
 *
 * Neither knob is something logout() can flip by itself: a Server Action
 * runs inside one request/response cycle with no mechanism to mutate a
 * Vercel environment variable at runtime, and this app deliberately has
 * NO database or in-memory session store to write a per-token revocation
 * record to either — an in-memory list would only ever cover the one
 * serverless instance that happened to handle the logout request, not the
 * others Vercel may route subsequent requests to, so it would be a false
 * promise of revocation rather than a real one (see Security Pass 3's
 * login-rate-limit report for the same constraint on this platform).
 *
 * So logout() does exactly what it did before this pass: delete the
 * browser's own cookie. That is real, immediate revocation of THIS
 * browser's copy — it is not, and cannot honestly be, revocation of a
 * copy that was already exfiltrated elsewhere. If that ever needs to
 * happen, rotate ADMIN_SESSION_VERSION (or ADMIN_PASSWORD) instead:
 * either one invalidates every outstanding session everywhere — this
 * browser, a stolen cookie, anything — the moment the redeploy carrying
 * the new value goes live. Both require an actual Vercel env change +
 * redeploy; there is no runtime action that achieves the same thing
 * faster, and this file does not pretend otherwise.
 * ---------------------------------------------------------------------
 */
const COOKIE_NAME = "findmi_admin_session";
// 24 hours — was 7 days. A stolen/copied token is now cryptographically
// valid for at most a day instead of a week; still long enough to cover a
// founder's full working session without re-login friction mid-day.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

/** The authoritative revocation counter. Defaults to a stable constant so
 * an unset ADMIN_SESSION_VERSION (the common case) changes nothing about
 * existing behavior — it's purely opt-in. */
function sessionVersion(): string {
  return process.env.ADMIN_SESSION_VERSION?.trim() || "1";
}

async function hmacKey(): Promise<CryptoKey> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time-ish string comparison — avoids a trivial early-exit
 * timing leak on password/signature checks without needing node:crypto. */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(expiry: number, version: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${expiry}.${version}`));
  return `${expiry}.${version}.${toHex(sig)}`;
}

async function verify(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiryStr, version, hmac] = parts;
  const expiry = Number(expiryStr);
  if (!expiry || !version || !hmac || Date.now() > expiry) return false;

  // Old-version tokens fail closed here, explicitly and before the
  // signature is even recomputed — this is what makes rotating
  // ADMIN_SESSION_VERSION a real revocation switch rather than a no-op
  // (the signature alone can't distinguish "old version, same password"
  // from "current version, same password," since the key only depends on
  // the password).
  if (version !== sessionVersion()) return false;

  const expected = await sign(expiry, version);
  const expectedHmac = expected.split(".")[2];
  return timingSafeStringEqual(hmac, expectedHmac);
}

/** True only when ADMIN_PASSWORD matches. Never logs or echoes the value. */
export function checkPassword(candidate: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  return timingSafeStringEqual(candidate, real);
}

export async function createSession(): Promise<void> {
  const expiry = Date.now() + SESSION_TTL_MS;
  const jar = await cookies();
  jar.set(COOKIE_NAME, await sign(expiry, sessionVersion()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Deletes the browser's cookie — see this file's header comment for
 * exactly what this does and doesn't revoke. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Reads/verifies a raw cookie value — used by Middleware, which has its
 * own request-bound cookie access rather than next/headers' cookies(). */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return verify(token);
}

export const ADMIN_SESSION_COOKIE = COOKIE_NAME;

/** For Server Components/Actions: throws-free boolean check. */
export async function isAdminSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  return verifyToken(token);
}

/**
 * Security Pass 4 — the independent authorization primitive every
 * privileged admin Server Action / API route handler / upload helper calls
 * BEFORE touching getAdminSupabase(). src/middleware.ts remains the first
 * perimeter (it stops an unauthenticated request from ever reaching an
 * admin page or action); this is the second, independent layer for the
 * specific case middleware alone can't cover — a Server Action gets its
 * own POST-able reference regardless of which page currently renders a
 * form pointing at it, so it must not trust "some page rendered me" as
 * proof of authorization.
 *
 * Deliberately reuses isAdminSession() → verifyToken() → verify(), the
 * EXACT SAME cookie-signature check middleware performs — not a second,
 * parallel auth implementation. Fails closed: any missing/invalid/expired/
 * old-version token throws a generic Error (never the password, signing
 * material, or any token/session detail) before the caller can do
 * anything else. This file is only ever importable from server-side code
 * (it calls next/headers' cookies(), which Next.js itself refuses to
 * bundle into a Client Component), so requireAdmin() carries that same
 * guarantee.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) {
    throw new Error("Unauthorized");
  }
}
