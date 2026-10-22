import type { SupabaseClient } from "@supabase/supabase-js";
import { AVAILABILITY_PRODUCT_MAX, normalizeAvailabilityRelationships, statusAfterOwnerEdit, type AvailabilityRelationship } from "./business-availability-domain";
import {
  BULK_CHUNK,
  BULK_IDS_MAX,
  bulkOpReturnsToReview,
  emptyBulkProgress,
  planRelationships,
  type AvailabilityFilter,
  type BulkOp,
  type BulkProgress,
} from "./business-availability-bulk-domain";
import { applyAvailabilityFilter } from "./business-availability-owner";

/** Find Us Here at scale — bulk changes to a Business's footprint.
 *
 * Every write is scoped by `business_id` and touches only the availability
 * entry (the Business ↔ Location relationship) and its Product links. A
 * canonical Location is never edited or deleted, and removal here only takes the
 * place off THIS Business's footprint. Bulk edits follow the single-entry review
 * rule (business-availability-domain.ts statusAfterOwnerEdit): only adding a way
 * the Business is there returns an entry to Pending Review; product / Product Set
 * changes and narrowing leave every status as approved, so a Business's
 * hundreds of live entries never drop off its profile because of ordinary
 * maintenance. Requests are chunked
 * (`BULK_CHUNK`) and resumable by cursor, so thousands of entries never need
 * one long request. The caller authorizes the Business first. */

export type BulkScope = { kind: "ids"; ids: string[] } | { kind: "filter"; filter: AvailabilityFilter };

export type BulkResult = { ok: true; progress: BulkProgress; nextCursor: string | null; done: boolean } | { ok: false; error: string };

const isMissingColumn = (e: { code?: string } | null | undefined) => Boolean(e && e.code === "42703");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const skip = (p: BulkProgress, reason: string, count: number) => {
  if (count <= 0) return;
  const hit = p.skipped.find((s) => s.reason === reason);
  if (hit) hit.count += count;
  else p.skipped.push({ reason, count });
};

interface EntryRow {
  id: string;
  relationship: AvailabilityRelationship;
  relationships?: AvailabilityRelationship[] | null;
  status: string;
}

/** The next chunk of entry ids for a scope: `cursor` is the last id handled
 * (filter scope) or the offset (ids scope). */
async function nextChunk(admin: SupabaseClient, businessId: string, scope: BulkScope, cursor: string | null): Promise<{ ids: string[]; nextCursor: string | null } | { error: string }> {
  if (scope.kind === "ids") {
    const all = [...new Set(scope.ids.filter((id) => UUID_RE.test(id)))].slice(0, BULK_IDS_MAX);
    const offset = cursor ? Number(cursor) || 0 : 0;
    const ids = all.slice(offset, offset + BULK_CHUNK);
    return { ids, nextCursor: offset + BULK_CHUNK < all.length ? String(offset + BULK_CHUNK) : null };
  }
  const read = (multi: boolean) => {
    let q = applyAvailabilityFilter(
      admin.from("business_location_availability").select(`id, locations!inner(id)`).eq("business_id", businessId),
      scope.filter,
      multi
    );
    if (cursor) q = q.gt("id", cursor);
    return q.order("id").limit(BULK_CHUNK + 1);
  };
  let { data, error } = await read(true);
  if (isMissingColumn(error)) ({ data, error } = await read(false));
  if (error) return { error: "Couldn't read that list. Please try again." };
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const more = ids.length > BULK_CHUNK;
  const chunk = ids.slice(0, BULK_CHUNK);
  return { ids: chunk, nextCursor: more ? chunk[chunk.length - 1] : null };
}

async function readEntries(admin: SupabaseClient, businessId: string, ids: string[]): Promise<EntryRow[] | null> {
  const read = (multi: boolean) => admin.from("business_location_availability").select(`id, relationship, ${multi ? "relationships, " : ""}status`).eq("business_id", businessId).in("id", ids);
  let { data, error } = await read(true);
  if (isMissingColumn(error)) ({ data, error } = await read(false));
  if (error) return null;
  return (data ?? []) as unknown as EntryRow[];
}

const currentRelationships = (r: EntryRow) => normalizeAvailabilityRelationships(r.relationships && r.relationships.length > 0 ? r.relationships : [r.relationship]);

