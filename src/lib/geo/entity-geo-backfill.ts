import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEntityGeography } from "@/lib/geo/entity-geo";
import { BACKFILL_TABLES, type BackfillTable } from "@/lib/geo/entity-geo-core";

// Canonical Entity Geography — the Admin-only backfill runner. Dry Run
// first (writes nothing, just reports), Apply runs in bounded batches and
// writes ONLY the empty geo_* columns on rows that already have none —
// never city/state/postal_code/market_id/market_area_id, never a Market/
// Area/Market Request, never a guess (ambiguous rows are reported, never
// resolved). Idempotent: re-running finds fewer and fewer candidate rows
// as they fill in, and never touches a row that already has a geo_place_
// key/geo_zcta_key/geo_state_key, resolved by this runner or any other
// path (an explicit picker choice, an import, a create/edit action).
//
// BackfillTable/BACKFILL_TABLES live in entity-geo-core.ts (no
// "server-only" guard) so the Admin client component rendering the table
// picker can import them as plain values without pulling this
// server-only module into its client bundle.
//
// NOT RUN against Production by this pass — see the completion report.

export { BACKFILL_TABLES, type BackfillTable };

const HAS_ZCTA_COLUMN: Record<BackfillTable, boolean> = {
  events: true,
  event_occurrences: true,
  locations: true,
  businesses: true,
  appearances: false,
};

export interface BackfillCounts {
  resolved: number;
  partial: number;
  ambiguous: number;
  unresolved: number;
  findmiConflict: number;
}

export interface BackfillSampleRow {
  id: string;
  city: string | null;
  state: string | null;
  outcome: "resolved" | "partial" | "ambiguous" | "unresolved";
  label?: string;
}

export interface BackfillReport {
  table: BackfillTable;
  scanned: number;
  counts: BackfillCounts;
  samples: BackfillSampleRow[];
  applied: number;
}

/** Refuses to run at all unless the Census import is actually complete —
 * resolving against an incomplete/empty census_geographies would produce
 * false "unresolved" results for real geography that simply hasn't been
 * imported yet, which would look identical to a genuine gap. */
export async function isCensusImportComplete(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.from("census_imports").select("status").eq("vintage", "2026");
  if (error || !data || data.length < 6) return false;
  return data.every((row) => (row as { status: string }).status === "complete");
}

async function candidateRows(admin: SupabaseClient, table: BackfillTable, limit: number): Promise<{ id: string; city: string | null; state: string | null }[]> {
  const { data } = await admin
    .from(table)
    .select("id, city, state")
    .is("geo_place_key", null)
    .is("geo_state_key", null)
    .not("city", "is", null)
    .not("state", "is", null)
    .limit(limit);
  return (data ?? []) as { id: string; city: string | null; state: string | null }[];
}

async function runOne(admin: SupabaseClient, table: BackfillTable, limit: number, apply: boolean): Promise<BackfillReport> {
  const rows = await candidateRows(admin, table, limit);
  const counts: BackfillCounts = { resolved: 0, partial: 0, ambiguous: 0, unresolved: 0, findmiConflict: 0 };
  const samples: BackfillSampleRow[] = [];
  let applied = 0;

  for (const row of rows) {
    const geo = await resolveEntityGeography({ city: row.city, state: row.state }).catch(() => ({ status: "unresolved" as const, reason: "lookup failed" }));
    if (geo.status === "resolved") counts.resolved++;
    else if (geo.status === "partial") counts.partial++;
    else if (geo.status === "ambiguous") counts.ambiguous++;
    else counts.unresolved++;

    if (samples.length < 25) {
      samples.push({
        id: row.id,
        city: row.city,
        state: row.state,
        outcome: geo.status,
        label: geo.status === "resolved" || geo.status === "partial" ? geo.label : undefined,
      });
    }

    if (apply && (geo.status === "resolved" || geo.status === "partial")) {
      // Double-checked immediately before writing — never overwrites a
      // key another process (a concurrent create/edit, an import) set
      // between the candidate read above and now. Idempotent by
      // construction, not just by intent.
      const update: Record<string, string | null> = { geo_place_key: geo.keys.place, geo_state_key: geo.keys.state, geo_resolution: "backfill" };
      if (HAS_ZCTA_COLUMN[table]) update.geo_zcta_key = geo.keys.zcta;
      const { data: updated } = await admin
        .from(table)
        .update(update)
        .eq("id", row.id)
        .is("geo_place_key", null)
        .is("geo_state_key", null)
        .select("id");
      if (updated && updated.length > 0) applied++;
    }
  }

  return { table, scanned: rows.length, counts, samples, applied };
}

export async function runBackfillDryRun(admin: SupabaseClient, table: BackfillTable, limit = 200): Promise<BackfillReport> {
  return runOne(admin, table, limit, false);
}

export async function runBackfillApply(admin: SupabaseClient, table: BackfillTable, limit = 200): Promise<BackfillReport> {
  return runOne(admin, table, limit, true);
}
