// Findmi Analytics — URL minimization at ingestion. Pure (tests/
// analytics-sanitize.test.mjs).
//
// Generic page context must never carry what a person typed. Search text
// lives in URL query strings (/search?q=...), and document.referrer
// repeats the previous page's full URL, so both page_path and referrer are
// reduced before storage:
//   page_path  pathname only (no query string, no fragment).
//   referrer   a Findmi page   -> its pathname only;
//              another site    -> that site's origin only;
//              anything else   -> dropped.
// Deliberately structured search analytics (search_submit's parsed query
// with free text masked, search's query length) are unaffected: they
// travel in metadata, not in URLs. utm_* campaign parameters are kept as
// their own columns (campaign labels, not personal input).

/** Hosts that count as "Findmi" for referrer minimization. */
export function firstPartyHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const hosts = new Set<string>(["findmi.app", "www.findmi.app", "jerseycity.guide", "www.jerseycity.guide"]);
  const site = env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      hosts.add(new URL(site).host);
    } catch {
      // ignore a malformed env value
    }
  }
  return hosts;
}

/** "/search?q=coffee#top" -> "/search". Non-path input -> null. */
export function sanitizePagePath(value: string | null | undefined, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const cut = trimmed.split(/[?#]/, 1)[0];
  if (!cut) return null;
  return cut.length > maxLength ? cut.slice(0, maxLength) : cut;
}

/** Minimizes a referrer as described above. `requestHost` (the host the
 * beacon was sent to) is also treated as first-party, so previews and
 * local development behave like production. */
export function sanitizeReferrer(value: string | null | undefined, requestHost: string | null, hosts: Set<string> = firstPartyHosts()): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const isFirstParty = hosts.has(url.host) || (requestHost !== null && url.host === requestHost);
  if (isFirstParty) return sanitizePagePath(url.pathname) ?? "/";
  return url.origin;
}
