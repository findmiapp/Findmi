import { cookies } from "next/headers";

/**
 * Founder-only admin auth — one shared password (ADMIN_PASSWORD), no
 * accounts, no roles. The session cookie is a signed "<expiry>.<hmac>"
 * value; the HMAC key is derived from ADMIN_PASSWORD itself so no second
 * secret needs to be configured. This is intentionally the smallest thing
 * that's still safe: a forged cookie is infeasible without knowing the
 * password, and the cookie is httpOnly so client JS never touches it.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) rather than
 * node:crypto specifically because this file is imported from
 * src/middleware.ts, which runs on the Edge runtime — node:crypto isn't
 * available there, but Web Crypto works in both Edge and Node.
 */
const COOKIE_NAME = "findmi_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const encoder = new TextEncoder();

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

async function sign(expiry: number): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(String(expiry)));
  return `${expiry}.${toHex(sig)}`;
}

async function verify(token: string): Promise<boolean> {
  const [expiryStr, hmac] = token.split(".");
  const expiry = Number(expiryStr);
  if (!expiry || !hmac || Date.now() > expiry) return false;
  const expected = await sign(expiry);
  const expectedHmac = expected.split(".")[1];
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
  jar.set(COOKIE_NAME, await sign(expiry), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

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
 * parallel auth implementation. Fails closed: any missing/invalid/expired
 * token throws a generic Error (never the password, signing material, or
 * any token/session detail) before the caller can do anything else. This
 * file is only ever importable from server-side code (it calls
 * next/headers' cookies(), which Next.js itself refuses to bundle into a
 * Client Component), so requireAdmin() carries that same guarantee.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) {
    throw new Error("Unauthorized");
  }
}
