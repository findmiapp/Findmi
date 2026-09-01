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
