import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { HISTORY_PAGE_SIZE, listImportHistory } from "@/lib/locator-import/history";
import ChevronIcon from "@/components/ChevronIcon";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { staged: "Not Finished", matched: "Ready To Review", importing: "In Progress", completed: "Completed", failed: "Failed", cancelled: "Discarded" };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Import History — every locator import this Business has started, newest first. */
export default async function ImportHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  let allowed = false;
  try {
    const membership = await requireBusinessMember(id);
    allowed = Boolean(membership.viaAdmin) || isManagingRole(membership.role);
  } catch (err) {
    redirect(errorRedirectUrl("/account", err instanceof Error ? err.message : "You don't have access to this business."));
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(`/account/business/${id}`, "Server isn't configured."));
  if (!allowed) redirect(errorRedirectUrl(`/account/business/${id}`, "Only a Business owner or manager can see import history."));

  const page = Math.max(1, Number(pageParam) || 1);
  const [{ data: business }, history] = await Promise.all([admin.from("businesses").select("name").eq("id", id).maybeSingle(), listImportHistory(admin, id, page)]);
  if (!business) redirect(errorRedirectUrl("/account", "Business not found."));
  const base = `/account/business/${id}/import-locations`;
  const pages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <Link href={base} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        Import Locations
      </Link>
      <div>
        <h1 className="font-display text-section-title font-bold text-primary">Import History</h1>
        <p className="mt-1 text-body text-muted">Every import for {business.name}, newest first.</p>
      </div>
      {!history.available ? (
        <p role="status" className="rounded-xl bg-black/[0.03] p-4 text-body text-muted">Import history isn’t available yet. Please check back soon.</p>
      ) : history.items.length === 0 ? (
        <p className="text-body text-muted">No imports yet. <Link href={base} className="font-semibold text-accent hover:underline">Import Locations</Link></p>
      ) : (
        <ul className="flex flex-col gap-2">
          {history.items.map((i) => {
            const o = i.outcomes;
            return (
              <li key={i.id}>
                <Link href={`${base}/history/${i.id}`} className="block rounded-2xl border border-black/[0.06] bg-white p-4 transition hover:border-findmi/40">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-card-title font-semibold text-primary">{i.sourceLabel || "CSV Import"}</span>
                      <span className="block text-metadata text-muted">
                        {when(i.createdAt)}
                        {i.initiatedBy ? ` · ${i.initiatedBy}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${i.status === "completed" ? "bg-findmi-50 text-findmi-700" : i.status === "failed" ? "bg-red-50 text-red-700" : "bg-black/[0.05] text-muted"}`}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </span>
                  </span>
                  <span className="mt-2 block text-metadata text-secondary">
                    {i.totalRows.toLocaleString()} {i.totalRows === 1 ? "row" : "rows"}
                    {o ? ` · ${(o.linked + o.updated).toLocaleString()} matched · ${o.created.toLocaleString()} new · ${o.updated.toLocaleString()} updated · ${o.skipped.toLocaleString()} skipped` : ""}
                    {o && o.failed > 0 ? ` · ${o.failed.toLocaleString()} failed` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Import history pages" className="flex items-center justify-between text-metadata font-semibold">
          {page > 1 ? <Link href={`${base}/history?page=${page - 1}`} className="text-accent hover:underline">Newer</Link> : <span />}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages ? <Link href={`${base}/history?page=${page + 1}`} className="text-accent hover:underline">Older</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
