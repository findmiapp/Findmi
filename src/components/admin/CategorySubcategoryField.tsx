"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/types";

/** Product Taxonomy V1 pass — replaces the old flat multi-select
 * (CheckboxList of category_ids) with a Category → Subcategory cascading
 * select, matching how the task wants sellers to think about it: pick the
 * category, then (if it has any) the specific subcategory, without ever
 * needing to understand parent_id/database hierarchy. Exactly one
 * category is stored — the most specific one picked (the subcategory when
 * one's chosen, otherwise the parent category itself) — via a single
 * hidden `category_id` input the form submits alongside everything else.
 *
 * `categories` is the FULL flat product-kind list (parents + children),
 * not the marketplace's show_on_home-filtered browse tree — a legacy/
 * unmapped top-level category (e.g. the old "Apparel & Accessories") has
 * no children and no show_on_home flag, but must still be selectable here
 * so an admin can keep assigning it even though it's hidden from the
 * public Marketplace browse row. */
export default function CategorySubcategoryField({
  categories,
  defaultCategoryId,
  emptyText = "No product categories yet. Add some in /admin/categories/products.",
  onChange,
}: {
  categories: Category[];
  defaultCategoryId?: string | null;
  emptyText?: string;
  /** For state-driven (non-form) screens such as Event Import Review:
   * called with the most specific selected id ("" for none). */
  onChange?: (categoryId: string) => void;
}) {
  const parents = useMemo(
    () => categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      const list = map.get(c.parent_id) ?? [];
      list.push(c);
      map.set(c.parent_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [categories]);

  const defaultCategory = categories.find((c) => c.id === defaultCategoryId) ?? null;
  const [parentId, setParentId] = useState(defaultCategory ? (defaultCategory.parent_id ?? defaultCategory.id) : "");
  const [childId, setChildId] = useState(defaultCategory?.parent_id ? defaultCategory.id : "");

  const children = parentId ? (childrenByParent.get(parentId) ?? []) : [];
  const parentName = parents.find((p) => p.id === parentId)?.name ?? "";
  const submittedValue = childId || parentId;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-sm font-medium text-ink">Category</span>
      {parents.length === 0 ? (
        <p className="text-sm text-ink/45">{emptyText}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={parentId}
            onChange={(e) => {
              setParentId(e.target.value);
              setChildId("");
              onChange?.(e.target.value);
            }}
            aria-label="Category"
            className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
          >
            <option value="">No category</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {children.length > 0 && (
            <select
              value={childId}
              onChange={(e) => {
                setChildId(e.target.value);
                onChange?.(e.target.value || parentId);
              }}
              aria-label="Subcategory"
              className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink focus:border-ink/30 focus:outline-none"
            >
              <option value="">All {parentName}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <input type="hidden" name="category_id" value={submittedValue} />
      {/* The value this form opened with, so a save can tell an explicit
          category change from an untouched picker (Event Taxonomy V1:
          an Event's legacy extra links are only rewritten on a change). */}
      <input type="hidden" name="category_id_initial" value={defaultCategory?.id ?? ""} />
      <p className="text-xs text-ink/40">
        Pick the most specific subcategory that applies. Choosing just a category is fine if none fit.
      </p>
    </div>
  );
}
