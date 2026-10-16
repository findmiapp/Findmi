/** Shared Admin server-side pagination, URL state and selection rules. The
 * URL is the canonical list state: `q`, filters, view, `sort` and `page`
 * all live in search params. Changing anything except `page` resets to
 * page 1. Pure: no server or client imports. */

export const ADMIN_PAGE_SIZE = 25;

/** `?page=` → a positive integer page; 0, negatives, decimals and garbage
 * resolve to 1. */
export function parseAdminPage(raw: string | string[] | null | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value.trim())) return 1;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/** Inclusive Supabase `.range(from, to)` bounds for a page. */
export function adminPageRange(page: number, pageSize = ADMIN_PAGE_SIZE): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function adminTotalPages(total: number, pageSize = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export interface AdminPage<T> {
  rows: T[];
  /** Size of the FULL filtered result set, not just this page. */
  total: number;
  /** The page actually shown (clamped to the last page when needed). */
  page: number;
  /** The page the URL asked for. Differs from `page` when that page no
   * longer exists (e.g. records were archived since). */
  requestedPage: number;
  pageSize: number;
  totalPages: number;
  /** The query itself failed. Never true just because nothing matched. */
  failed: boolean;
}

export function emptyAdminPage<T>(requestedPage = 1, failed = false): AdminPage<T> {
  return { rows: [], total: 0, page: 1, requestedPage, pageSize: ADMIN_PAGE_SIZE, totalPages: 1, failed };
}

/** "1–25 of 143" (or "0 results"). */
export function adminPageSummary(p: Pick<AdminPage<unknown>, "page" | "pageSize" | "total" | "rows">): string {
  if (p.total === 0) return "0 results";
  const from = (p.page - 1) * p.pageSize + 1;
  return `${from}–${from + p.rows.length - 1} of ${p.total}`;
}

type RangeResult = { data: unknown[] | null; count: number | null; error: { message: string; code?: string } | null };
interface RangeableQuery {
  range: (from: number, to: number) => PromiseLike<RangeResult>;
}

/** Runs ONE filtered + sorted query for one page. `build` must return a
 * fresh query that already has every search/filter/sort applied and was
 * selected with `{ count: "exact" }`, so filtering happens in the database
 * across the whole collection BEFORE the range is taken, and the count is
 * the full filtered total. When the requested page is past the end (records
 * changed since the link was made), it re-reads the last valid page once. */
export async function fetchAdminPage<T>(build: () => RangeableQuery, requestedPage: number, pageSize = ADMIN_PAGE_SIZE): Promise<AdminPage<T>> {
  const page = Math.max(1, requestedPage);
  const { from, to } = adminPageRange(page, pageSize);
  const first = await build().range(from, to);
  // PostgREST answers an offset past the end with PGRST103 (416).
  const pastEnd = page > 1 && (first.error?.code === "PGRST103" || (!first.error && (first.data ?? []).length === 0));
  if (first.error && !pastEnd) return { ...emptyAdminPage<T>(requestedPage, true), pageSize };
  if (!pastEnd) {
    const total = first.count ?? (first.data ?? []).length;
    return { rows: (first.data ?? []) as T[], total, page, requestedPage, pageSize, totalPages: adminTotalPages(total, pageSize), failed: false };
  }
  // Past the end: find the real total (bounded — one row) unless we have it.
  let total = first.count;
  if (total == null) {
    const probe = await build().range(0, 0);
    if (probe.error) return { ...emptyAdminPage<T>(requestedPage, true), pageSize };
    total = probe.count ?? 0;
  }
  const last = adminTotalPages(total, pageSize);
  if (total === 0) return { rows: [], total: 0, page: 1, requestedPage, pageSize, totalPages: 1, failed: false };
  const r = adminPageRange(last, pageSize);
  const again = await build().range(r.from, r.to);
  if (again.error) return { ...emptyAdminPage<T>(requestedPage, true), pageSize };
  const finalTotal = again.count ?? total;
  return { rows: (again.data ?? []) as T[], total: finalTotal, page: last, requestedPage, pageSize, totalPages: adminTotalPages(finalTotal, pageSize), failed: false };
}

// ---------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------

export type AdminListParams = Record<string, string | string[] | undefined>;

/** One-shot flash params (a bulk result, a decision notice, an error) that
 * must not follow the operator to another page, sort or view. */
export const ADMIN_TRANSIENT_PARAMS = ["result", "decided", "error"] as const;

/** Builds a list href from the current params plus changes (`null` or ""
 * removes a key). Any change other than `page` resets to page 1; page 1
 * itself is left out of the URL. Flash params are always dropped. */
export function adminListHref(pathname: string, current: AdminListParams, changes: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if ((ADMIN_TRANSIENT_PARAMS as readonly string[]).includes(k)) continue;
    const value = Array.isArray(v) ? v[0] : v;
    if (value != null && value !== "") params.set(k, value);
  }
  const changesPage = Object.keys(changes).length > 0 && Object.keys(changes).every((k) => k === "page");
  if (!changesPage) params.delete("page");
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === "") params.delete(k);
    else params.set(k, v);
  }
  if (params.get("page") === "1") params.delete("page");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Identifies the list's current scope (search, filters, view, sort AND
 * page). When it changes, the selection is cleared so rows that are no
 * longer visible can never be acted on. Flash params don't count. */
export function adminListScopeKey(current: AdminListParams): string {
  return Object.entries(current)
    .filter(([k, v]) => !(ADMIN_TRANSIENT_PARAMS as readonly string[]).includes(k) && v != null && v !== "")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v[0] : v}`)
    .sort()
    .join("&");
}

// ---------------------------------------------------------------------
// Selection (page-local)
// ---------------------------------------------------------------------

/** "Select All Visible" — exactly the rows rendered on this page, never
 * other pages or every matching record. */
export function selectAllVisible(items: readonly { id: string }[]): Set<string> {
  return new Set(items.map((i) => i.id));
}

/** Drops any selected id that isn't currently visible. Returns `prev`
 * itself when nothing changed. */
export function pruneSelection(prev: Set<string>, items: readonly { id: string }[]): Set<string> {
  const visible = new Set(items.map((i) => i.id));
  const next = new Set([...prev].filter((id) => visible.has(id)));
  return next.size === prev.size ? prev : next;
}