async function ownedProductIds(admin: SupabaseClient, businessId: string, productIds: string[]): Promise<Set<string>> {
  const { data } = await admin.from("products").select("id").eq("business_id", businessId).in("id", productIds);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

export async function bulkAvailability(admin: SupabaseClient, businessId: string, scope: BulkScope, op: BulkOp, cursor: string | null): Promise<BulkResult> {
  const chunk = await nextChunk(admin, businessId, scope, cursor);
  if ("error" in chunk) return { ok: false, error: chunk.error };
  const progress = emptyBulkProgress();
  const done = chunk.nextCursor === null;
  if (chunk.ids.length === 0) return { ok: true, progress, nextCursor: null, done: true };

  // Products an op uses, verified to be this Business's own — once per chunk.
  let productIds: string[] = [];
  if (op.kind === "add_products" || op.kind === "remove_products") productIds = op.productIds;
  if (op.kind === "apply_set") {
    const { data: set } = await admin.from("business_product_sets").select("id, business_product_set_items(product_id)").eq("id", op.setId).eq("business_id", businessId).maybeSingle();
    if (!set) return { ok: false, error: "That Product Set wasn't found." };
    productIds = ((set as unknown as { business_product_set_items: { product_id: string }[] | null }).business_product_set_items ?? []).map((i) => i.product_id);
    if (productIds.length === 0) return { ok: false, error: "That Product Set has no products." };
  }
  if (productIds.length > 0) {
    const owned = await ownedProductIds(admin, businessId, productIds);
    productIds = productIds.filter((id) => owned.has(id));
    if (productIds.length === 0) return { ok: false, error: "Those products aren't part of your catalog." };
  }

  const rows = await readEntries(admin, businessId, chunk.ids);
  if (!rows) return { ok: false, error: "Couldn't read those entries. Please try again." };
  progress.processed = rows.length;
  const missing = chunk.ids.length - rows.length;
  skip(progress, "Not found", missing);

  if (op.kind === "remove_from_footprint") {
    const { error } = await admin.from("business_location_availability").delete().eq("business_id", businessId).in("id", rows.map((r) => r.id));
    if (error) return { ok: false, error: "Couldn't remove those. Please try again." };
    progress.changed = rows.length;
    return { ok: true, progress, nextCursor: chunk.nextCursor, done };
  }

  if (op.kind === "add_relationships" || op.kind === "remove_relationships") {
    // Group entries by their resulting set: a few combinations, not one write per entry.
    // Adding a way the Business is there is a new public claim → Pending Review; taking
    // one away only narrows what was approved, so the entry keeps its status.
    const adding = op.kind === "add_relationships";
    const groups = new Map<string, { next: AvailabilityRelationship[]; rows: EntryRow[] }>();
    for (const r of rows) {
      const plan = planRelationships(currentRelationships(r), op);
      if ("skip" in plan) {
        skip(progress, plan.skip, 1);
      } else if (!plan.changed) {
        progress.unchanged += 1;
      } else {
        const key = plan.next.join(",");
        const g = groups.get(key) ?? { next: plan.next, rows: [] };
        g.rows.push(r);
        groups.set(key, g);
      }
    }
    for (const g of groups.values()) {
      const review = adding ? { status: "pending", source: "business" } : {};
      const fields = { relationships: g.next, relationship: g.next[0], ...review };
      let { error } = await admin.from("business_location_availability").update(fields).eq("business_id", businessId).in("id", g.rows.map((r) => r.id));
      if (isMissingColumn(error)) {
        // Multi-relationship migration pending: only a single relationship can be stored.
        if (g.next.length > 1) {
          skip(progress, "Choosing more than one isn’t available yet", g.rows.length);
          continue;
        }
        ({ error } = await admin.from("business_location_availability").update({ relationship: g.next[0], ...review }).eq("business_id", businessId).in("id", g.rows.map((r) => r.id)));
      }
      if (error) {
        skip(progress, "Couldn't save", g.rows.length);
        continue;
      }
      progress.changed += g.rows.length;
      if (adding) {
        progress.returnedToReview += g.rows.filter((r) => r.status === "live" && statusAfterOwnerEdit(r.status, { relationshipsBefore: currentRelationships(r), relationshipsAfter: g.next }) === "pending").length;
      }
    }
    return { ok: true, progress, nextCursor: chunk.nextCursor, done };
  }

  // Product ops: read the links of this chunk once.
  const { data: linkRows } = await admin.from("business_location_availability_products").select("availability_id, product_id").in("availability_id", rows.map((r) => r.id));
  const have = new Map<string, Set<string>>();
  for (const l of (linkRows ?? []) as { availability_id: string; product_id: string }[]) {
    const set = have.get(l.availability_id) ?? new Set<string>();
    set.add(l.product_id);
    have.set(l.availability_id, set);
  }
  const changedRows: EntryRow[] = [];
  if (op.kind === "remove_products") {
    for (const r of rows) {
      const present = productIds.filter((id) => have.get(r.id)?.has(id));
      if (present.length === 0) progress.unchanged += 1;
      else changedRows.push(r);
    }
    const target = changedRows.map((r) => r.id);
    for (let i = 0; i < target.length; i += BULK_CHUNK) {
      const { error } = await admin.from("business_location_availability_products").delete().in("availability_id", target.slice(i, i + BULK_CHUNK)).in("product_id", productIds);
      if (error) return { ok: false, error: "Couldn't remove those products. Please try again." };
    }
  } else {
    const inserts: { availability_id: string; product_id: string }[] = [];
    for (const r of rows) {
      const current = have.get(r.id) ?? new Set<string>();
      const add = productIds.filter((id) => !current.has(id));
      if (add.length === 0) {
        progress.unchanged += 1;
        continue;
      }
      if (current.size + add.length > AVAILABILITY_PRODUCT_MAX) {
        skip(progress, `Would exceed ${AVAILABILITY_PRODUCT_MAX} products`, 1);
        continue;
      }
      for (const product_id of add) inserts.push({ availability_id: r.id, product_id });
      changedRows.push(r);
    }
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await admin.from("business_location_availability_products").insert(inserts.slice(i, i + 500));
      if (error) return { ok: false, error: "Couldn't add those products. Please try again." };
    }
  }
  // Products are the Business's own and the entry's place and relationships don't
  // change — ordinary management of an approved entry, so every status stays as it was.
  progress.changed = changedRows.length;
  return { ok: true, progress, nextCursor: chunk.nextCursor, done };
}

export { bulkOpReturnsToReview };
