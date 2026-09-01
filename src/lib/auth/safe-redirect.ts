const DEFAULT_REDIRECT = "/account";

/**
 * Validates a `next` redirect target from an untrusted source (a query
 * param on /login, /signup, or /auth/callback) down to only a safe,
 * same-origin relative path — never a value that could send the browser
 * to an external host after a successful sign-in. Falls back to
 * DEFAULT_REDIRECT for anything that doesn't clearly qualify; never
 * throws. Use this everywhere an auth flow reads a `next` param — never
 * redirect to one directly.
 */
export function getSafeRedirect(next: string | null | undefined): string {
  if (!next) return DEFAULT_REDIRECT;

  // Reject anything containing a backslash outright — some browsers/URL
  // parsers normalize "\" to "/", so "/\evil.com" or "\\evil.com" can
  // otherwise smuggle a protocol-relative or absolute target past a
  // naive "starts with /" check.
  if (next.includes("\\")) return DEFAULT_REDIRECT;

  // Must be a same-origin relative path: starts with exactly one "/",
  // never "//" (protocol-relative — "//evil.com" is a same-scheme
  // absolute URL to another host).
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_REDIRECT;

  // Reject anything that parses as an absolute URL with its own scheme —
  // catches "/redirect?u=https://evil.com" style payloads AND schemes
  // like "javascript:"/"data:" riding along disguised as a path.
  // Resolved against a fixed, meaningless base so this check itself can
  // never be origin-confused.
  try {
    const resolved = new URL(next, "http://localhost");
    if (resolved.origin !== "http://localhost") return DEFAULT_REDIRECT;
    // Reconstructed from the parsed pathname+search+hash (never the
    // original string) so anything the parser normalized away is gone
    // from the result too.
    return `${resolved.pathname}${resolved.search}${resolved.hash}` || DEFAULT_REDIRECT;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
