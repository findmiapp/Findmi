"use server";

import { getSupabase } from "@/lib/supabase";
import { normalizeSearch } from "@/lib/geo/census-format";
import { STATE_BY_USPS, STATE_BY_NAME, US_STATES } from "@/lib/geo/states";

// Canonical Entity Geography — the one public, read-only entry point the
// client-side picker (components/geo/CanonicalGeographyPicker.tsx) calls
// to search canonical Census geography, same "thin transport wrapper over
// an existing read helper" shape as actions/geography-suggest.ts. Never
// writes anything; the actual save-time resolution/validation happens
// server-side again in lib/geo/entity-geo.ts regardless of what a visitor
// picks here.

export interface CanonicalGeographyHit {
  geo_key: string;
  kind: "place" | "county" | "state" | "zcta";
  label: string;
}

const GEO_COLS = "geo_key, kind, display_name, state_usps";

export async function searchCanonicalGeography(phraseRaw: string): Promise<CanonicalGeographyHit[]> {
  const phrase = phraseRaw.trim().slice(0, 80);
  if (!phrase) return [];

  if (/^\d{5}$/.test(phrase)) {
    const supabase = getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.from("census_geographies").select(GEO_COLS).eq("geo_key", `zcta:${phrase}`).is("retired_vintage", null).maybeSingle();
    if (!data) return [];
    const h = data as { geo_key: string; kind: CanonicalGeographyHit["kind"]; display_name: string; state_usps: string | null };
    return [{ geo_key: h.geo_key, kind: h.kind, label: h.display_name }];
  }

  const want = normalizeSearch(phrase);
  if (!want) return [];

  const supabase = getSupabase();
  const results: CanonicalGeographyHit[] = [];

  const state = STATE_BY_USPS.get(phrase.toUpperCase()) ?? STATE_BY_NAME.get(phrase.toLowerCase());
  if (state) results.push({ geo_key: `state:${state.fips}`, kind: "state", label: state.name });
  else {
    for (const s of US_STATES) {
      if (normalizeSearch(s.name).startsWith(want) && results.length < 3) {
        results.push({ geo_key: `state:${s.fips}`, kind: "state", label: s.name });
      }
    }
  }

  if (supabase) {
    const { data } = await supabase
      .from("census_geographies")
      .select(GEO_COLS)
      .in("kind", ["place", "county"])
      .is("retired_vintage", null)
      .contains("search_names", [want])
      .limit(20);
    for (const row of (data ?? []) as { geo_key: string; kind: CanonicalGeographyHit["kind"]; display_name: string; state_usps: string | null }[]) {
      results.push({ geo_key: row.geo_key, kind: row.kind, label: row.state_usps ? `${row.display_name}, ${row.state_usps}` : row.display_name });
    }
  }

  return results.slice(0, 20);
}
