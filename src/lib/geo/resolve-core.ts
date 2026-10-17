// Canonical geography resolution — the pure decision layer. The server
// (lib/geo/resolve.ts) looks up Census rows and Findmi product mappings;
// this decides, deterministically:
//
//   1. Findmi product geography wins wherever Findmi has an intentional
//      Market/Area for the Census geography (most specific first: an Area
//      before its Market).
//   2. Otherwise exactly one Census match resolves to that geography.
//   3. More than one match is AMBIGUOUS — returned as choices, never
//      guessed (e.g. "Nashville" alone: TN, GA, AR, NC, …).
//
// ZCTAs are never parents of cities or neighborhoods: a ZIP resolves to the
// ZCTA itself, or to the Findmi Area its dominant county maps to.

import { normalizeSearch } from "./census-format";
import type { GeoScope } from "../discovery/engine";
import { cityKey } from "../discovery/engine";

export interface CensusHit {
  geo_key: string;
  kind: "state" | "county" | "place" | "zcta";
  name: string;
  display_name: string;
  state_usps: string | null;
  aland_m2: number | null;
  search_names?: string[];
}

export interface ProductMapping {
  geo_key: string;
  role: "primary" | "includes" | "within";
  market_slug: string;
  market_name: string;
  area_slug: string | null;
  area_name: string | null;
}

export type GeoTarget =
  | { type: "findmi"; market: string; area: string | null; label: string }
  | { type: "census"; geo_key: string; kind: CensusHit["kind"]; label: string; name: string; names?: string[]; usps: string | null };

export type GeoResolution =
  | { status: "resolved"; target: GeoTarget; via: string }
  | { status: "ambiguous"; options: GeoTarget[] }
  | { status: "none" };

export const censusLabel = (h: Pick<CensusHit, "kind" | "display_name" | "state_usps">) =>
  h.kind === "state" || h.kind === "zcta" || !h.state_usps ? h.display_name : `${h.display_name}, ${h.state_usps}`;

/** The most specific Findmi product geography for one Census key: an Area
 * mapping before a Market mapping; `includes` (the Market merely contains
 * it) only when nothing more specific exists. */
export function productTargetFor(geoKey: string, mappings: ProductMapping[]): GeoTarget | null {
  const rows = mappings.filter((m) => m.geo_key === geoKey);
  const pick =
    rows.find((m) => m.area_slug && m.role === "primary") ??
    rows.find((m) => !m.area_slug && m.role === "primary") ??
    rows.find((m) => m.area_slug && m.role === "within") ??
    rows.find((m) => !m.area_slug) ??
    null;
  if (!pick) return null;
  return { type: "findmi", market: pick.market_slug, area: pick.area_slug, label: pick.area_name ?? pick.market_name };
}

const censusTarget = (h: CensusHit): GeoTarget => ({ type: "census", geo_key: h.geo_key, kind: h.kind, label: censusLabel(h), name: h.display_name, names: h.search_names, usps: h.state_usps });
const targetKey = (t: GeoTarget) => (t.type === "findmi" ? `f:${t.market}:${t.area ?? ""}` : `c:${t.geo_key}`);

/** Resolve a place-name phrase from its Census hits. */
export function resolvePlacePhrase(phrase: string, hits: CensusHit[], mappings: ProductMapping[], stateUsps?: string | null): GeoResolution {
  const want = normalizeSearch(phrase);
  let pool = hits.filter((h) => (h.kind === "place" || h.kind === "county") && (!h.search_names || h.search_names.includes(want)));
  if (stateUsps) pool = pool.filter((h) => h.state_usps === stateUsps);
  // A Place before a County of the same bare name, unless "county" was said.
  if (!/\bcounty\b/.test(want) && pool.some((h) => h.kind === "place")) pool = pool.filter((h) => h.kind === "place");
  if (pool.length === 0) return { status: "none" };

  const targets = new Map<string, GeoTarget>();
  for (const h of pool) {
    const t = productTargetFor(h.geo_key, mappings) ?? censusTarget(h);
    if (!targets.has(targetKey(t))) targets.set(targetKey(t), t);
  }
  const findmi = [...targets.values()].filter((t) => t.type === "findmi");
  if (findmi.length === 1) return { status: "resolved", target: findmi[0], via: "findmi" };
  if (targets.size === 1) return { status: "resolved", target: [...targets.values()][0], via: "census" };

  // Ambiguous: present the choices (largest land area first — a stable
  // presentation order, not a pick).
  const ordered = [...pool].sort((a, b) => (b.aland_m2 ?? 0) - (a.aland_m2 ?? 0) || censusLabel(a).localeCompare(censusLabel(b)));
  const options: GeoTarget[] = [];
  const seen = new Set<string>();
  for (const h of ordered) {
    const t = productTargetFor(h.geo_key, mappings) ?? censusTarget(h);
    if (seen.has(targetKey(t))) continue;
    seen.add(targetKey(t));
    options.push(t);
    if (options.length === 6) break;
  }
  return { status: "ambiguous", options };
}

/** Resolve a ZIP: the ZCTA itself, or — when the ZCTA lies mostly (≥ 50%
 * of its land) in one county that a Findmi Area/Market maps to — that
 * Findmi geography, labelled with the ZIP so nothing is hidden. */
export function resolveZip(zip: string, zcta: CensusHit | null, counties: { county_key: string; land_share: number | null }[], mappings: ProductMapping[]): GeoResolution {
  if (!zcta) return { status: "none" };
  const dominant = [...counties].sort((a, b) => (b.land_share ?? 0) - (a.land_share ?? 0))[0];
  if (dominant && (dominant.land_share ?? 0) >= 0.5) {
    const t = productTargetFor(dominant.county_key, mappings);
    if (t && t.type === "findmi") return { status: "resolved", target: { ...t, label: `${zip} · ${t.label}` }, via: "zcta_county" };
  }
  return { status: "resolved", target: censusTarget(zcta), via: "census" };
}

/** A Census target → the in-memory predicate the executor applies to each
 * item's own stored city/state/ZIP. County/state scopes come from the
 * server (places and ZCTAs linked to the county). */
export function scopeForCensus(
  target: Extract<GeoTarget, { type: "census" }>,
  extra: { places?: { display_name: string; state_usps: string | null; search_names?: string[] }[]; zips?: string[] } = {}
): GeoScope {
  const geoid = target.geo_key.split(":")[1];
  if (target.kind === "zcta") return { label: target.label, zips: [geoid] };
  if (target.kind === "state") return { label: target.label, usps: target.usps ?? undefined };
  if (target.kind === "place") return { label: target.label, usps: target.usps ?? undefined, cityKeys: [...new Set([target.name, ...(target.names ?? [])].map((n) => cityKey(n, target.usps)))] };
  const cityKeys = (extra.places ?? []).flatMap((p) => [cityKey(p.display_name, p.state_usps), ...(p.search_names ?? []).map((n) => cityKey(n, p.state_usps))]);
  return { label: target.label, usps: target.usps ?? undefined, cityKeys: [...new Set(cityKeys)], zips: extra.zips ?? [] };
}
