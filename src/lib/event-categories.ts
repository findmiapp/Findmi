// Event Taxonomy V1 — one PRIMARY classification per Event:
// Category → optional Subcategory, stored as the most specific selected
// kind='event' category (the child when one is picked, else the parent)
// in the existing event_categories join table. Hierarchy is the existing
// categories.parent_id (one level, same kind — enforced by the
// trg_categories_hierarchy trigger). Pure; safe for client and server.
//
// Legacy Events may still carry more than one event_categories row.
// Nothing here rewrites them merely because a form was opened or saved:
// the picker submits its initial value alongside the selection, and the
// links are replaced ONLY when the selection actually changed.

export interface EventCategoryLike {
  id: string;
  name: string;
  slug?: string;
  parent_id?: string | null;
}

/** Deterministic prefill for an Event's (possibly several) linked
 * categories: the most specific one (a subcategory beats a top-level
 * category), then alphabetical by name, then by id. Null when none of the
 * linked ids is a known category. */
export function primaryEventCategoryId(linkedIds: readonly string[], categories: readonly EventCategoryLike[]): string | null {
  const linked = new Set(linkedIds);
  const candidates = categories.filter((c) => linked.has(c.id));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const depth = (b.parent_id ? 1 : 0) - (a.parent_id ? 1 : 0);
    if (depth !== 0) return depth;
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
  return candidates[0].id;
}

/** The single badge an Event card/page shows: its primary category's own
 * name (a subcategory's name when assigned to one — never "Parent ›
 * Child"). */
export function primaryEventCategory<T extends EventCategoryLike>(linked: readonly T[]): T | null {
  const id = primaryEventCategoryId(
    linked.map((c) => c.id),
    linked
  );
  return id ? (linked.find((c) => c.id === id) ?? null) : null;
}

export type EventCategoryWrite = { kind: "keep" } | { kind: "replace"; ids: string[] };

interface FormLike {
  has(name: string): boolean;
  get(name: string): unknown;
  getAll(name: string): unknown[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanId = (v: unknown): string => (typeof v === "string" && UUID.test(v.trim()) ? v.trim() : "");

/** What a save should do to event_categories, from the submitted form:
 *  - the picker (`category_id` + `category_id_initial`): unchanged → keep
 *    every existing link (a legacy multi-category Event stays as it is);
 *    changed → replace all links with the one selection (or none when
 *    cleared) — the explicit normalization to one primary category;
 *  - the legacy checkbox list (`category_ids`, e.g. a form rendered by the
 *    previous deploy): replace with exactly what it submitted, as before;
 *  - neither field present → keep. */
export function decideEventCategoryWrite(form: FormLike): EventCategoryWrite {
  if (form.has("category_id")) {
    const selected = cleanId(form.get("category_id"));
    const initial = form.has("category_id_initial") ? cleanId(form.get("category_id_initial")) : null;
    if (initial !== null && selected === initial) return { kind: "keep" };
    return { kind: "replace", ids: selected ? [selected] : [] };
  }
  if (form.has("category_ids")) {
    return { kind: "replace", ids: [...new Set(form.getAll("category_ids").map(cleanId).filter(Boolean))] };
  }
  return { kind: "keep" };
}

/** A /events category filter: a top-level category matches itself AND
 * every one of its subcategories; a subcategory matches only itself. */
export function eventCategoryFilterIds(selected: Pick<EventCategoryLike, "id" | "parent_id">, children: readonly Pick<EventCategoryLike, "id">[]): string[] {
  return selected.parent_id ? [selected.id] : [selected.id, ...children.map((c) => c.id)];
}

export interface EventCategoryGroup<T extends EventCategoryLike> {
  category: T;
  children: T[];
}

/** Groups a flat kind='event' list into Category → Subcategories, both
 * levels alphabetical. A subcategory whose parent isn't in the list is
 * shown as its own group so it's never lost. */
export function groupEventCategories<T extends EventCategoryLike>(categories: readonly T[]): EventCategoryGroup<T>[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const groups = new Map<string, EventCategoryGroup<T>>();
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of sorted) if (!c.parent_id || !byId.has(c.parent_id)) groups.set(c.id, { category: c, children: [] });
  for (const c of sorted) if (c.parent_id && byId.has(c.parent_id)) groups.get(c.parent_id)?.children.push(c);
  return [...groups.values()];
}
