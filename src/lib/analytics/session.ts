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

// ── Phase 2B — session acquisition attribution ──────────────────────
//
// findmi_acq answers a DIFFERENT question than findmi_sid: not "which
// browser is this" but "what source originally brought this session into
// Findmi". FIRST-TOUCH only — once set, never silently overwritten by a
// later QR scan/link in the same session (see establishQrAcquisitionIfAbsent).
// Every canonical analytics event (not just qr_scan) reads this cookie
// server-side to populate its own acquisition_source/
// acquisition_qr_campaign_id columns — see the ingestion route and
// /q/[code]'s own direct insert. Never trusted from a client-supplied
// request body, for the exact same spoofing reason session_id isn't.
//
// V1 supports exactly one source: "qr". A UTM/referrer-based first-touch
// source is deliberately NOT built this pass (the task's own "optionally"
// — Phase 1's per-EVENT referrer/UTM capture already answers "what
// brought about THIS action"; a session-level first-touch UTM source is
// a real but separate future extension, not required for QR attribution
// to work end-to-end).
export const ANALYTICS_ACQUISITION_COOKIE = "findmi_acq";

// Same lifecycle as findmi_sid — no strong reason found to diverge: the
// whole point of first-touch acquisition is answering "how did this
// (long-lived, findmi_sid-identified) session originally arrive" for as
// long as that session itself is still being correlated at all.
const ACQUISITION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;

export interface AcquisitionState {
  source: "qr";
  qrCampaignId: string;
}

/** findmi_acq's on-the-wire shape is deliberately a short, prefixed
 * string ("qr:<uuid>") rather than JSON — small enough to never resemble
 * a "giant metadata payload" cookie, and trivially forward-extensible
 * (a future source gets its own prefix) without a structural change. */
function parseAcquisitionCookieValue(raw: string | undefined): AcquisitionState | null {
  if (!raw) return null;
  const [source, id] = raw.split(":");
  if (source === "qr" && isUuid(id)) return { source: "qr", qrCampaignId: id };
  return null;
}

/** Read-only — used by the general ingestion route to attach the
 * session's already-established acquisition (if any) to an ordinary
 * event. Never mints or overwrites the cookie; safe to call from a Route
 * Handler regardless of whether this request will itself write anything. */
export async function readAcquisition(): Promise<AcquisitionState | null> {
  const cookieStore = await cookies();
  return parseAcquisitionCookieValue(cookieStore.get(ANALYTICS_ACQUISITION_COOKIE)?.value);
}

/** FIRST-TOUCH ONLY. Call solely from /q/[code] — the one place Findmi
 * ever establishes acquisition. If the session already has an
 * acquisition source (any source, not just a different QR campaign),
 * that existing state is returned UNCHANGED and the cookie is left
 * alone — a second/third QR scan (or any other future acquisition
 * event) in the same session never overwrites the session's original
 * first-touch. If the session has none yet, this QR scan becomes it. */
export async function establishQrAcquisitionIfAbsent(qrCampaignId: string): Promise<AcquisitionState> {
  const cookieStore = await cookies();
  const existing = parseAcquisitionCookieValue(cookieStore.get(ANALYTICS_ACQUISITION_COOKIE)?.value);
  if (existing) return existing;

  const state: AcquisitionState = { source: "qr", qrCampaignId };
  try {
    cookieStore.set(ANALYTICS_ACQUISITION_COOKIE, `qr:${qrCampaignId}`, {
      httpOnly: false, // same non-sensitive posture as findmi_sid — a source label + campaign id, no PII
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ACQUISITION_MAX_AGE_SECONDS,
    });
  } catch {
    // Same defensive posture as resolveSessionId — this one request's own
    // qr_scan event still gets the correct acquisition fields either way;
    // only a future request would fail to find the cookie and treat the
    // session as unacquired.
  }
  return state;
}
