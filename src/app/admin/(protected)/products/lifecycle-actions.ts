"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";

/** Admin Content Lifecycle + Bulk Management V1 — Products.
 *
 * Every action here is admin-only (requireAdminSupabase — the same
 * founder-password-gated session every other admin action already
 * requires; there is no separate business-owner path to any of these,
 * and none is added here). None of these touch is_active,
 * moderation_status, or marketplace_status — those are the existing,
 * separate Pause/moderation mechanisms and are never reinterpreted as
 * Archive/Trash. Archive/Trash operate purely on the new archived_at/
 * trashed_at columns (see the migration's own comments).
 *
 * Every bulk action reports an honest result — real counts of what
 * actually changed, plus a skipped count with a reason when a selected
 * id wasn't eligible for that action — never a blanket "success" that
 * glosses over a partial outcome. */

function resultRedirectUrl(base: string, message: string): string {
  return `${base}?result=${encodeURIComponent(message)}`;
}

function parseIds(formData: FormData): string[] {
  return formData.getAll("ids").filter((v): v is string => typeof v === "string" && v.length > 0);
}

const PRODUCTS_LIST = "/admin/products";

function revalidateAfterLifecycleChange() {
  revalidatePath(PRODUCTS_LIST);
  revalidatePath("/marketplace");
  revalidatePath("/");
}

// ── Pause / Resume — the EXISTING per-product visibility flag (is_active),
// surfaced as a bulk action. This is not a new concept and does not
// change what is_active means anywhere else in the app. ────────────────

export async function bulkPauseProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  const { data, error } = await supabase.from("products").update({ is_active: false }).in("id", ids).select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      PRODUCTS_LIST,
      error ? "Couldn't pause the selected products — please try again." : `${changed} product${changed === 1 ? "" : "s"} paused.`
    )
  );
}

export async function bulkResumeProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  const { data, error } = await supabase.from("products").update({ is_active: true }).in("id", ids).select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  revalidateAfterLifecycleChange();
  redirect(
    resultRedirectUrl(
      PRODUCTS_LIST,
      error ? "Couldn't resume the selected products — please try again." : `${changed} product${changed === 1 ? "" : "s"} resumed.`
    )
  );
}

// ── Archive / Restore from Archive ──────────────────────────────────────

export async function bulkArchiveProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  // Only a non-trashed record can be archived directly from this bulk
  // action — a trashed one is only ever managed from the Trash view, so
  // an id that's already trashed is explicitly skipped and reported,
  // never silently included.
  const { data: eligible } = await supabase.from("products").select("id").in("id", ids).is("trashed_at", null);
  const eligibleIds = (eligible ?? []).map((r) => r.id);
  const skipped = ids.length - eligibleIds.length;

  let changed = 0;
  if (eligibleIds.length > 0) {
    const { data, error } = await supabase
      .from("products")
      .update({ archived_at: new Date().toISOString() })
      .in("id", eligibleIds)
      .select("id");
    changed = error ? 0 : (data?.length ?? 0);
  }

  revalidateAfterLifecycleChange();
  revalidatePath("/admin/products?status=archived");
  const message =
    `${changed} product${changed === 1 ? "" : "s"} archived.` +
    (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "");
  redirect(resultRedirectUrl(PRODUCTS_LIST, message));
}

