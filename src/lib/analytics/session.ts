// Findmi Analytics — first-party anonymous session identifier.
//
// Separate, deliberately, from every other identity system on Findmi:
// - Supabase Auth's own session cookies (consumer /account) — untouched.
// - the admin HMAC session cookie (lib/admin/auth.ts) — untouched.
// findmi_sid identifies a BROWSER, not a person — a random uuid, no
// fingerprinting, no IP/user-agent derivation. It exists purely so an
// anonymous visitor's own actions (page view -> save -> follow, etc.) can
// be correlated with each other during analytics reporting, never to
// identify who they are.
//
// SECURITY: this module is the ONLY place that decides a request's
// session_id. The ingestion route (src/app/api/analytics/track/route.ts)
// must call resolveSessionId() and must NEVER trust a session_id supplied
// in the request body — a client-supplied value would let any caller
// spoof another visitor's session and pollute their history. This is a
// deliberate founder-review security correction, not an oversight to
// "optimize" later.
import { cookies } from "next/headers";
import { isUuid } from "./taxonomy";

export const ANALYTICS_SESSION_COOKIE = "findmi_sid";

// ~2 years — long-lived by design (the whole point is correlating a
// returning anonymous visitor's actions over time), not a session-length
// cookie.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;

/** Reads the existing findmi_sid cookie if present and valid, otherwise
 * mints a new random uuid and sets it as a first-party cookie on the
 * response. Must be called from a Server Action or Route Handler (where
 * next/headers' cookies() is writable) — never from a plain Server
 * Component render. Returns the resolved (existing-or-new) session id
 * either way, so the caller always has a value to write onto the event
 * row regardless of whether this was a new or returning visitor. */
export async function resolveSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ANALYTICS_SESSION_COOKIE)?.value;
  if (existing && isUuid(existing)) return existing;

  const fresh = crypto.randomUUID();
  try {
    cookieStore.set(ANALYTICS_SESSION_COOKIE, fresh, {
      httpOnly: false, // not identity/security-sensitive — a random device correlation id only
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  } catch {
    // Extremely defensive — cookies().set() should always succeed inside
    // a Route Handler. If it somehow can't, the event still gets a valid
    // session_id for this one write; a later request just mints another.
  }
  return fresh;
}
