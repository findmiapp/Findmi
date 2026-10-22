import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createImportedLocation, defaultLocationImportDeps, type LocationImportDeps } from "@/lib/location-import/server";
import { findLikelyDuplicateLocations } from "@/lib/locationCreation";
import { isMissingAvailabilityTable, ALREADY_OUR_LOCATION_ERROR } from "@/lib/business-location-availability";
import { normalizeAvailabilityRelationships, AVAILABILITY_PRODUCT_MAX, type AvailabilityRelationship } from "@/lib/business-availability-domain";
import type { ExistingLocation } from "@/lib/location-import/types";
import { cleanMapping, missingRequiredMapping, rowFromCells, type ColumnMapping, type ImportRowData } from "./fields";
import { classifyImportRow, effectiveAction, findFileDuplicates, preMatchProblem, type KnownSourceEntry, type MatchStatus, type RowDecision } from "./match";
import { LOCATOR_SOURCES, type LocatorSourceId } from "./source";

/** Locator Import — the server half: stage → match → review → import.
 *
 * Nothing is created while staging or matching. Every step is bounded and
 * resumable (the browser calls `matchBatch` / `commitBatch` repeatedly until
 * `remaining` is 0), so a 10,000-row file never needs one long request.
 * Performs NO authorization — the calling action authorizes the Business
 * first (owner / manager / elevated admin) and passes the verified id. The
 * service-role client is the only reader/writer of these tables. */

export const IMPORT_STAGE_CHUNK = 250;
export const IMPORT_MATCH_CHUNK = 30;
export const IMPORT_COMMIT_CHUNK = 15;
/** New unlisted Locations one import may create (the rest stay unresolved for the next one). */
export const IMPORT_NEW_LOCATION_MAX = 150;
const REVIEW_PAGE = 60;

export const IMPORT_UNAVAILABLE = "Importing locations isn't available yet. Please try again soon.";

const isMissing = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (isMissingAvailabilityTable(e) || e.code === "42703" || /column .* does not exist/.test(e.message ?? "")));

export interface ImportCounts {
  total: number;
  existing: number;
  possible: number;
  new: number;
  invalid: number;
  duplicate: number;
  pending: number;
  repeat: number;
}

export interface ImportBatchSummary {
  id: string;
  source: string;
  sourceLabel: string | null;
  status: string;
  counts: ImportCounts;
}

export type ImportResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const emptyCounts = (): ImportCounts => ({ total: 0, existing: 0, possible: 0, new: 0, invalid: 0, duplicate: 0, pending: 0, repeat: 0 });

async function countsFor(admin: SupabaseClient, batchId: string): Promise<ImportCounts> {
  const counts = emptyCounts();
  const statuses: MatchStatus[] = ["pending", "existing", "possible", "new", "invalid", "duplicate"];
  const results = await Promise.all(statuses.map((s) => admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("match_status", s)));
  statuses.forEach((s, i) => {
    counts[s] = results[i].count ?? 0;
  });
  counts.total = statuses.reduce((n, s) => n + counts[s], 0);
  const { data: batch } = await admin.from("location_import_batches").select("counts").eq("id", batchId).maybeSingle();
  counts.repeat = Number(((batch as { counts?: { repeat?: number } } | null)?.counts?.repeat) ?? 0);
  return counts;
}

type OwnedBatch = { batch: { id: string; business_id: string; source: string; source_label: string | null; status: string; mapping: ColumnMapping }; error?: undefined } | { batch?: undefined; error: string };

