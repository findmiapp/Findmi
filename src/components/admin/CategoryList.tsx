"use client";

import { useMemo, useState } from "react";
import SubmitBar from "./SubmitBar";
import type { Category, CategoryKind } from "@/lib/types";

type UsageCounts = { events: number; businesses: number; products: number };

const KIND_LABEL: Record<CategoryKind, string> = {
  business: "business",
  event: "event",
  product: "product",
};

const inputClass =
  "rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-ink/30 focus:outline-none";

/** Category Admin Usability pass — one shared, compact list UI for all
 * three category-kind screens (Business/Event/Product Categories).
 * Deliberately a single component rather than three near-copies: the
 * kind-specific differences (homepage visibility + Order/move controls,
 * business-only; legacy labeling, business-only) are just conditionally
 * rendered based on `kind`/props, same shape lib/admin/categoryForm.ts
 * already uses for shared create/save logic.
 *
 * Still ONE <form> around the whole list, matching the existing bulk-save
 * behavior exactly (name/slug/show-on-home/order all post together) —
 * Move Up/Down and Delete use each button's own `formAction` to submit a
 * DIFFERENT server action than the form's own `action`, instead of a
 * nested <form> (invalid HTML) per row. Neither of those two actions
 * reads the rest of the form's fields — they act only on the row's real
 * id, straight from the database — so clicking one never silently saves
 * unrelated pending edits in other rows.
 *
 * Search filters client-side over the categories already loaded (no new
 * API): non-matching rows stay mounted with `hidden` rather than being
 * removed from the DOM, so their name/slug/order inputs still post with
 * the bulk save even while filtered out of view. */