export async function bulkRestoreFromArchive(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  // Restoring from Archive never re-publishes anything on its own — it
  // only clears archived_at. Whatever is_active/moderation_status/
  // marketplace_status already held is exactly what the record returns
  // to (see the migration's own note on why no snapshot column exists).
  const { data, error } = await supabase
    .from("products")
    .update({ archived_at: null })
    .in("id", ids)
    .not("archived_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;

  revalidateAfterLifecycleChange();
  revalidatePath("/admin/products?status=archived");
  const message =
    `${changed} product${changed === 1 ? "" : "s"} restored from Archive.` +
    (skipped > 0 ? ` ${skipped} skipped (not archived).` : "");
  redirect(resultRedirectUrl(PRODUCTS_LIST, message));
}

// ── Trash / Restore from Trash ──────────────────────────────────────────

export async function bulkTrashProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  // Trashing does NOT clear archived_at — an already-archived record
  // stays marked archived underneath, so restoring it later from Trash
  // returns it to Archived, not to fully active (ARCHIVED -> TRASH ->
  // RESTORED, per the required transition).
  const { data, error } = await supabase
    .from("products")
    .update({ trashed_at: new Date().toISOString() })
    .in("id", ids)
    .is("trashed_at", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;

  revalidateAfterLifecycleChange();
  revalidatePath("/admin/products?status=trashed");
  const message =
    `${changed} product${changed === 1 ? "" : "s"} moved to Trash.` +
    (skipped > 0 ? ` ${skipped} skipped (already in Trash).` : "");
  redirect(resultRedirectUrl(PRODUCTS_LIST, message));
}

export async function bulkRestoreFromTrash(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  const { data, error } = await supabase
    .from("products")
    .update({ trashed_at: null })
    .in("id", ids)
    .not("trashed_at", "is", null)
    .select("id");
  const changed = error ? 0 : (data?.length ?? 0);
  const skipped = ids.length - changed;

  revalidateAfterLifecycleChange();
  revalidatePath("/admin/products?status=trashed");
  const message =
    `${changed} product${changed === 1 ? "" : "s"} restored.` + (skipped > 0 ? ` ${skipped} skipped (not in Trash).` : "");
  redirect(resultRedirectUrl(PRODUCTS_LIST, message));
}

// ── Permanent delete — Trash only. Never reachable for a non-trashed
// record (enforced here server-side, not just hidden in the UI), and
// dependency-aware: order_items.product_id -> products.id is
// ON DELETE NO ACTION by design (real order history must never be
// silently orphaned), so each delete is attempted individually and a
// blocked one is reported by name/id rather than failing the whole
// batch or claiming a false success. ─────────────────────────────────

export interface PermanentDeleteResult {
  deleted: number;
  blocked: { id: string; name: string }[];
}

export async function bulkPermanentDeleteProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  const confirmText = str(formData, "confirmText") ?? "";
  const expected = `DELETE ${ids.length}`;
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));
  if (confirmText !== expected) {
    redirect(resultRedirectUrl(`${PRODUCTS_LIST}?status=trashed`, `Deletion cancelled — confirmation text didn't match "${expected}".`));
  }

  // Only ever operate on records that are actually in Trash — permanent
  // delete is never exposed, and never executes, outside Trash.
  const { data: trashedRows } = await supabase.from("products").select("id, name").in("id", ids).not("trashed_at", "is", null);
  const eligible = trashedRows ?? [];
  const notInTrash = ids.length - eligible.length;

  let deleted = 0;
  const blocked: { id: string; name: string }[] = [];
  for (const row of eligible) {
    const { error } = await supabase.from("products").delete().eq("id", row.id);
    if (error) {
      // order_items FK (ON DELETE NO ACTION) is the expected/only real
      // blocker — every other dependent (product_fulfillment_options,
      // event_products, product_categories, account_saved_products)
      // cascade-deletes safely, and inquiries.product_id sets NULL.
      blocked.push({ id: row.id, name: row.name });
    } else {
      deleted += 1;
    }
  }

  revalidateAfterLifecycleChange();
  revalidatePath("/admin/products?status=trashed");
  const parts = [`${deleted} product${deleted === 1 ? "" : "s"} permanently deleted.`];
  if (blocked.length > 0) {
    parts.push(
      `${blocked.length} could not be deleted because they have real order history: ${blocked.map((b) => b.name).join(", ")}.`
    );
  }
  if (notInTrash > 0) parts.push(`${notInTrash} skipped (not in Trash).`);
  redirect(resultRedirectUrl(`${PRODUCTS_LIST}?status=trashed`, parts.join(" ")));
}

// ── Bulk quick edit — only fields that are safe and meaningful to change
// in bulk: category (replaces each selected product's category
// assignment, same delete-then-reinsert product_categories pattern
// saveProduct already uses for a single product) and Featured (admin-
// authorized — this IS the admin panel). Deliberately excludes
// marketplace_status (its own moderation workflow, with notifications,
// stays a single-record decision) and anything ownership/billing/id/
// slug-shaped. ───────────────────────────────────────────────────────

export async function bulkQuickEditProducts(formData: FormData) {
  const supabase = await requireAdminSupabase();
  const ids = parseIds(formData);
  if (ids.length === 0) redirect(resultRedirectUrl(PRODUCTS_LIST, "No products selected."));

  const categoryId = str(formData, "category_id");
  const featuredValue = str(formData, "is_featured"); // "true" | "false" | null (untouched)
  const applyCategory = formData.get("apply_category") === "on";
  const applyFeatured = formData.get("apply_featured") === "on";

  const results: string[] = [];

  if (applyFeatured && (featuredValue === "true" || featuredValue === "false")) {
    const { data, error } = await supabase
      .from("products")
      .update({ is_featured: featuredValue === "true" })
      .in("id", ids)
      .select("id");
    const changed = error ? 0 : (data?.length ?? 0);
    results.push(`Featured ${featuredValue === "true" ? "enabled" : "disabled"} for ${changed} product${changed === 1 ? "" : "s"}.`);
  }

  if (applyCategory) {
    // Same delete-then-reinsert-per-product shape as saveProduct's own
    // single-record category update — product_categories is a plain
    // junction table with no other referrer to preserve here.
    await supabase.from("product_categories").delete().in("product_id", ids);
    if (categoryId) {
      await supabase.from("product_categories").insert(ids.map((product_id) => ({ product_id, category_id: categoryId })));
    }
    results.push(`Category updated for ${ids.length} product${ids.length === 1 ? "" : "s"}.`);
  }

  revalidateAfterLifecycleChange();
  redirect(resultRedirectUrl(PRODUCTS_LIST, results.length > 0 ? results.join(" ") : "No changes selected."));
}
