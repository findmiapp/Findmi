import Link from "next/link";
import { adminListHref, adminPageSummary, type AdminListParams, type AdminPage } from "@/lib/admin/list-page";

const button = "flex min-h-10 min-w-[6.5rem] items-center justify-center rounded-full border px-4 text-xs font-bold uppercase tracking-wide";

/** Shared Admin pagination: Previous · Page X of Y · Next, plus "1–25 of
 * 143". Links change only `page` (search, filters, sort and view are
 * kept) and use client-side Next navigation, so Back/Forward work. */
export default function AdminPagination({
  pathname,
  params,
  result,
  noun,
}: {
  pathname: string;
  params: AdminListParams;
  result: Pick<AdminPage<unknown>, "page" | "pageSize" | "total" | "totalPages" | "rows" | "requestedPage">;
  /** Plural noun for the count, e.g. "Locations". */
  noun: string;
}) {
  const { page, totalPages } = result;
  const prev = page > 1 ? adminListHref(pathname, params, { page: String(page - 1) }) : null;
  const next = page < totalPages ? adminListHref(pathname, params, { page: String(page + 1) }) : null;
  return (
    <nav aria-label={`${noun} pages`} className="mt-4 flex flex-col gap-2" data-admin-pagination="">
      {result.requestedPage > page && result.total > 0 && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          Page {result.requestedPage} no longer exists — showing page {page}.
        </p>
      )}
      <p className="text-xs font-semibold text-ink/50">
        {adminPageSummary(result)} {noun}
      </p>
      {totalPages > 1 && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:justify-start">
          {prev ? (
            <Link href={prev} className={`${button} border-black/15 text-ink/70 hover:border-black/30`}>
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={`${button} cursor-not-allowed border-black/10 text-ink/25`}>
              Previous
            </span>
          )}
          <span className="whitespace-nowrap px-1 text-center text-xs font-semibold text-ink/60">
            Page {page} of {totalPages}
          </span>
          {next ? (
            <Link href={next} className={`${button} justify-self-end border-black/15 text-ink/70 hover:border-black/30`}>
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className={`${button} cursor-not-allowed justify-self-end border-black/10 text-ink/25`}>
              Next
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
