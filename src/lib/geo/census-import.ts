import "server-only";
import { createHash } from "node:crypto";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { requireAdmin } from "@/lib/admin/auth";
import { readZip } from "@/lib/geo/zip";
import {
  buildDataset,
  CENSUS_IMPORT_ORDER,
  CENSUS_SOURCES,
  DEFAULT_CENSUS_VINTAGE,
  type CensusDataset,
  type CensusKind,
  type GeoRow,
  type LinkRow,
} from "@/lib/geo/census-format";

// Canonical U.S. geography — the Census import engine. Bounded, resumable
// and idempotent:
//   • one call imports at most `maxRows` rows of ONE dataset, from the
//     cursor saved in census_imports, then returns (fits a 60s server
//     action; the Admin page simply calls again until complete);
//   • every write is an upsert keyed by geo_key / (child, parent, relation),
//     so re-running a dataset — or the whole import — changes nothing;
//   • links are only written when both ends exist (skipped ones counted);
//   • when a geography dataset completes, rows of that kind from an older
//     vintage that this release no longer contains get retired_vintage —
//     never deleted, so no mapping can break.
// Admin only: runCensusImportStep calls requireAdmin() first; service-role
// credentials stay server-side.

export interface CensusJob {
  id: string;
  vintage: string;
  dataset: CensusDataset;
  source_url: string;
  source_vintage: string | null;
  sha256: string | null;
  status: "pending" | "running" | "complete" | "failed";
  cursor: number;
  rows_read: number;
  rows_upserted: number;
  rows_retired: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface CensusWriter {
  getJob(vintage: string, dataset: CensusDataset): Promise<CensusJob | null>;
  saveJob(job: Partial<CensusJob> & { vintage: string; dataset: CensusDataset }): Promise<void>;
  upsertGeos(rows: GeoRow[]): Promise<void>;
  /** Which of these geo_keys exist. */
  existingKeys(keys: string[]): Promise<Set<string>>;
  upsertLinks(rows: LinkRow[]): Promise<void>;
  retire(kind: CensusKind, vintage: string): Promise<number>;
}

export type FetchBytes = (url: string) => Promise<Buffer>;

const BATCH = 1000;
const KIND_OF: Partial<Record<CensusDataset, CensusKind>> = { states: "state", counties: "county", places: "place", zctas: "zcta" };

/** Census text is UTF-8 in current releases; older reference files are
 * Latin-1. Decode as UTF-8 unless that produces replacement characters. */
export function decodeCensusText(bytes: Buffer): string {
  const utf8 = bytes.toString("utf8");
  return utf8.includes("�") ? bytes.toString("latin1") : utf8;
}

export async function loadCensusText(dataset: CensusDataset, vintage: string, fetchBytes: FetchBytes): Promise<{ text: string; url: string; sha256: string }> {
  const src = CENSUS_SOURCES[dataset];
  const url = src.url(vintage);
  const raw = await fetchBytes(url);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (!src.zipped) return { text: decodeCensusText(raw), url, sha256 };
  const entry = readZip(raw).find((e) => /\.txt$/i.test(e.name));
  if (!entry) throw new Error(`${url}: no .txt file inside the archive.`);
  return { text: decodeCensusText(entry.data), url, sha256 };
}

export interface StepResult {
  dataset: CensusDataset;
  status: CensusJob["status"];
  cursor: number;
  total: number;
  upserted: number;
  skippedLinks: number;
  retired: number;
}

/** One bounded slice of one dataset. Pure orchestration over a writer, so
 * tests run it against an in-memory writer. */
export async function importCensusSlice(opts: {
  writer: CensusWriter;
  fetchBytes: FetchBytes;
  dataset: CensusDataset;
  vintage: string;
  maxRows: number;
  restart?: boolean;
}): Promise<StepResult> {
  const { writer, dataset, vintage } = opts;
  const src = CENSUS_SOURCES[dataset];
  let job = opts.restart ? null : await writer.getJob(vintage, dataset);
  if (job?.status === "complete") {
    return { dataset, status: "complete", cursor: job.cursor, total: job.rows_read, upserted: 0, skippedLinks: 0, retired: 0 };
  }
  const { text, url, sha256 } = await loadCensusText(dataset, vintage, opts.fetchBytes);
  if (job?.sha256 && job.sha256 !== sha256) job = null; // the published file changed — start this dataset over
  const { geos, links } = buildDataset(dataset, text, vintage);
  const total = geos.length + links.length;
  if (total === 0) throw new Error(`${url}: no rows parsed — refusing to import an empty file.`);

  const start = job?.cursor ?? 0;
  const end = Math.min(total, start + opts.maxRows);
  let upserted = 0;
  let skippedLinks = 0;
  if (!job) {
    await writer.saveJob({ vintage, dataset, source_url: url, source_vintage: src.sourceVintage(vintage), sha256, status: "running", cursor: 0, rows_read: total, rows_upserted: 0, rows_retired: 0, error: null, finished_at: null });
  }

  for (let i = start; i < end; i += BATCH) {
    const stop = Math.min(end, i + BATCH);
    const geoSlice = geos.slice(Math.min(i, geos.length), Math.min(stop, geos.length));
    if (geoSlice.length) {
      await writer.upsertGeos(geoSlice);
      upserted += geoSlice.length;
    }
    const linkSlice = links.slice(Math.max(0, i - geos.length), Math.max(0, stop - geos.length));
    if (linkSlice.length) {
      const exists = await writer.existingKeys([...new Set(linkSlice.flatMap((l) => [l.child_key, l.parent_key]))]);
      const ok = linkSlice.filter((l) => exists.has(l.child_key) && exists.has(l.parent_key));
      skippedLinks += linkSlice.length - ok.length;
      if (ok.length) await writer.upsertLinks(ok);
      upserted += ok.length;
    }
  }

  const previous = job?.rows_upserted ?? 0;
  let retired = 0;
  const done = end >= total;
  if (done && KIND_OF[dataset]) retired = await writer.retire(KIND_OF[dataset]!, vintage);
  await writer.saveJob({
    vintage,
    dataset,
    source_url: url,
    source_vintage: src.sourceVintage(vintage),
    sha256,
    status: done ? "complete" : "running",
    cursor: end,
    rows_read: total,
    rows_upserted: previous + upserted,
    rows_retired: retired,
    error: null,
    finished_at: done ? new Date().toISOString() : null,
  });
  return { dataset, status: done ? "complete" : "running", cursor: end, total, upserted, skippedLinks, retired };
}

// ---------------------------------------------------------------- Supabase (service role) writer

function supabaseWriter(): CensusWriter {
  const admin = getAdminSupabase();
  if (!admin) throw new Error("Server isn't configured.");
  return {
    async getJob(vintage, dataset) {
      const { data } = await admin.from("census_imports").select("*").eq("vintage", vintage).eq("dataset", dataset).maybeSingle();
      return (data as CensusJob | null) ?? null;
    },
    async saveJob(job) {
      const { error } = await admin.from("census_imports").upsert(job, { onConflict: "vintage,dataset" });
      if (error) throw new Error(`Couldn't record import progress: ${error.message}`);
    },
    async upsertGeos(rows) {
      const { error } = await admin
        .from("census_geographies")
        .upsert(rows.map((r) => ({ ...r, retired_vintage: null, updated_at: new Date().toISOString() })), { onConflict: "geo_key" });
      if (error) throw new Error(`Census upsert failed: ${error.message}`);
    },
    async existingKeys(keys) {
      const found = new Set<string>();
      for (let i = 0; i < keys.length; i += 300) {
        const { data, error } = await admin.from("census_geographies").select("geo_key").in("geo_key", keys.slice(i, i + 300));
        if (error) throw new Error(`Census lookup failed: ${error.message}`);
        for (const r of (data ?? []) as { geo_key: string }[]) found.add(r.geo_key);
      }
      return found;
    },
    async upsertLinks(rows) {
      const { error } = await admin.from("census_geography_links").upsert(rows, { onConflict: "child_key,parent_key,relation" });
      if (error) throw new Error(`Census link upsert failed: ${error.message}`);
    },
    async retire(kind, vintage) {
      const { data, error } = await admin
        .from("census_geographies")
        .update({ retired_vintage: vintage })
        .eq("kind", kind)
        .neq("vintage", vintage)
        .is("retired_vintage", null)
        .select("geo_key");
      if (error) throw new Error(`Couldn't retire older rows: ${error.message}`);
      return (data ?? []).length;
    },
  };
}

const fetchFromCensus: FetchBytes = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "Findmi geography import (findmi.app)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}. If this vintage hasn't been published yet, choose the latest published vintage.`);
  return Buffer.from(await res.arrayBuffer());
};

