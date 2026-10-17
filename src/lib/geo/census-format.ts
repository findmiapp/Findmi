// Canonical U.S. geography — the dependency-free Census file rules: which
// official files exist, how to parse them (by header NAME, never by column
// position), and how official names become searchable display names.
// Pure (no I/O) so it is shared by the Admin import (server), the local
// CLI and tests. Mirrors the CHECKs in
// supabase/migrations/20261024000000_discovery_intelligence_v1.sql.

export const CENSUS_KINDS = ["state", "county", "place", "zcta"] as const;
export type CensusKind = (typeof CENSUS_KINDS)[number];

export const CENSUS_DATASETS = ["states", "counties", "places", "zctas", "place_county", "zcta_county"] as const;
export type CensusDataset = (typeof CENSUS_DATASETS)[number];
export const isCensusDataset = (v: unknown): v is CensusDataset => typeof v === "string" && (CENSUS_DATASETS as readonly string[]).includes(v);

export const DEFAULT_CENSUS_VINTAGE = "2026";

const GAZ = (vintage: string, file: string) => `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${vintage}_Gazetteer/${vintage}_Gaz_${file}_national.zip`;

/** The official files. Gazetteer files carry the requested vintage. State
 * names and the two relationship files are published per DECENNIAL census
 * (2020 definitions; ZCTAs are only redefined each decade), so their real
 * source vintage is recorded as 2020 — never relabelled. */
export const CENSUS_SOURCES: Record<CensusDataset, { url: (vintage: string) => string; sourceVintage: (vintage: string) => string; zipped: boolean; label: string }> = {
  states: {
    url: () => "https://www2.census.gov/geo/docs/reference/codes2020/national_state2020.txt",
    sourceVintage: () => "2020 reference codes",
    zipped: false,
    label: "States",
  },
  counties: { url: (v) => GAZ(v, "counties"), sourceVintage: (v) => `${v} Gazetteer`, zipped: true, label: "Counties" },
  places: { url: (v) => GAZ(v, "place"), sourceVintage: (v) => `${v} Gazetteer`, zipped: true, label: "Census Places" },
  zctas: { url: (v) => GAZ(v, "zcta"), sourceVintage: (v) => `${v} Gazetteer (2020 ZCTA definitions)`, zipped: true, label: "ZCTAs" },
  place_county: {
    url: () => "https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt",
    sourceVintage: () => "2020 place-by-county reference",
    zipped: false,
    label: "Place ↔ County links",
  },
  zcta_county: {
    url: () => "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
    sourceVintage: () => "2020 ZCTA–county relationship",
    zipped: false,
    label: "ZCTA ↔ County links",
  },
};

/** Import order: links need both ends to exist. */
export const CENSUS_IMPORT_ORDER: CensusDataset[] = ["states", "counties", "places", "zctas", "place_county", "zcta_county"];

export interface GeoRow {
  geo_key: string;
  kind: CensusKind;
  geoid: string;
  name: string;
  display_name: string;
  search_names: string[];
  lsad: string | null;
  funcstat: string | null;
  state_fips: string | null;
  state_usps: string | null;
  intpt_lat: number | null;
  intpt_lng: number | null;
  aland_m2: number | null;
  vintage: string;
}

export interface LinkRow {
  child_key: string;
  parent_key: string;
  relation: "county_in_state" | "place_in_state" | "place_in_county" | "zcta_in_county" | "zcta_in_state";
  land_share: number | null;
  vintage: string;
}

export const geoKey = (kind: CensusKind, geoid: string) => `${kind}:${geoid}`;

// ---------------------------------------------------------------- parsing

export interface Table {
  headers: string[];
  rows: string[][];
}

/** Tab- or pipe-delimited, header row first; headers trimmed + upper-cased
 * (the Gazetteer's last header carries trailing whitespace). */
export function parseDelimited(text: string): Table {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = lines[0].includes("|") ? "|" : "\t";
  const headers = lines[0].split(delimiter).map((h) => h.trim().toUpperCase());
  return { headers, rows: lines.slice(1).map((l) => l.split(delimiter).map((c) => c.trim())) };
}

function columns(table: Table, required: string[], file: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of required) {
    const i = table.headers.indexOf(name);
    if (i < 0) throw new Error(`${file}: missing expected column ${name} (found ${table.headers.join(", ")}).`);
    out[name] = i;
  }
  return out;
}

const optionalCol = (table: Table, name: string) => table.headers.indexOf(name);
const num = (v: string | undefined) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// ---------------------------------------------------------------- names