export default function CategoryList({
  kind,
  categories,
  usage,
  saveAction,
  deleteAction,
  moveAction,
  legacySlugs,
  cancelHref,
}: {
  kind: CategoryKind;
  categories: Category[];
  usage: Map<string, UsageCounts>;
  saveAction: (formData: FormData) => void;
  deleteAction: (id: string) => void;
  moveAction?: (id: string, direction: "up" | "down") => void;
  legacySlugs?: Set<string>;
  cancelHref: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Product Taxonomy V1 — Parent Category / ↳ Subcategory display, kind
  // "product" only (the only kind with any live hierarchy so far; event/
  // business rows render exactly as before). Top-level rows (parent_id
  // null) are followed immediately by their own children, alphabetical
  // within each group — same shape lib/data.ts's getProductCategoryTree
  // uses for the public Marketplace browse rows, just without the
  // show_on_home filter (a legacy/unmapped top-level row with no children
  // and show_on_home unset must still show up here so it stays
  // manageable).
  const displayList = useMemo(() => {
    if (kind !== "product") return categories.map((c) => ({ ...c, depth: 0 as const, childCount: 0, parentName: "" }));
    const byParent = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      const list = byParent.get(c.parent_id) ?? [];
      list.push(c);
      byParent.set(c.parent_id, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const topLevel = categories.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
    const out: (Category & { depth: 0 | 1; childCount: number; parentName: string })[] = [];
    for (const p of topLevel) {
      const children = byParent.get(p.id) ?? [];
      out.push({ ...p, depth: 0, childCount: children.length, parentName: "" });
      for (const c of children) out.push({ ...c, depth: 1, childCount: 0, parentName: p.name });
    }
    return out;
  }, [kind, categories]);

  // Business only, and only for the ordering UI: "Other" is never part of
  // the reorderable sequence — see reorderBusinessCategory's own comment.
  // Its move buttons are simply never rendered for that row.
  const reorderable = useMemo(
    () => (kind === "business" ? categories.filter((c) => c.name !== "Other") : []),
    [kind, categories]
  );
  const positionById = useMemo(() => {
    const map = new Map<string, number>();
    reorderable.forEach((c, i) => map.set(c.id, i + 1));
    return map;
  }, [reorderable]);

  const usageFor = (id: string): number => {
    const c = usage.get(id) ?? { events: 0, businesses: 0, products: 0 };
    return kind === "business" ? c.businesses : kind === "event" ? c.events : c.products;
  };

  const matchCount = q ? categories.filter((c) => c.name.toLowerCase().includes(q)).length : categories.length;

  return (
    <form action={saveAction} className="mt-5 flex flex-col gap-4">
      {categories.length > 0 && (
        <div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${KIND_LABEL[kind]} categories…`}
            aria-label={`Search ${KIND_LABEL[kind]} categories`}
            className="w-full max-w-xs rounded-xl border border-black/10 bg-white px-3.5 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
          {q && (
            <p className="mt-1.5 text-xs text-ink/40">
              {matchCount} of {categories.length} match{matchCount === 1 ? "" : "es"} &ldquo;{query.trim()}&rdquo;
            </p>
          )}
        </div>
      )}

      {categories.length === 0 ? (
        <p className="text-sm text-ink/50">No categories yet — add one above.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {displayList.map((c, i) => {
            const ownMatch = !q || c.name.toLowerCase().includes(q);
            // A parent stays visible if any of its own children match, so
            // a subcategory search still reads in context; a child stays
            // visible if its parent (the row right above its group) does.
            const groupMatch =
              c.depth === 0
                ? ownMatch || displayList.slice(i + 1, i + 1 + c.childCount).some((child) => child.name.toLowerCase().includes(q))
                : ownMatch || c.parentName.toLowerCase().includes(q);
            const hidden = q.length > 0 && !groupMatch;
            const uses = usageFor(c.id);
            const isLegacy = legacySlugs?.has(c.slug) ?? false;
            const isOther = c.name === "Other";
            const position = positionById.get(c.id);

            return (
              <div
                key={c.id}
                hidden={hidden}
                className={`flex flex-col gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 ${c.depth === 1 ? "ml-4 sm:ml-7" : ""}`}
              >
                <input type="hidden" name="all_category_ids" value={c.id} />

                {c.depth === 1 && <span className="shrink-0 text-ink/30" aria-hidden>↳</span>}

                {kind === "business" && (
                  <div className="flex shrink-0 items-center gap-1 sm:flex-col sm:gap-0.5">
                    <button
                      type="submit"
                      formAction={moveAction?.bind(null, c.id, "up")}
                      disabled={isOther || position === 1}
                      aria-label={`Move ${c.name} up`}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-xs text-ink/60 transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="submit"
                      formAction={moveAction?.bind(null, c.id, "down")}
                      disabled={isOther || position === reorderable.length}
                      aria-label={`Move ${c.name} down`}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-xs text-ink/60 transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                )}

                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    name={`name_${c.id}`}
                    defaultValue={c.name}
                    aria-label={`Name for ${c.name}`}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    name={`slug_${c.id}`}
                    defaultValue={c.slug}
                    aria-label={`Slug for ${c.name}`}
                    className={`${inputClass} text-ink/70`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  {isOther && (
                    <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/50">
                      Always last
                    </span>
                  )}
                  {isLegacy && (
                    <span
                      title="Kept for existing assignments — not part of the current taxonomy."
                      className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700"
                    >
                      Legacy
                    </span>
                  )}
                  {kind === "product" && c.depth === 0 && c.childCount > 0 && (
                    <span className="rounded-full bg-findmi-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-findmi-700">
                      {c.childCount} subcategor{c.childCount === 1 ? "y" : "ies"}
                    </span>
                  )}
                  {kind === "business" && position && (
                    <span className="text-[11px] text-ink/40">#{position}</span>
                  )}

                  {kind === "business" && (
                    <>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          name={`show_${c.id}`}
                          defaultChecked={c.show_on_home}
                          className="h-4 w-4 shrink-0 accent-findmi"
                        />
                        <span className="text-[11px] text-ink/60">Home</span>
                      </label>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[11px] text-ink/45">Order</span>
                        <input
                          type="number"
                          name={`order_${c.id}`}
                          defaultValue={c.home_sort_order ?? ""}
                          className={`${inputClass} w-14 px-1.5 py-1`}
                        />
                      </div>
                    </>
                  )}

                  <span className="text-[11px] text-ink/45">
                    {uses} use{uses === 1 ? "" : "s"}
                  </span>

                  {uses > 0 ? (
                    <button
                      type="button"
                      disabled
                      title="In use — remove this category from every business/event/product first, or leave it in place."
                      className="cursor-not-allowed rounded-lg border border-black/10 px-2 py-1 text-[11px] font-semibold text-ink/30"
                    >
                      In use
                    </button>
                  ) : c.childCount > 0 ? (
                    <button
                      type="button"
                      disabled
                      title="Has subcategories — delete or reassign them first so nothing gets orphaned."
                      className="cursor-not-allowed rounded-lg border border-black/10 px-2 py-1 text-[11px] font-semibold text-ink/30"
                    >
                      Has subcategories
                    </button>
                  ) : (
                    <button
                      type="submit"
                      formAction={deleteAction.bind(null, c.id)}
                      onClick={(e) => {
                        if (!window.confirm(`Delete "${c.name}"? This can't be undone.`)) e.preventDefault();
                      }}
                      className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SubmitBar cancelHref={cancelHref} />
    </form>
  );
}