/** Admin action entry point: the next unfinished dataset, one slice. */
export async function runCensusImportStep(opts: { vintage?: string; maxRows?: number; dataset?: CensusDataset; restart?: boolean } = {}): Promise<StepResult & { next: CensusDataset | null }> {
  await requireAdmin();
  const vintage = opts.vintage ?? DEFAULT_CENSUS_VINTAGE;
  if (!/^\d{4}$/.test(vintage)) throw new Error("Vintage must be a year.");
  const writer = supabaseWriter();
  let dataset = opts.dataset ?? null;
  if (!dataset) {
    for (const d of CENSUS_IMPORT_ORDER) {
      const job = await writer.getJob(vintage, d);
      if (job?.status !== "complete") {
        dataset = d;
        break;
      }
    }
  }
  if (!dataset) {
    const last = await writer.getJob(vintage, "zcta_county");
    return { dataset: "zcta_county", status: "complete", cursor: last?.cursor ?? 0, total: last?.rows_read ?? 0, upserted: 0, skippedLinks: 0, retired: 0, next: null };
  }
  try {
    const result = await importCensusSlice({ writer, fetchBytes: fetchFromCensus, dataset, vintage, maxRows: opts.maxRows ?? 8000, restart: opts.restart });
    const next = result.status === "complete" ? (CENSUS_IMPORT_ORDER[CENSUS_IMPORT_ORDER.indexOf(dataset) + 1] ?? null) : dataset;
    return { ...result, next };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    await writer.saveJob({ vintage, dataset, source_url: CENSUS_SOURCES[dataset].url(vintage), status: "failed", error: message.slice(0, 1000) }).catch(() => undefined);
    throw err;
  }
}

