// Shared create/edit logic for the three kind-specific category admin
// screens (Business/Event/Product Categories — see /admin/categories,
// /admin/categories/events, /admin/categories/products). One
// implementation instead of three copies, matching every other entity's
// pattern of a shared slug utility (lib/slug) plus a per-kind uniqueness
// check (isCategorySlugTaken) — see the taxonomy foundation pass.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCategorySlugTaken } from "./queries";
import { str } from "./form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import type { CategoryKind } from "@/lib/types";

interface CategoryActionResult {
  error?: string;
}

/** Creates one new category of the given kind from a "Name" + "Slug"
 * mini-form (see NameSlugFields). Slug is normalized/generated/deduped
 * server-side regardless of what the client submitted. */
export async function createCategoryRow(
  supabase: SupabaseClient,
  kind: CategoryKind,
  formData: FormData
): Promise<CategoryActionResult> {
  const name = str(formData, "name");
  if (!name) return { error: "Name is required." };

  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) return { error: "Name is required to generate a slug." };
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isCategorySlugTaken(kind, candidate));

  const { error } = await supabase.from("categories").insert({ name, slug, kind, show_on_home: false });
  if (error) return { error: error.message };
  return {};
}

export interface CategoryRowEdit {
  id: string;
  name: string | null;
  slug: string | null;
  /** Business-kind screens only — omitted entirely for event/product
   * rows, which have no homepage-visibility concept. */
  show_on_home?: boolean;
  home_sort_order?: number | null;
}

/** Bulk-saves edits to every existing row on one kind's screen in a
 * single submit — the same "one form covers the whole list" shape
 * /admin/categories' homepage-toggle screen already used before this
 * pass, now also covering name/slug. A row with a blank name is left
 * untouched rather than wiping out its name. */
export async function saveCategoryRows(
  supabase: SupabaseClient,
  kind: CategoryKind,
  rows: CategoryRowEdit[]
): Promise<CategoryActionResult> {
  for (const row of rows) {
    if (!row.name) continue;
    const baseSlug = resolveSlugInput(row.slug, row.name);
    if (!baseSlug) continue;
    const slug = await ensureUniqueSlug(baseSlug, (candidate) => isCategorySlugTaken(kind, candidate, row.id));

    const payload: Record<string, unknown> = { name: row.name, slug };
    if (row.show_on_home !== undefined) payload.show_on_home = row.show_on_home;
    if (row.home_sort_order !== undefined) payload.home_sort_order = row.home_sort_order;

    const { error } = await supabase.from("categories").update(payload).eq("id", row.id);
    if (error) return { error: error.message };
  }
  return {};
}

// ── Category Admin Usability pass — safe delete + business reorder ──────
// Both added here (not a new file) to stay next to create/save above,
// sharing the same CategoryActionResult shape and per-kind pattern.

/** Deletes one category, but only after re-checking (server-side, never
 * trusting a disabled client button alone) that nothing actually
 * references it. This check exists BECAUSE the DB doesn't do it for us:
 * business_categories/event_categories/product_categories all have
 * `category_id` FKs with `ON DELETE CASCADE`, not RESTRICT — an
 * unguarded delete would silently strip this category off every
 * business/event/product that had it, with no confirmation. This is the
 * actual safety net; the UI's disabled Delete button is just a preview
 * of it. */
export async function deleteCategoryRow(
  supabase: SupabaseClient,
  kind: CategoryKind,
  id: string
): Promise<CategoryActionResult> {
  const [{ count: eventCount }, { count: businessCount }, { count: productCount }] = await Promise.all([
    supabase.from("event_categories").select("category_id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("business_categories").select("category_id", { count: "exact", head: true }).eq("category_id", id),
    supabase.from("product_categories").select("category_id", { count: "exact", head: true }).eq("category_id", id),
  ]);
  const totalUses = (eventCount ?? 0) + (businessCount ?? 0) + (productCount ?? 0);
  if (totalUses > 0) {
    return { error: "This category is currently in use and can't be deleted." };
  }

  const { error } = await supabase.from("categories").delete().eq("id", id).eq("kind", kind);
  if (error) return { error: error.message };
  return {};
}

/** Business Categories only — event/product categories have no ordering
 * column at all (only categories.home_sort_order exists, and it's
 * documented as business-kind-only), so there's nothing to persist a
 * move into for those kinds without a schema change. "Other" is never
 * part of the reorderable sequence — it stays pinned last, mirroring
 * getAllCategories()'s own "Other always sorts last" rule, so a reorder
 * here can never displace it.
 *
 * Renumbers the WHOLE reorderable sequence to sequential integers
 * (0..N-1) around the swap, not just the two moved rows — home_sort_order
 * is nullable and most rows have never had one explicitly set, so a
 * plain two-row swap wouldn't reliably move anything. This also
 * naturally fixes deterministic ordering for any never-ordered category
 * the first time any move happens on that list. */
export async function reorderBusinessCategory(
  supabase: SupabaseClient,
  id: string,
  direction: "up" | "down"
): Promise<CategoryActionResult> {
  const { data, error: fetchError } = await supabase
    .from("categories")
    .select("id, name, home_sort_order")
    .eq("kind", "business")
    .neq("name", "Other")
    .order("home_sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (fetchError) return { error: fetchError.message };

  const rows = data ?? [];
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return { error: "Category not found." };
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return {}; // already at that end — no-op, not an error

  const reordered = [...rows];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].home_sort_order !== i) {
      const { error } = await supabase.from("categories").update({ home_sort_order: i }).eq("id", reordered[i].id);
      if (error) return { error: error.message };
    }
  }
  return {};
}