/** Lower-case, accent-free, punctuation-free, single-spaced. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Census Place legal/statistical suffixes, longest first. */
const PLACE_SUFFIXES = [
  " consolidated government (balance)",
  " metropolitan government (balance)",
  " unified government (balance)",
  " metro government (balance)",
  " city and borough",
  " urban county",
  " municipality",
  " zona urbana",
  " corporation",
  " plantation",
  " comunidad",
  " borough",
  " village",
  " city",
  " town",
  " CDP",
];

/** "New York city" → "New York"; "Nashville-Davidson metropolitan
 * government (balance)" → "Nashville-Davidson" (+ alias "Nashville");
 * "Louisville/Jefferson County metro government (balance)" →
 * "Louisville/Jefferson County" (+ alias "Louisville"). */
export function placeNames(officialName: string): { display: string; aliases: string[] } {
  let display = officialName.trim();
  for (const suffix of PLACE_SUFFIXES) {
    if (display.toLowerCase().endsWith(suffix.toLowerCase())) {
      display = display.slice(0, -suffix.length).trim();
      break;
    }
  }
  const aliases = new Set<string>();
  const balance = /\((balance)\)$/i.test(officialName);
  if (balance || /[-/]/.test(display)) {
    const first = display.split(/[-/]/)[0].trim();
    if (balance && first && first !== display) aliases.add(first);
  }
  return { display, aliases: [...aliases] };
}

const searchNames = (...names: string[]) => [...new Set(names.map(normalizeSearch).filter(Boolean))];

// ---------------------------------------------------------------- builders

export function buildStates(text: string, vintage: string): GeoRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["STATE", "STATEFP", "STATE_NAME"], "states");
  return t.rows
    .filter((r) => /^\d{2}$/.test(r[c.STATEFP]))
    .map((r) => {
      const geoid = r[c.STATEFP];
      const name = r[c.STATE_NAME];
      return {
        geo_key: geoKey("state", geoid),
        kind: "state" as const,
        geoid,
        name,
        display_name: name,
        search_names: searchNames(name),
        lsad: null,
        funcstat: null,
        state_fips: geoid,
        state_usps: r[c.STATE] || null,
        intpt_lat: null,
        intpt_lng: null,
        aland_m2: null,
        vintage,
      };
    });
}

/** "Westchester County" → "Westchester" (also Parish, Borough, Census
 * Area, Municipality, city) — a search alias; resolution still prefers a
 * Place over a County with the same bare name. */
export function countyBareName(name: string): string {
  return name.replace(/\s+(county|parish|borough|census area|city and borough|municipality|municipio|planning region)$/i, "").trim();
}

export function buildCounties(text: string, vintage: string): GeoRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["USPS", "GEOID", "NAME", "ALAND", "INTPTLAT", "INTPTLONG"], "counties");
  return t.rows
    .filter((r) => /^\d{5}$/.test(r[c.GEOID]))
    .map((r) => ({
      geo_key: geoKey("county", r[c.GEOID]),
      kind: "county" as const,
      geoid: r[c.GEOID],
      name: r[c.NAME],
      display_name: r[c.NAME],
      search_names: searchNames(r[c.NAME], countyBareName(r[c.NAME])),
      lsad: null,
      funcstat: null,
      state_fips: r[c.GEOID].slice(0, 2),
      state_usps: r[c.USPS] || null,
      intpt_lat: num(r[c.INTPTLAT]),
      intpt_lng: num(r[c.INTPTLONG]),
      aland_m2: num(r[c.ALAND]),
      vintage,
    }));
}

export function buildPlaces(text: string, vintage: string): GeoRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["USPS", "GEOID", "NAME", "ALAND", "INTPTLAT", "INTPTLONG"], "places");
  const lsad = optionalCol(t, "LSAD");
  const funcstat = optionalCol(t, "FUNCSTAT");
  return t.rows
    .filter((r) => /^\d{7}$/.test(r[c.GEOID]))
    .map((r) => {
      const names = placeNames(r[c.NAME]);
      return {
        geo_key: geoKey("place", r[c.GEOID]),
        kind: "place" as const,
        geoid: r[c.GEOID],
        name: r[c.NAME],
        display_name: names.display,
        search_names: searchNames(names.display, ...names.aliases),
        lsad: lsad >= 0 ? r[lsad] || null : null,
        funcstat: funcstat >= 0 ? r[funcstat] || null : null,
        state_fips: r[c.GEOID].slice(0, 2),
        state_usps: r[c.USPS] || null,
        intpt_lat: num(r[c.INTPTLAT]),
        intpt_lng: num(r[c.INTPTLONG]),
        aland_m2: num(r[c.ALAND]),
        vintage,
      };
    });
}

