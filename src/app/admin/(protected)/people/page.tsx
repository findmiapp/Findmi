import Link from "next/link";
import Form from "next/form";
import { getAdminPeople } from "@/lib/admin/people-queries";
import { adminSortOptions, parseAdminSort, PEOPLE_SORT } from "@/lib/admin/list-sort";
import { parseAdminPage } from "@/lib/admin/list-page";
import AdminSortSelect from "@/components/admin/AdminSortSelect";
import AdminPagination from "@/components/admin/AdminPagination";

export const dynamic = "force-dynamic";

const PATH = "/admin/people";

export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { q, error } = params;
  // A–Z stays the default; Newest / Oldest read people.created_at.
  const sort = parseAdminSort(params.sort, PEOPLE_SORT);
  const list = await getAdminPeople({ q, sort, page: parseAdminPage(params.page) });
  const people = list.rows;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">People</h1>
        <Link
          href="/admin/people/new"
          className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink hover:bg-findmi-600"
        >
          New Person
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink/50">
        Founders, owners, makers, chefs, creators, operators — the people behind Findmi brands.
      </p>
      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* Search runs in the database before the page range; submitting
          keeps the sort and resets to page 1. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Form action={PATH} className="flex min-w-0 gap-2">
        {sort !== PEOPLE_SORT.defaultKey && <input type="hidden" name="sort" value={sort} />}
        <input autoCapitalize="none"
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name or bio…"
          className="w-full min-w-0 max-w-xs rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <button type="submit" className="shrink-0 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-black/[0.03]">
          Search
        </button>
      </Form>
      <AdminSortSelect pathname={PATH} params={params} value={sort} defaultValue={PEOPLE_SORT.defaultKey} options={adminSortOptions(PEOPLE_SORT)} />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {people.length === 0 ? (
          <p className="text-sm text-ink/50">{list.failed ? "Couldn't load People — try again." : q ? "No People match this search." : "No People yet."}</p>
        ) : (
          people.map((p) => (
            <Link
              key={p.id}
              href={`/admin/people/${p.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-4 py-3 transition hover:border-black/10"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                {p.location && <p className="truncate text-xs text-ink/50">{p.location}</p>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {p.is_featured && (
                  <span className="rounded-full bg-findmi-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-findmi-700">
                    Featured
                  </span>
                )}
                {!p.is_public && (
                  <span className="rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink/60">
                    Hidden
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>
      <AdminPagination pathname={PATH} params={params} result={list} noun="People" />
    </div>
  );
}