async function ownedBatch(admin: SupabaseClient, businessId: string, batchId: string): Promise<OwnedBatch> {
  const { data, error } = await admin
    .from("location_import_batches")
    .select("id, business_id, source, source_label, status, mapping")
    .eq("id", batchId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return { error: isMissing(error) ? IMPORT_UNAVAILABLE : "Couldn't load that import." };
  if (!data) return { error: "That import wasn't found." };
  return { batch: data as NonNullable<OwnedBatch["batch"]> };
}

/** Stage: read the file with the chosen mapping, store the normalized rows. Creates nothing else. */
export async function stageImport(
  admin: SupabaseClient,
  businessId: string,
  userId: string | null,
  input: { sourceId: LocatorSourceId; text: string; label: string | null; mapping: unknown }
): Promise<ImportResult<{ batchId: string; counts: ImportCounts }>> {
  const adapter = LOCATOR_SOURCES[input.sourceId];
  if (!adapter) return { ok: false, error: "That source isn't available yet." };
  const read = adapter.read(input.text);
  if (!read.ok) return read;
  const mapping = cleanMapping(input.mapping, read.source.headers.length);
  const missing = missingRequiredMapping(mapping);
  if (missing.length > 0) return { ok: false, error: `Match a column to: ${missing.join(", ")}.` };

  const parsed: ImportRowData[] = read.source.rows.map((cells) => rowFromCells(cells, mapping));
  const dupes = findFileDuplicates(parsed);

  const { data: batch, error } = await admin
    .from("location_import_batches")
    .insert({ business_id: businessId, source: adapter.id, source_label: input.label?.slice(0, 200) || null, mapping, created_by_user_id: userId })
    .select("id")
    .single();
  if (error || !batch) return { ok: false, error: isMissing(error) ? IMPORT_UNAVAILABLE : "Couldn't start that import." };
  const batchId = (batch as { id: string }).id;

  const rows = parsed.map((data, i) => {
    const rowNumber = i + 1;
    const dupeOf = dupes.get(rowNumber);
    const problem = dupeOf ? `Repeats row ${dupeOf}.` : preMatchProblem(data);
    // Rows that can never match are settled now; the rest wait for matching.
    const match_status: MatchStatus = dupeOf ? "duplicate" : problem ? "invalid" : "pending";
    return { batch_id: batchId, row_number: rowNumber, external_id: data.externalId, data, match_status, problem };
  });
  for (let i = 0; i < rows.length; i += IMPORT_STAGE_CHUNK) {
    const { error: rowError } = await admin.from("location_import_rows").insert(rows.slice(i, i + IMPORT_STAGE_CHUNK));
    if (rowError) {
      await admin.from("location_import_batches").delete().eq("id", batchId);
      return { ok: false, error: "Couldn't read that file. Please try again." };
    }
  }
  return { ok: true, batchId, counts: await countsFor(admin, batchId) };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** Match one chunk of pending rows. Returns how many are still pending. */
export async function matchBatch(admin: SupabaseClient, businessId: string, batchId: string): Promise<ImportResult<{ remaining: number; counts: ImportCounts }>> {
  const owned = await ownedBatch(admin, businessId, batchId);
  if (!owned.batch) return { ok: false, error: owned.error };
  const { batch } = owned;

  const { data: pendingRows, error } = await admin
    .from("location_import_rows")
    .select("id, row_number, external_id, data")
    .eq("batch_id", batchId)
    .eq("match_status", "pending")
    .order("row_number")
    .limit(IMPORT_MATCH_CHUNK);
  if (error) return { ok: false, error: isMissing(error) ? IMPORT_UNAVAILABLE : "Couldn't match that import." };
  const rows = (pendingRows ?? []) as { id: string; row_number: number; external_id: string | null; data: ImportRowData }[];

  // Source identities this Business imported before (repeat import).
  const ids = [...new Set(rows.map((r) => r.external_id).filter((v): v is string => Boolean(v)))];
  const known = new Map<string, KnownSourceEntry>();
  if (ids.length > 0) {
    const { data: prior } = await admin
      .from("business_location_availability")
      .select("id, location_id, external_id")
      .eq("business_id", businessId)
      .eq("external_source", batch.source)
      .in("external_id", ids);
    for (const p of (prior ?? []) as { id: string; location_id: string; external_id: string }[]) known.set(p.external_id, { availabilityId: p.id, locationId: p.location_id });
  }

  // Locations this Business already operates can't also be a Find Us Here place.
  const { data: operatedRows } = await admin.from("business_locations").select("location_id").eq("business_id", businessId);
  const operated = new Set(((operatedRows ?? []) as { location_id: string }[]).map((r) => r.location_id));

  let repeat = 0;
  await mapLimit(rows, 5, async (row) => {
    const entry = row.external_id ? known.get(row.external_id) ?? null : null;
    let candidates: ExistingLocation[] = [];
    if (!entry) {
      try {
        candidates = await findLikelyDuplicateLocations(admin, { name: row.data.name ?? "", address: row.data.address, city: row.data.city, state: row.data.state, postal_code: row.data.postalCode });
      } catch {
        candidates = [];
      }
    }
    let match = classifyImportRow(row.data, row.row_number, { known: entry, candidates });
    if (match.status === "existing" && match.matchedLocationId && operated.has(match.matchedLocationId)) {
      match = { ...match, status: "invalid", problem: ALREADY_OUR_LOCATION_ERROR, matchedLocationId: null };
    }
    if (match.repeat) repeat += 1;
    await admin
      .from("location_import_rows")
      .update({ match_status: match.status, matched_location_id: match.matchedLocationId, candidate_location_ids: match.candidateLocationIds, problem: match.problem })
      .eq("id", row.id);
  });

  if (repeat > 0) {
    const { data: current } = await admin.from("location_import_batches").select("counts").eq("id", batchId).maybeSingle();
    const prev = Number(((current as { counts?: { repeat?: number } } | null)?.counts?.repeat) ?? 0);
    await admin.from("location_import_batches").update({ counts: { repeat: prev + repeat } }).eq("id", batchId);
  }
  const counts = await countsFor(admin, batchId);
  if (counts.pending === 0) await admin.from("location_import_batches").update({ status: "matched" }).eq("id", batchId).eq("status", "staged");
  return { ok: true, remaining: counts.pending, counts };
}

export interface ReviewCandidate {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
}

export interface ReviewRow {
  id: string;
  rowNumber: number;
  data: ImportRowData;
  status: MatchStatus;
  problem: string | null;
  decision: RowDecision | null;
  chosenLocationId: string | null;
  matched: ReviewCandidate | null;
  candidates: ReviewCandidate[];
  repeat: boolean;
  outcome: string | null;
  outcomeNote: string | null;
}

const LOCATION_FIELDS = "id, name, address, city, state";

/** One page of rows in one bucket, with the Locations they point at. */
export async function getImportReview(
  admin: SupabaseClient,
  businessId: string,
  batchId: string,
  bucket: MatchStatus,
  page: number
): Promise<ImportResult<{ batch: ImportBatchSummary; rows: ReviewRow[]; hasMore: boolean }>> {
  const owned = await ownedBatch(admin, businessId, batchId);
  if (!owned.batch) return { ok: false, error: owned.error };
  const from = Math.max(0, Math.floor(page)) * REVIEW_PAGE;
  const { data, error } = await admin
    .from("location_import_rows")
    .select("id, row_number, external_id, data, match_status, matched_location_id, candidate_location_ids, problem, decision, chosen_location_id, outcome, outcome_note")
    .eq("batch_id", batchId)
    .eq("match_status", bucket)
    .order("row_number")
    .range(from, from + REVIEW_PAGE);
  if (error) return { ok: false, error: "Couldn't load that review." };
  const all = (data ?? []) as {
    id: string; row_number: number; external_id: string | null; data: ImportRowData; match_status: MatchStatus; matched_location_id: string | null;
    candidate_location_ids: string[]; problem: string | null; decision: RowDecision | null; chosen_location_id: string | null; outcome: string | null; outcome_note: string | null;
  }[];
  const hasMore = all.length > REVIEW_PAGE;
  const rows = all.slice(0, REVIEW_PAGE);
  const locationIds = [...new Set(rows.flatMap((r) => [r.matched_location_id, ...(r.candidate_location_ids ?? [])]).filter((v): v is string => Boolean(v)))];
  const byId = new Map<string, ReviewCandidate>();
  if (locationIds.length > 0) {
    const { data: locs } = await admin.from("locations").select(LOCATION_FIELDS).in("id", locationIds);
    for (const l of (locs ?? []) as ReviewCandidate[]) byId.set(l.id, l);
  }
  const externalIds = [...new Set(rows.map((r) => r.external_id).filter((v): v is string => Boolean(v)))];
  const repeatIds = new Set<string>();
  if (externalIds.length > 0) {
    const { data: prior } = await admin
      .from("business_location_availability")
      .select("external_id")
      .eq("business_id", businessId)
      .eq("external_source", owned.batch.source)
      .in("external_id", externalIds);
    for (const p of (prior ?? []) as { external_id: string }[]) repeatIds.add(p.external_id);
  }
  const counts = await countsFor(admin, batchId);
  return {
    ok: true,
    batch: { id: batchId, source: owned.batch.source, sourceLabel: owned.batch.source_label, status: owned.batch.status, counts },
    hasMore,
    rows: rows.map((r) => ({
      id: r.id,
      rowNumber: r.row_number,
      data: r.data,
      status: r.match_status,
      problem: r.problem,
      decision: r.decision,
      chosenLocationId: r.chosen_location_id,
      matched: r.matched_location_id ? byId.get(r.matched_location_id) ?? null : null,
      candidates: (r.candidate_location_ids ?? []).map((id) => byId.get(id)).filter((c): c is ReviewCandidate => Boolean(c)),
      repeat: Boolean(r.external_id) && repeatIds.has(r.external_id as string),
      outcome: r.outcome,
      outcomeNote: r.outcome_note,
    })),
  };
}

export interface DecisionInput {
  rowId: string;
  decision: RowDecision | null;
  chosenLocationId?: string | null;
}

/** Record the Business's review decisions (validated per row against its bucket). */
export async function setImportDecisions(admin: SupabaseClient, businessId: string, batchId: string, decisions: readonly DecisionInput[]): Promise<ImportResult> {
  const owned = await ownedBatch(admin, businessId, batchId);
  if (!owned.batch) return { ok: false, error: owned.error };
  if (owned.batch.status === "completed" || owned.batch.status === "importing") return { ok: false, error: "This import already ran." };
  const wanted = decisions.slice(0, 200);
  if (wanted.length === 0) return { ok: true };
  const { data } = await admin
    .from("location_import_rows")
    .select("id, match_status, candidate_location_ids, outcome")
    .eq("batch_id", batchId)
    .in("id", wanted.map((d) => d.rowId));
  const rows = new Map(((data ?? []) as { id: string; match_status: MatchStatus; candidate_location_ids: string[]; outcome: string | null }[]).map((r) => [r.id, r]));
  for (const d of wanted) {
    const row = rows.get(d.rowId);
    if (!row || row.outcome) continue;
    let decision: RowDecision | null = d.decision;
    let chosen: string | null = null;
    if (decision === "use_match") {
      // Only a candidate the matcher itself offered can be chosen.
      if (row.match_status !== "possible" || !d.chosenLocationId || !row.candidate_location_ids.includes(d.chosenLocationId)) continue;
      chosen = d.chosenLocationId;
    } else if (decision === "create_new") {
      if (row.match_status !== "possible" && row.match_status !== "new") continue;
    } else if (decision !== "skip") decision = null;
    await admin.from("location_import_rows").update({ decision, chosen_location_id: chosen }).eq("id", row.id);
  }
  return { ok: true };
}

export interface CommitOptions {
  /** Used for rows that don't carry their own relationship. */
  defaultRelationships: readonly string[];
  productIds: readonly string[];
}

export interface CommitProgress {
  remaining: number;
  done: boolean;
  summary: { linked: number; created: number; updated: number; skipped: number; failed: number; unresolved: number };
}

async function summaryFor(admin: SupabaseClient, batchId: string): Promise<CommitProgress["summary"]> {
  const out = { linked: 0, created: 0, updated: 0, skipped: 0, failed: 0, unresolved: 0 };
  const keys = ["linked", "created", "updated", "skipped", "failed"] as const;
  const results = await Promise.all(keys.map((k) => admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("outcome", k)));
  keys.forEach((k, i) => {
    out[k] = results[i].count ?? 0;
  });
  return out;
}

/** Link (or update) one Location on this Business's Find Us Here. Repeat-safe:
 * the entry already tied to this source id, or to this Location, is UPDATED —
 * never duplicated. Always source 'business'; a new or changed entry lands in
 * (or returns to) Pending Review, exactly like a hand-entered one. */
async function linkAvailability(
  admin: SupabaseClient,
  businessId: string,
  batch: { id: string; source: string },
  row: { external_id: string | null },
  locationId: string,
  relationships: AvailabilityRelationship[],
  productIds: readonly string[]
): Promise<{ ok: true; updated: boolean; id: string } | { ok: false; error: string }> {
  const { data: ours } = await admin.from("business_locations").select("id").eq("business_id", businessId).eq("location_id", locationId).maybeSingle();
  if (ours) return { ok: false, error: ALREADY_OUR_LOCATION_ERROR };
  const { data: loc } = await admin.from("locations").select("id, trashed_at").eq("id", locationId).maybeSingle();
  if (!loc || (loc as { trashed_at: string | null }).trashed_at) return { ok: false, error: "That Location doesn't exist on Findmi." };

  // Same source id first, else the same Location.
  type ExistingEntry = { id: string; relationships: string[] | null; relationship: string; external_id: string | null };
  let existing = null as ExistingEntry | null;
  if (row.external_id) {
    const { data } = await admin
      .from("business_location_availability")
      .select("id, relationships, relationship, external_id")
      .eq("business_id", businessId)
      .eq("external_source", batch.source)
      .eq("external_id", row.external_id)
      .maybeSingle();
    existing = (data as ExistingEntry | null) ?? null;
  }
  if (!existing) {
    const { data } = await admin
      .from("business_location_availability")
      .select("id, relationships, relationship, external_id")
      .eq("business_id", businessId)
      .eq("location_id", locationId)
      .maybeSingle();
    existing = (data as ExistingEntry | null) ?? null;
  }

  const identity = row.external_id ? { external_source: batch.source, external_id: row.external_id, import_batch_id: batch.id } : { import_batch_id: batch.id };
  let availabilityId: string;
  let updated = false;
  if (existing) {
    const current = normalizeAvailabilityRelationships(existing.relationships && existing.relationships.length > 0 ? existing.relationships : [existing.relationship]);
    const merged = normalizeAvailabilityRelationships([...current, ...relationships]);
    const changed = merged.length !== current.length;
    // A repeat import adds what's new; it never removes how the Business is there.
    const patch: Record<string, unknown> = { ...identity, location_id: locationId };
    if (changed) Object.assign(patch, { relationships: merged, relationship: merged[0], status: "pending", source: "business" });
    const { error } = await admin.from("business_location_availability").update(patch).eq("id", existing.id).eq("business_id", businessId);
    if (error) return { ok: false, error: error.code === "23505" ? "Another entry already uses this source id." : "Couldn't update that entry." };
    availabilityId = existing.id;
    updated = true;
  } else {
    const { data, error } = await admin
      .from("business_location_availability")
      .insert({ business_id: businessId, location_id: locationId, status: "pending", source: "business", relationships, relationship: relationships[0], ...identity })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.code === "23505" ? "You’re already connected to that location." : "Couldn't save that entry." };
    availabilityId = (data as { id: string }).id;
  }

  if (productIds.length > 0) {
    // Products are added, never replaced, by an import.
    const { data: have } = await admin.from("business_location_availability_products").select("product_id").eq("availability_id", availabilityId);
    const haveIds = new Set(((have ?? []) as { product_id: string }[]).map((r) => r.product_id));
    const add = productIds.filter((id) => !haveIds.has(id));
    if (add.length > 0 && haveIds.size + add.length <= AVAILABILITY_PRODUCT_MAX) {
      const { error } = await admin.from("business_location_availability_products").insert(add.map((product_id) => ({ availability_id: availabilityId, product_id })));
      if (error) return { ok: false, error: "Saved the place, but couldn't attach the products." };
      if (updated) await admin.from("business_location_availability").update({ status: "pending", source: "business" }).eq("id", availabilityId);
    }
  }
  return { ok: true, updated, id: availabilityId };
}

/** Import one chunk of reviewed rows. Call until `done`. */
export async function commitBatch(
  admin: SupabaseClient,
  businessId: string,
  batchId: string,
  options: CommitOptions,
  deps: LocationImportDeps = defaultLocationImportDeps(admin)
): Promise<ImportResult<CommitProgress>> {
  const owned = await ownedBatch(admin, businessId, batchId);
  if (!owned.batch) return { ok: false, error: owned.error };
  const { batch } = owned;
  if (batch.status === "completed") return { ok: true, remaining: 0, done: true, summary: await summaryFor(admin, batchId) };
  if (batch.status === "cancelled") return { ok: false, error: "That import was cancelled." };
  const { count: pending } = await admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("match_status", "pending");
  if ((pending ?? 0) > 0) return { ok: false, error: "Still matching — try again in a moment." };

  const defaults = normalizeAvailabilityRelationships(options.defaultRelationships);
  if (defaults.length === 0) return { ok: false, error: "Choose how you’re at these places." };
  const productIds = [...new Set(options.productIds.filter(Boolean))].slice(0, AVAILABILITY_PRODUCT_MAX);
  if (productIds.length > 0) {
    const { data: owned } = await admin.from("products").select("id").eq("business_id", businessId).in("id", productIds);
    if (((owned ?? []) as unknown[]).length !== productIds.length) return { ok: false, error: "One of those products isn't part of your catalog." };
  }
  await admin.from("location_import_batches").update({ status: "importing" }).eq("id", batchId);

  const { data: todo, error } = await admin
    .from("location_import_rows")
    .select("id, row_number, external_id, data, match_status, matched_location_id, candidate_location_ids, decision, chosen_location_id, problem")
    .eq("batch_id", batchId)
    .is("outcome", null)
    .order("row_number")
    .limit(200);
  if (error) return { ok: false, error: "Couldn't continue that import." };
  const rows = (todo ?? []) as { id: string; row_number: number; external_id: string | null; data: ImportRowData; match_status: MatchStatus; matched_location_id: string | null; candidate_location_ids: string[]; decision: RowDecision | null; chosen_location_id: string | null; problem: string | null }[];

  // Rows that won't act (skip / unresolved) are settled without spending the chunk budget.
  const { count: createdSoFar } = await admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("outcome", "created");
  let created = createdSoFar ?? 0;
  let work = 0;
  for (const row of rows) {
    if (work >= IMPORT_COMMIT_CHUNK) break;
    const action = effectiveAction(row);
    const settle = (outcome: "linked" | "created" | "updated" | "skipped" | "failed", note: string | null, extra: Record<string, unknown> = {}) =>
      admin.from("location_import_rows").update({ outcome, outcome_note: note?.slice(0, 300) ?? null, ...extra }).eq("id", row.id);
    if (action.kind === "skip") {
      await settle("skipped", action.reason);
      continue;
    }
    if (action.kind === "unresolved") {
      // Stays open: shown as "Needs a decision" and left out of this import.
      await settle("skipped", action.reason);
      continue;
    }
    work += 1;
    const relationships = row.data.relationships && row.data.relationships.length > 0 ? row.data.relationships : defaults;
    let locationId: string;
    let wasCreated = false;
    if (action.kind === "create") {
      if (created >= IMPORT_NEW_LOCATION_MAX) {
        await settle("skipped", "Too many new Locations in one import — import again for the rest.");
        continue;
      }
      const result = await createImportedLocation(
        admin,
        { name: row.data.name ?? "", address: row.data.address ?? "", city: row.data.city ?? "", state: row.data.state ?? "", postalCode: row.data.postalCode, website: row.data.website, phone: row.data.phone },
        deps,
        { force: row.decision === "create_new" }
      );
      if (result.status === "duplicates") {
        // Found a likely duplicate at commit time (e.g. created since matching) — never force it silently.
        await settle("skipped", "A matching Location appeared since matching. Re-run the import to review it.");
        continue;
      }
      if (result.status !== "created") {
        await settle("failed", result.status === "error" ? result.error : "Couldn't create that Location.");
        continue;
      }
      locationId = result.location.id;
      wasCreated = true;
      created += 1;
    } else {
      locationId = action.locationId;
    }
    const linked = await linkAvailability(admin, businessId, batch, row, locationId, relationships, productIds);
    if (!linked.ok) {
      await settle("failed", linked.error, wasCreated ? { chosen_location_id: locationId } : {});
      continue;
    }
    await settle(wasCreated ? "created" : linked.updated ? "updated" : "linked", null, { availability_id: linked.id, chosen_location_id: locationId });
  }

  const { count: left } = await admin.from("location_import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).is("outcome", null);
  const remaining = left ?? 0;
  const summary = await summaryFor(admin, batchId);
  if (remaining === 0) {
    const { data: prior } = await admin.from("location_import_batches").select("counts").eq("id", batchId).maybeSingle();
    const before = ((prior as { counts?: Record<string, number> } | null)?.counts ?? {}) as Record<string, number>;
    await admin.from("location_import_batches").update({ status: "completed", completed_at: new Date().toISOString(), counts: { ...before, ...summary } }).eq("id", batchId);
  }
  return { ok: true, remaining, done: remaining === 0, summary };
}

export async function cancelImport(admin: SupabaseClient, businessId: string, batchId: string): Promise<ImportResult> {
  const owned = await ownedBatch(admin, businessId, batchId);
  if (!owned.batch) return { ok: false, error: owned.error };
  if (owned.batch.status === "completed") return { ok: false, error: "This import already ran." };
  await admin.from("location_import_batches").update({ status: "cancelled" }).eq("id", batchId);
  return { ok: true };
}

/** Whether the staging tables exist (the page shows a plain notice until the migration is applied). */
export async function importAvailable(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from("location_import_batches").select("id").limit(1);
  return !isMissing(error);
}