export function buildZctas(text: string, vintage: string): GeoRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["GEOID", "ALAND", "INTPTLAT", "INTPTLONG"], "zctas");
  return t.rows
    .filter((r) => /^\d{5}$/.test(r[c.GEOID]))
    .map((r) => ({
      geo_key: geoKey("zcta", r[c.GEOID]),
      kind: "zcta" as const,
      geoid: r[c.GEOID],
      name: r[c.GEOID],
      display_name: r[c.GEOID],
      search_names: [r[c.GEOID]],
      lsad: null,
      funcstat: null,
      state_fips: null,
      state_usps: null,
      intpt_lat: num(r[c.INTPTLAT]),
      intpt_lng: num(r[c.INTPTLONG]),
      aland_m2: num(r[c.ALAND]),
      vintage,
    }));
}

/** State membership follows from the GEOID itself (the first two digits
 * are the state FIPS) — no relationship file needed. */
export function stateLinksFor(rows: GeoRow[], vintage: string): LinkRow[] {
  return rows
    .filter((r) => (r.kind === "county" || r.kind === "place") && r.state_fips)
    .map((r) => ({
      child_key: r.geo_key,
      parent_key: geoKey("state", r.state_fips!),
      relation: r.kind === "county" ? ("county_in_state" as const) : ("place_in_state" as const),
      land_share: null,
      vintage,
    }));
}

/** Place ↔ County (a place can span several counties). */
export function buildPlaceCountyLinks(text: string, vintage: string): LinkRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["STATEFP", "COUNTYFP", "PLACEFP"], "place_county");
  const out = new Map<string, LinkRow>();
  for (const r of t.rows) {
    const [s, co, p] = [r[c.STATEFP], r[c.COUNTYFP], r[c.PLACEFP]];
    if (!/^\d{2}$/.test(s) || !/^\d{3}$/.test(co) || !/^\d{5}$/.test(p)) continue;
    const link: LinkRow = { child_key: geoKey("place", s + p), parent_key: geoKey("county", s + co), relation: "place_in_county", land_share: null, vintage };
    out.set(`${link.child_key}|${link.parent_key}`, link);
  }
  return [...out.values()];
}

/** ZCTA ↔ County with the land-area share of the ZCTA in each county, plus
 * the implied ZCTA ↔ State links (from the county GEOID's state FIPS). */
export function buildZctaCountyLinks(text: string, vintage: string): LinkRow[] {
  const t = parseDelimited(text);
  const c = columns(t, ["GEOID_ZCTA5_20", "GEOID_COUNTY_20", "AREALAND_ZCTA5_20", "AREALAND_PART"], "zcta_county");
  const out = new Map<string, LinkRow>();
  for (const r of t.rows) {
    const z = r[c.GEOID_ZCTA5_20];
    const co = r[c.GEOID_COUNTY_20];
    if (!/^\d{5}$/.test(z) || !/^\d{5}$/.test(co)) continue;
    const total = num(r[c.AREALAND_ZCTA5_20]);
    const part = num(r[c.AREALAND_PART]);
    const share = total && part !== null ? Math.round((part / total) * 10_000) / 10_000 : null;
    const cl: LinkRow = { child_key: geoKey("zcta", z), parent_key: geoKey("county", co), relation: "zcta_in_county", land_share: share, vintage };
    out.set(`${cl.child_key}|${cl.parent_key}|c`, cl);
    const sKey = geoKey("state", co.slice(0, 2));
    const existing = out.get(`${cl.child_key}|${sKey}|s`);
    out.set(`${cl.child_key}|${sKey}|s`, {
      child_key: cl.child_key,
      parent_key: sKey,
      relation: "zcta_in_state",
      land_share: existing?.land_share !== null && existing?.land_share !== undefined && share !== null ? Math.round((existing.land_share + share) * 10_000) / 10_000 : (share ?? existing?.land_share ?? null),
      vintage,
    });
  }
  return [...out.values()];
}

export function buildDataset(dataset: CensusDataset, text: string, vintage: string): { geos: GeoRow[]; links: LinkRow[] } {
  switch (dataset) {
    case "states":
      return { geos: buildStates(text, vintage), links: [] };
    case "counties": {
      const geos = buildCounties(text, vintage);
      return { geos, links: stateLinksFor(geos, vintage) };
    }
    case "places": {
      const geos = buildPlaces(text, vintage);
      return { geos, links: stateLinksFor(geos, vintage) };
    }
    case "zctas":
      return { geos: buildZctas(text, vintage), links: [] };
    case "place_county":
      return { geos: [], links: buildPlaceCountyLinks(text, vintage) };
    case "zcta_county":
      return { geos: [], links: buildZctaCountyLinks(text, vintage) };
  }
}
