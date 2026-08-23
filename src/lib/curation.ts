// Pure, sync grouping helpers shared by the homepage's curated category
// rows, /businesses' curated category rows, and /events' curated category
// rows (Part 9: reuse where it meaningfully prevents duplication, not a
// giant abstraction). Callers fetch items/categories once (they usually
// need both anyway) and pass them in here — no extra DB round-trips per
// row.
import type { Category } from "./types";

export interface CategoryRow<T> {
  category: Category;
  items: T[];
}

/** Groups any already-fetched, category-tagged items (businesses, events —
 * anything carrying its own `categories: Category[]`) by each
 * home-eligible category, dropping any row that doesn't clear minPerRow —
 * the mechanism behind "only render populated rows" everywhere this is
 * used. */
export function groupByCategory<T extends { categories: Category[] }>(
  items: T[],
  categories: Category[],
  { minPerRow = 2, limitPerRow = 10 }: { minPerRow?: number; limitPerRow?: number } = {}
): CategoryRow<T>[] {
  return categories
    .map((category) => ({
      category,
      items: items.filter((item) => item.categories.some((c) => c.id === category.id)).slice(0, limitPerRow),
    }))
    .filter((row) => row.items.length >= minPerRow);
}

/** Same grouping for items that carry a selling business rather than
 * being a business themselves (marketplace products) — a category is
 * looked up via businessCategoryIds (business_id -> that business's
 * category ids), built once from the same category-tagged business list
 * groupByCategory already needs. */
export function groupByBusinessCategory<T extends { business: { id: string } }>(
  items: T[],
  businessCategoryIds: Map<string, Set<string>>,
  categories: Category[],
  { minPerRow = 2, limitPerRow = 10 }: { minPerRow?: number; limitPerRow?: number } = {}
): CategoryRow<T>[] {
  return categories
    .map((category) => ({
      category,
      items: items.filter((item) => businessCategoryIds.get(item.business.id)?.has(category.id)).slice(0, limitPerRow),
    }))
    .filter((row) => row.items.length >= minPerRow);
}