export interface CensusStatus {
  available: boolean;
  jobs: CensusJob[];
  counts: Record<CensusKind, number>;
  links: number;
  unmatchedMappings: { geo_key: string; market: string; area: string | null }[];
}

/** Admin read: per-dataset progress, live counts, and every Market/Area
 * mapping whose canonical geo_key isn't present (yet). */
export async function getCensusStatus(vintage = DEFAULT_CENSUS_VINTAGE): Promise<CensusStatus> {
  await requireAdmin();
  const admin = getAdminSupabase();
  const empty = { state: 0, county: 0, place: 0, zcta: 0 };
  if (!admin) return { available: false, jobs: [], counts: empty, links: 0, unmatchedMappings: [] };
  const { data: jobs, error } = await admin.from("census_imports").select("*").eq("vintage", vintage);
  if (error) return { available: false, jobs: [], counts: empty, links: 0, unmatchedMappings: [] };
  const counts = { ...empty };
  await Promise.all(
    (Object.keys(counts) as CensusKind[]).map(async (k) => {
      const { count } = await admin.from("census_geographies").select("geo_key", { count: "exact", head: true }).eq("kind", k).is("retired_vintage", null);
      counts[k] = count ?? 0;
    })
  );
  const { count: links } = await admin.from("census_geography_links").select("child_key", { count: "exact", head: true });
  const { data: maps } = await admin.from("product_geographies").select("geo_key, market:markets(name), area:market_areas(name)");
  type M = { geo_key: string; market: { name: string } | { name: string }[] | null; area: { name: string } | { name: string }[] | null };
  const one = (v: M["market"]) => (Array.isArray(v) ? v[0] : v)?.name ?? null;
  const keys = [...new Set(((maps ?? []) as M[]).map((m) => m.geo_key))];
  const present = new Set<string>();
  if (keys.length) {
    const { data } = await admin.from("census_geographies").select("geo_key").in("geo_key", keys);
    for (const r of (data ?? []) as { geo_key: string }[]) present.add(r.geo_key);
  }
  return {
    available: true,
    jobs: (jobs ?? []) as CensusJob[],
    counts,
    links: links ?? 0,
    unmatchedMappings: ((maps ?? []) as M[]).filter((m) => !present.has(m.geo_key)).map((m) => ({ geo_key: m.geo_key, market: one(m.market) ?? "", area: one(m.area) })),
  };
}
