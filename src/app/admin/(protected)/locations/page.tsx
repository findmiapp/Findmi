import Link from "next/link";
import Form from "next/form";
import { getAdminLocationList, getAllCategories } from "@/lib/admin/queries";
import { adminSortOptions, LOCATION_SORT, parseAdminSort } from "@/lib/admin/list-sort";
import { adminListHref, adminListScopeKey, parseAdminPage } from "@/lib/admin/list-page";
import AdminSortSelect from "@/components/admin/AdminSortSelect";
import AdminPagination from "@/components/admin/AdminPagination";
import LocationBulkListClient from "./LocationBulkListClient";

const PATH = "/admin/locations";

export const dynamic = "force-dynamic";

// No "Paused" tab — Locations have no Pause concept at all (V1's audit
// finding, reconfirmed in V2 — no column exists to pause one).
const LIFECYCLE_TABS = [
  { value: "active", label: "All Active" },
  { value: "archived", label: "Archived" },
  { value: "trashed", label: "Trash" },
] as const;

export default async function AdminLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lifecycle?: string; result?: string; review?: string; published?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { q, lifecycle, result, review, published } = params;
  // A–Z / Z–A only: locations has no created_at, so Newest / Oldest
  // aren't offered (see LOCATION_SORT).
  const sort = parseAdminSort(params.sort, LOCATION_SORT);
  const page = parseAdminPage(params.page);
  const lifecycleTab = LIFECYCLE_TABS.find((t) => t.value === lifecycle)?.value ?? "active";
  // "Needs Review": active Locations not publicly listed yet (Admin Home's
  // queue) — their rows read DRAFT. "Published": active and publicly listed.
  const needsReview = review === "1" && lifecycleTab === "active";
  const publishedOnly = !needsReview && published === "1" && lifecycleTab === "active";

  const [list, categories] = await Promise.all([
    getAdminLocationList({ q, lifecycle: lifecycleTab, needsReview, publishedOnly, sort, page }),
    getAllCategories("location"),
  ]);
  // Every view link / search keeps the chosen sort and resets to page 1.
  const keep = sort !== LOCATION_SORT.defaultKey ? sort : null;
  const viewHref = (changes: Record<string, string | null>) => adminListHref(PATH, { q, sort: keep ?? undefined }, changes);
  const filtered = Boolean(q);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Locations</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/admin/locations/import"
          className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink/70 hover:border-black/20"
        >
          Import Locations
        </Link>
        <Link
          href="/admin/locations/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          Add Location
        </Link>
        </div>
      </div>

      {result && (
        <p className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-3.5 py-2.5 text-sm text-ink/80">{result}</p>
      )}

      {/* Admin Content Lifecycle V2 — the three lifecycle views, reachable
          as plain, visible pill links (never an obscure query param a
          visitor has to guess) — same pattern as Products/Businesses/
          Events, minus the Paused tab which doesn't apply here. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {LIFECYCLE_TABS.map((tab) => {
          const active = lifecycleTab === tab.value && !needsReview && !publishedOnly;
          const href = viewHref({ lifecycle: tab.value !== "active" ? tab.value : null });
          return (
            <Link
              key={tab.value}
              href={href}
              className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
                active ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
        <Link
          href={viewHref({ review: "1" })}
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            needsReview ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
          }`}
        >
          Needs Review
        </Link>
        <Link
          href={viewHref({ published: "1" })}
          className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
            publishedOnly ? "bg-ink text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
          }`}
        >
          Published
        </Link>
      </div>
      {needsReview && (
        <p className="mt-3 text-sm text-ink/60">
          Draft — not publicly listed yet, so Events show these by name and address only. Select the ones that are ready and Publish them
          together (or open one to check it first).
        </p>
      )}

      {/* Search runs in the database across the whole view before the page
          range; submitting keeps the view and sort and resets to page 1
          (no `page` field). next/form navigates client-side. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Form action={PATH} className="w-full sm:max-w-sm">
          {lifecycleTab !== "active" && <input type="hidden" name="lifecycle" value={lifecycleTab} />}
          {needsReview && <input type="hidden" name="review" value="1" />}
          {publishedOnly && <input type="hidden" name="published" value="1" />}
          {keep && <input type="hidden" name="sort" value={keep} />}
          <input autoCapitalize="none"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name, city, or address…"
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
        </Form>
        <AdminSortSelect pathname={PATH} params={params} value={sort} defaultValue={LOCATION_SORT.defaultKey} options={adminSortOptions(LOCATION_SORT)} />
      </div>

      <div className="mt-4">
        <LocationBulkListClient
          locations={list.rows}
          view={lifecycleTab}
          categories={categories}
          scopeKey={adminListScopeKey(params)}
          emptyMessage={
            list.failed
              ? "Couldn't load Locations — try again."
              : filtered
              ? "No Locations match this search."
              : needsReview
              ? "No Locations need review."
              : publishedOnly
              ? "No Published Locations yet."
              : "No Locations in this view."
          }
        />
        <AdminPagination pathname={PATH} params={params} result={list} noun="Locations" />
      </div>
    </div>
  );
}
