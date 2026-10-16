/** Shared Admin list sorting. One vocabulary of sort keys, one URL parser and
 * one query applier for every Admin directory (Businesses, Locations,
 * Events, People). Each collection declares which keys it offers and what
 * column each key means for it. "Newest" is never assumed to be the same
 * column everywhere, and an Event-date sort is never labelled "Newest".
 *
 * Every applied sort ends with `id` ascending as a deterministic tie-break,
 * so equal primary values can't reshuffle between paginated requests.
 * Pure: no server or client imports. */

export type AdminSortKey = "newest" | "oldest" | "az" | "za" | "updated" | "date_desc" | "date_asc";

export const ADMIN_SORT_LABEL: Record<AdminSortKey, string> = {
  newest: "Newest",
  oldest: "Oldest",
  az: "A–Z",
  za: "Z–A",
  updated: "Recently Updated",
  date_desc: "Event Date: Latest First",
  date_asc: "Event Date: Earliest First",
};

export interface AdminSortColumn {
  column: string;
  ascending: boolean;
}

export interface AdminSortConfig {
  /** Display order of the options this collection offers. */
  options: readonly AdminSortKey[];
  /** The collection's existing default order. */
  defaultKey: AdminSortKey;
  columns: Partial<Record<AdminSortKey, AdminSortColumn>>;
}

const created = (ascending: boolean): AdminSortColumn => ({ column: "created_at", ascending });
const byName = (ascending: boolean): AdminSortColumn => ({ column: "name", ascending });

/** Businesses: Newest stays the default, and Recently Updated is kept. */
export const BUSINESS_SORT: AdminSortConfig = {
  options: ["newest", "updated", "oldest", "az", "za"],
  defaultKey: "newest",
  columns: {
    newest: created(false),
    oldest: created(true),
    updated: { column: "updated_at", ascending: false },
    az: byName(true),
    za: byName(false),
  },
};

/** Locations: A–Z stays the default. `locations` has no created_at column
 * (and its ids are random UUIDs), so Newest / Oldest can't be offered
 * truthfully without a schema change. */
export const LOCATION_SORT: AdminSortConfig = {
  options: ["az", "za"],
  defaultKey: "az",
  columns: { az: byName(true), za: byName(false) },
};

/** Events: the existing chronological order (start_at, latest first) stays
 * the default. Newest / Oldest mean when the Event was ADDED (created_at),
 * and the Event-date options say so in their labels. */
export const EVENT_SORT: AdminSortConfig = {
  options: ["date_desc", "date_asc", "newest", "oldest", "az", "za"],
  defaultKey: "date_desc",
  columns: {
    date_desc: { column: "start_at", ascending: false },
    date_asc: { column: "start_at", ascending: true },
    newest: created(false),
    oldest: created(true),
    az: byName(true),
    za: byName(false),
  },
};

/** The New Events view keeps its existing newest-ADDED-first order. */
export const NEW_EVENTS_DEFAULT_SORT: AdminSortKey = "newest";

/** People: A–Z stays the default. */
export const PEOPLE_SORT: AdminSortConfig = {
  options: ["az", "za", "newest", "oldest"],
  defaultKey: "az",
  columns: { az: byName(true), za: byName(false), newest: created(false), oldest: created(true) },
};

/** A URL `?sort=` value → a key this collection offers. Anything unknown or
 * unsupported falls back to the default (or a view-specific override). */
export function parseAdminSort(raw: string | string[] | null | undefined, config: AdminSortConfig, defaultKey: AdminSortKey = config.defaultKey): AdminSortKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return config.options.find((k) => k === value) ?? defaultKey;
}

export function adminSortOptions(config: AdminSortConfig): { value: AdminSortKey; label: string }[] {
  return config.options.map((value) => ({ value, label: ADMIN_SORT_LABEL[value] }));
}

/** The ordered columns a sort applies, always ending with the `id` tie-break. */
export function adminSortColumns(config: AdminSortConfig, key: AdminSortKey): AdminSortColumn[] {
  const primary = config.columns[key] ?? config.columns[config.defaultKey];
  return [...(primary ? [primary] : []), { column: "id", ascending: true }];
}

export function applyAdminSort<Q extends { order: (column: string, options: { ascending: boolean }) => Q }>(query: Q, config: AdminSortConfig, key: AdminSortKey): Q {
  let q = query;
  for (const c of adminSortColumns(config, key)) q = q.order(c.column, { ascending: c.ascending });
  return q;
}
