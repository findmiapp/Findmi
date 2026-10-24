import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportRowData } from "./fields";
import type { MatchStatus } from "./match";

/** Locator Import — history. Reads only what the import already stores (the
 * batch, its staged rows and their outcomes). Nothing here is invented: the
 * initiator is shown only when the batch recorded one, and a batch that never
 * ran is shown as exactly that. The caller authorizes the Business first. */

export const HISTORY_PAGE_SIZE = 15;
export const HISTORY_ROWS_PAGE_SIZE = 50;
export const MISSING_LIST_LIMIT = 100;

const isMissing = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || /does not exist|schema cache/.test(e.message ?? "")));

export interface ImportOutcomeCounts {
  linked: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ImportHistoryItem {
  id: string;
  createdAt: string;
  completedAt: string | null;
  source: string;
  sourceLabel: string | null;
  status: string;
  totalRows: number;
  /** Final outcome counts (completed imports); null while it hasn't run. */
  outcomes: ImportOutcomeCounts | null;
  initiatedBy: string | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function nameFor(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data } = await admin.from("profiles").select("id, display_name").in("id", userIds);
  for (const p of (data ?? []) as { id: string; display_name: string | null }[]) if (p.display_name) out.set(p.id, p.display_name);
  return out;
}

export async function listImportHistory(admin: SupabaseClient, businessId: string, page: number): Promise<{ available: boolean; items: ImportHistoryItem[]; total: number; page: number }> {
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * HISTORY_PAGE_SIZE;
  const { data, error, count } = await admin
    .from("location_import_batches")
    .select("id, source, source_label, status, counts, created_by_user_id, created_at, completed_at", { count: "exact" })
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .range(from, from + HISTORY_PAGE_SIZE - 1);
  if (error) {
    if (!isMissing(error)) console.error("listImportHistory failed:", error.message);
    return { available: false, items: [], total: 0, page: pageNo };
  }
  type Row = { id: string; source: string; source_label: string | null; status: string; counts: Record<string, unknown> | null; created_by_user_id: string | null; created_at: string; completed_at: string | null };
  const rows = (data ?? []) as Row[];
  const [totals, names] = await Promise.all([
    Promise.all(rows.map((r) => admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", r.id))),
    nameFor(admin, [...new Set(rows.map((r) => r.created_by_user_id).filter((v): v is string => Boolean(v)))]),
  ]);
  return {
    available: true,
    total: count ?? rows.length,
    page: pageNo,
    items: rows.map((r, i) => ({
      id: r.id,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      source: r.source,
      sourceLabel: r.source_label,
      status: r.status,
      totalRows: totals[i].count ?? 0,
      outcomes: r.status === "completed" ? { linked: num(r.counts?.linked), created: num(r.counts?.created), updated: num(r.counts?.updated), skipped: num(r.counts?.skipped), failed: num(r.counts?.failed) } : null,
      initiatedBy: r.created_by_user_id ? names.get(r.created_by_user_id) ?? null : null,
    })),
  };
}

export interface ImportBatchDetail extends ImportHistoryItem {
  /** Matching result, by bucket. */
  matching: Record<Exclude<MatchStatus, "pending">, number> & { pending: number };
  /** Rows whose source id was imported before. */
  repeat: number;
  /** failed + undecided/unplaceable rows — what the Business may still want to fix. */
  attention: number;
}


export async function getImportBatchDetail(admin: SupabaseClient, businessId: string, batchId: string): Promise<ImportBatchDetail | null> {
  const { data: batch, error } = await admin
    .from("location_import_batches")
    .select("id, source, source_label, status, counts, created_by_user_id, created_at, completed_at")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !batch) return null;
  const b = batch as { id: string; source: string; source_label: string | null; status: string; counts: Record<string, unknown> | null; created_by_user_id: string | null; created_at: string; completed_at: string | null };
  const rows = () => admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  const statuses = ["pending", "existing", "possible", "new", "invalid", "duplicate"] as const;
  const outcomes = ["linked", "created", "updated", "skipped", "failed"] as const;
  const [total, byStatus, byOutcome, skippedUnplaced, names] = await Promise.all([
    rows(),
    Promise.all(statuses.map((s) => rows().eq("match_status", s))),
    Promise.all(outcomes.map((o) => rows().eq("outcome", o))),
    rows().eq("outcome", "skipped").in("match_status", ["possible", "invalid"]),
    nameFor(admin, b.created_by_user_id ? [b.created_by_user_id] : []),
  ]);
  const matching = Object.fromEntries(statuses.map((s, i) => [s, byStatus[i].count ?? 0])) as ImportBatchDetail["matching"];
  const out = Object.fromEntries(outcomes.map((o, i) => [o, byOutcome[i].count ?? 0])) as unknown as ImportOutcomeCounts;
  const ran = b.status === "completed" || b.status === "importing";
  return {
    id: b.id,
    createdAt: b.created_at,
    completedAt: b.completed_at,
    source: b.source,
    sourceLabel: b.source_label,
    status: b.status,
    totalRows: total.count ?? 0,
    outcomes: ran ? out : null,
    initiatedBy: b.created_by_user_id ? names.get(b.created_by_user_id) ?? null : null,
    matching,
    repeat: num(b.counts?.repeat),
    attention: out.failed + (skippedUnplaced.count ?? 0),
  };
}

export type ImportRowsFilter = "attention" | "created" | "linked" | "updated" | "skipped" | "failed" | "all";
export const IMPORT_ROWS_FILTERS: { key: ImportRowsFilter; label: string }[] = [
  { key: "attention", label: "Needs Attention" },
  { key: "created", label: "New Locations" },
  { key: "linked", label: "Linked" },
  { key: "updated", label: "Updated" },
  { key: "skipped", label: "Skipped" },
  { key: "failed", label: "Failed" },
  { key: "all", label: "All Rows" },
];
export const parseImportRowsFilter = (v: unknown): ImportRowsFilter => (IMPORT_ROWS_FILTERS.some((f) => f.key === v) ? (v as ImportRowsFilter) : "attention");

export interface ImportRowItem {
  id: string;
  rowNumber: number;
  data: ImportRowData;
  matchStatus: MatchStatus;
  problem: string | null;
  outcome: string | null;
  outcomeNote: string | null;
  location: { id: string; name: string; slug: string } | null;
}

export async function listImportRows(admin: SupabaseClient, businessId: string, batchId: string, filter: ImportRowsFilter, page: number): Promise<{ rows: ImportRowItem[]; total: number; page: number } | null> {
  const { data: owned } = await admin.from("location_import_batches").select("id").eq("id", batchId).eq("business_id", businessId).maybeSingle();
  if (!owned) return null;
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const from = (pageNo - 1) * HISTORY_ROWS_PAGE_SIZE;
  let q = admin
    .from("location_import_rows")
    .select("id, row_number, data, match_status, problem, outcome, outcome_note, chosen_location_id, matched_location_id", { count: "exact" })
    .eq("batch_id", batchId);
  if (filter === "attention") q = q.or("outcome.eq.failed,and(outcome.eq.skipped,match_status.in.(possible,invalid))");
  else if (filter !== "all") q = q.eq("outcome", filter);
  const { data, count, error } = await q.order("row_number").range(from, from + HISTORY_ROWS_PAGE_SIZE - 1);
  if (error) return null;
  type Row = { id: string; row_number: number; data: ImportRowData; match_status: MatchStatus; problem: string | null; outcome: string | null; outcome_note: string | null; chosen_location_id: string | null; matched_location_id: string | null };
  const list = (data ?? []) as Row[];
  const locIds = [...new Set(list.map((r) => r.chosen_location_id ?? r.matched_location_id).filter((v): v is string => Boolean(v)))];
  const locs = new Map<string, { id: string; name: string; slug: string }>();
  if (locIds.length > 0) {
    const { data: ls } = await admin.from("locations").select("id, name, slug").in("id", locIds);
    for (const l of (ls ?? []) as { id: string; name: string; slug: string }[]) locs.set(l.id, l);
  }
  return {
    total: count ?? list.length,
    page: pageNo,
    rows: list.map((r) => ({
      id: r.id,
      rowNumber: r.row_number,
      data: r.data,
      matchStatus: r.match_status,
      problem: r.problem,
      outcome: r.outcome,
      outcomeNote: r.outcome_note,
      location: locs.get(r.chosen_location_id ?? r.matched_location_id ?? "") ?? null,
    })),
  };
}

export interface MissingEntry {
  availabilityId: string;
  externalId: string;
  status: string;
  location: { name: string; slug: string; city: string | null; state: string | null };
}

/** Entries this Business imported from the same source EARLIER whose source id is
 * NOT in this file. Information only: a file that omits a place never removes or
 * hides it — the Business decides, one explicit action at a time. */
export async function getMissingFromFile(admin: SupabaseClient, businessId: string, batchId: string): Promise<{ applicable: boolean; total: number; entries: MissingEntry[] }> {
  const { data: batch } = await admin.from("location_import_batches").select("id, source, status").eq("id", batchId).eq("business_id", businessId).maybeSingle();
  const b = batch as { id: string; source: string; status: string } | null;
  if (!b || b.status !== "completed") return { applicable: false, total: 0, entries: [] };
  // Find Us Here only: an Our Locations import has no source-id entries to
  // compare (read on its own so a database without `target` is unaffected).
  const { data: targetRow, error: targetError } = await admin.from("location_import_batches").select("target").eq("id", batchId).maybeSingle();
  if (!targetError && (targetRow as { target?: string } | null)?.target === "our_locations") return { applicable: false, total: 0, entries: [] };

  const inFile = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("location_import_rows").select("external_id").eq("batch_id", batchId).not("external_id", "is", null).order("row_number").range(from, from + 999);
    const list = (data ?? []) as { external_id: string }[];
    for (const r of list) inFile.add(r.external_id);
    if (list.length < 1000) break;
  }
  // No source ids in the file → there is nothing to compare against.
  if (inFile.size === 0) return { applicable: false, total: 0, entries: [] };

  const missing: MissingEntry[] = [];
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("business_location_availability")
      .select("id, external_id, status, locations!inner(name, slug, city, state)")
      .eq("business_id", businessId)
      .eq("external_source", b.source)
      .not("external_id", "is", null)
      .order("id")
      .range(from, from + 999);
    type Row = { id: string; external_id: string; status: string; locations: MissingEntry["location"] | MissingEntry["location"][] | null };
    const list = (data ?? []) as unknown as Row[];
    for (const r of list) {
      if (inFile.has(r.external_id)) continue;
      total += 1;
      const loc = Array.isArray(r.locations) ? r.locations[0] : r.locations;
      if (loc && missing.length < MISSING_LIST_LIMIT) missing.push({ availabilityId: r.id, externalId: r.external_id, status: r.status, location: loc });
    }
    if (list.length < 1000) break;
  }
  return { applicable: true, total, entries: missing };
}
