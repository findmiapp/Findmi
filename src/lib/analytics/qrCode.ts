// Findmi Analytics Phase 2B — QR campaign code generation + destination
// safety. No new dependency: Node's built-in crypto (available in every
// Next.js server runtime this project uses) is sufficient for both.
import { randomBytes } from "crypto";

/** A random, URL-safe, non-sequential public scan identifier — never the
 * campaign's own uuid (an incrementing/guessable-shaped id would let
 * anyone enumerate other campaigns' scan URLs). 9 raw bytes -> 12
 * base64url characters (~72 bits of entropy) — compact enough for a QR
 * code's own URL, effectively unguessable, and collision odds low enough
 * that the caller's unique-constraint retry (see createQrCampaign) is a
 * formality, not a real contention point. Immutable after creation —
 * nothing in this codebase ever regenerates an existing campaign's code. */
export function generateQrCode(): string {
  return randomBytes(9).toString("base64url");
}

const MAX_DESTINATION_LENGTH = 512;

/** QR destinations are internal-Findmi-only in Phase 2B — no open-redirect
 * surface. Deliberately stricter than lib/navigation.ts's
 * validateCustomDestination (which allows a founder to link an https://
 * external URL elsewhere on the site): a QR code is printed on physical
 * signage and can't be edited after the fact, so this never allows an
 * external host, a protocol-relative URL, or a scheme at all — only a
 * plain internal path. */
export function isSafeQrDestinationPath(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_DESTINATION_LENGTH) return false;
  if (/\s/.test(trimmed)) return false;
  // Rejects javascript:/data:/https:/http:/mailto: etc. — any scheme at
  // all — plus a bare "//host" protocol-relative URL, which starts with
  // "/" but is not an internal path.
  if (trimmed.includes(":") || trimmed.startsWith("//")) return false;
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.toLowerCase().startsWith("/admin")) return false;
  if (trimmed.toLowerCase().startsWith("/api")) return false;
  return true;
}
