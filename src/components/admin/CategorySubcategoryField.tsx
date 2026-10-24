"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/types";
import PickerSheet, { matchesQuery } from "./PickerSheet";

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
  variant = "selects",
}: {
  categories: Category[];
  defaultCategoryId?: string | null;
  emptyText?: string;
  /** "compact" (Business-facing Event screens): a one-line summary that
   * opens a searchable sheet of the same Category → Subcategory tree. Same
   * single stored value and hidden inputs either way. */
  variant?: "selects" | "compact";
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

  if (variant === "compact") {
    return (
      <CompactCategory
        parents={parents}
        childrenByParent={childrenByParent}
        parentId={parentId}
        childId={childId}
        defaultCategoryId={defaultCategory?.id ?? ""}
        emptyText={emptyText}
        onPick={(nextParent, nextChild) => {
          setParentId(nextParent);
          setChildId(nextChild);
          onChange?.(nextChild || nextParent);
        }}
      />
    );
  }

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

function CompactCategory({
  parents,
  childrenByParent,
  parentId,
  childId,
  defaultCategoryId,
  emptyText,
  onPick,
}: {
  parents: Category[];
  childrenByParent: Map<string, Category[]>;
  parentId: string;
  childId: string;
  defaultCategoryId: string;
  emptyText: string;
  onPick: (parentId: string, childId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const parent = parents.find((p) => p.id === parentId) ?? null;
  const child = childId ? (childrenByParent.get(parentId) ?? []).find((c) => c.id === childId) ?? null : null;
  const summary = parent ? (child ? `${parent.name} › ${child.name}` : parent.name) : null;
  const pick = (p: string, c: string) => {
    onPick(p, c);
    setOpen(false);
    setQuery("");
  };
  const row = (on: boolean, indent: boolean) =>
    `flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition ${indent ? "pl-7" : "font-semibold"} ${
      on ? "bg-findmi-50 text-findmi-700" : "text-ink hover:bg-black/[0.03]"
    }`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-sm font-medium text-ink">Category</span>
      {parents.length === 0 ? (
        <p className="text-sm text-ink/45">{emptyText}</p>
      ) : (
        <PickerSheet
          label="Category"
          summary={summary}
          placeholder="Choose a category"
          title="Category"
          searchPlaceholder="Search categories"
          query={query}
          onQuery={setQuery}
          open={open}
          onOpenChange={setOpen}
        >
          <ul className="flex flex-col gap-0.5 py-1">
            <li>
              <button type="button" onClick={() => pick("", "")} className={row(!parentId, false)}>
                No category
              </button>
            </li>
            {parents.map((p) => {
              const kids = childrenByParent.get(p.id) ?? [];
              const shownKids = kids.filter((c) => matchesQuery(c.name, query) || matchesQuery(p.name, query));
              if (!matchesQuery(p.name, query) && shownKids.length === 0) return null;
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={parentId === p.id && !childId} onClick={() => pick(p.id, "")} className={row(parentId === p.id && !childId, false)}>
                    <span className="min-w-0 truncate">{p.name}</span>
                    {kids.length > 0 && <span className="shrink-0 text-xs font-normal text-ink/40">All</span>}
                  </button>
                  {shownKids.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {shownKids.map((c) => (
                        <li key={c.id}>
                          <button type="button" aria-pressed={childId === c.id} onClick={() => pick(p.id, c.id)} className={row(childId === c.id, true)}>
                            <span className="min-w-0 truncate">{c.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </PickerSheet>
      )}
      <input type="hidden" name="category_id" value={childId || parentId} />
      <input type="hidden" name="category_id_initial" value={defaultCategoryId} />
    </div>
  );
}
