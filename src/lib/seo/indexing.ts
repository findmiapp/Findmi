import type { Metadata } from "next";

/** Google index hygiene (Nov 2026). The one place that decides what a
 * public URL tells search engines.
 *
 *  INDEX            canonical public entity / editorial pages.
 *  NOINDEX, FOLLOW  pages people need but Google shouldn't keep as results:
 *                   account, creation/editing, transactional states, internal
 *                   search, and any filtered/stateful listing URL.
 *  PRIVATE          /admin (password-gated; robots.txt disallow).
 *
 * Path families are ALSO sent as an `X-Robots-Tag` header from
 * next.config.mjs (NOINDEX_PATH_SOURCES there), so a page that forgets its
 * own robots metadata is still covered. Never block a noindex URL in
 * robots.txt: Google has to crawl it to see the noindex. */

/** robots for a page that must stay usable and crawlable but not indexed. */
export const NOINDEX_FOLLOW: NonNullable<Metadata["robots"]> = { index: false, follow: true };

/** Query keys that only attribute a visit (campaign, click id, referral, QR
 * scan). They never change what a page shows, so they never make a URL a
 * "filtered" variant — the canonical tag folds them into the clean URL. */
const TRACKING_PARAM = /^(utm_[a-z0-9_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|source|src|qr|via)$/i;

export function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM.test(key);
}

type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;

function keysOf(params: SearchParamsLike): string[] {
  if (!params) return [];
  if (params instanceof URLSearchParams) return [...new Set(params.keys())];
  return Object.keys(params).filter((k) => params[k] !== undefined);
}

/** True when the URL carries state (a filter, sort, page, search term, view
 * mode…) beyond tracking parameters — i.e. it is a variant of a listing, not
 * the listing itself. */
export function hasStateParams(params: SearchParamsLike): boolean {
  return keysOf(params).some((k) => !isTrackingParam(k));
}

/** Metadata for a discovery LISTING page (/events, /businesses, …): the bare
 * path is the indexable canonical; every filtered/sorted/paged variant
 * points its canonical at that bare path and is noindex, follow (still
 * crawled for the entity links it lists). */
export function listingMetadata(base: Metadata, path: string, params: SearchParamsLike): Metadata {
  return {
    ...base,
    alternates: { ...(base.alternates ?? {}), canonical: path },
    ...(hasStateParams(params) ? { robots: NOINDEX_FOLLOW } : {}),
  };
}

/** Metadata for a page that is never a search landing page (internal
 * search, creation flows, transactional states). Canonical stays the clean
 * path so variants consolidate even before Google drops them. */
export function noindexMetadata(base: Metadata, path?: string): Metadata {
  return {
    ...base,
    ...(path ? { alternates: { ...(base.alternates ?? {}), canonical: path } } : {}),
    robots: NOINDEX_FOLLOW,
  };
}
