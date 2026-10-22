import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";
import { requireBusinessMember } from "@/lib/permissions";
import { isManagingRole } from "@/lib/business-locations";
import { HISTORY_ROWS_PAGE_SIZE, IMPORT_ROWS_FILTERS, getImportBatchDetail, getMissingFromFile, listImportRows, parseImportRowsFilter } from "@/lib/locator-import/history";
import ChevronIcon from "@/components/ChevronIcon";
import ImportBatchActions from "./ImportBatchActions";
import MissingFromFile from "./MissingFromFile";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { staged: "Not Finished", matched: "Ready To Review", importing: "In Progress", completed: "Completed", failed: "Failed", cancelled: "Discarded" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const OUTCOME_LABEL: Record<string, string> = { linked: "Linked", created: "New Location", updated: "Updated", skipped: "Skipped", failed: "Failed" };

/** One import: its totals, the rows by outcome (attention first), and what an
 * earlier import of the same source had that this file doesn't mention. */
export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; batchId: string }>;
  searchParams: Promise<{ rows?: string; p?: string }>;
}) {
  const { id, batchId } = await params;
  const sp = await searchParams;
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

  const filter = parseImportRowsFilter(sp.rows);
  const page = Math.max(1, Number(sp.p) || 1);
  const [detail, rows, missing] = await Promise.all([
    getImportBatchDetail(admin, id, batchId),
    listImportRows(admin, id, batchId, filter, page),
    getMissingFromFile(admin, id, batchId),
  ]);
  if (!detail || !rows) notFound();
  const base = `/account/business/${id}/import-locations`;
  const o = detail.outcomes;
  const unfinished = detail.status === "staged" || detail.status === "matched" || detail.status === "importing";
  const pages = Math.max(1, Math.ceil(rows.total / HISTORY_ROWS_PAGE_SIZE));
  const stat = (label: string, value: number) => (
    <div className="rounded-xl bg-black/[0.03] px-3 py-2.5">
      <dt className="text-microcopy font-semibold uppercase text-subtle">{label}</dt>
      <dd className="text-card-title font-bold text-primary">{value.toLocaleString()}</dd>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-6">
      <Link href={`${base}/history`} className="flex w-fit items-center gap-1 text-metadata font-semibold text-muted hover:text-secondary">
        <ChevronIcon direction="left" className="h-3 w-3" />
        Import History
      </Link>
      <div>
        <h1 className="font-display text-section-title font-bold text-primary">{detail.sourceLabel || "CSV Import"}</h1>
        <p className="mt-1 text-metadata text-muted">
          {STATUS_LABEL[detail.status] ?? detail.status} · Started {when(detail.createdAt)}
          {detail.completedAt ? ` · Finished ${when(detail.completedAt)}` : ""}
          {detail.initiatedBy ? ` · By ${detail.initiatedBy}` : ""}
        </p>
      </div>

      {unfinished && <ImportBatchActions businessId={id} batchId={batchId} resumeHref={`${base}?batch=${batchId}`} />}

      <section aria-labelledby="ih-summary">
        <h2 id="ih-summary" className="font-display text-card-title-lg font-bold text-primary">Summary</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          {stat("Rows", detail.totalRows)}
          {o ? stat("Matched Existing Locations", o.linked + o.updated) : stat("Matched Existing Locations", detail.matching.existing)}
          {o ? stat("New Locations", o.created) : stat("New Locations (Planned)", detail.matching.new)}
          {o ? stat("Updated Entries", o.updated) : stat("Seen In Earlier Imports", detail.repeat)}
          {o ? stat("Skipped", o.skipped) : stat("Possible Matches", detail.matching.possible)}
          {stat("Needs Attention", o ? detail.attention : detail.matching.invalid + detail.matching.possible)}
        </dl>
      </section>

      <section aria-labelledby="ih-rows">
        <h2 id="ih-rows" className="font-display text-card-title-lg font-bold text-primary">Rows</h2>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter rows">
          {IMPORT_ROWS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`${base}/history/${batchId}?rows=${f.key}`}
              aria-current={filter === f.key ? "true" : undefined}
              className={`flex h-9 items-center rounded-full px-3.5 text-metadata font-semibold transition ${filter === f.key ? "bg-findmi text-white" : "bg-black/[0.04] text-muted hover:text-primary"}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {rows.rows.length === 0 ? (
          <p className="mt-3 text-body text-muted">{filter === "attention" ? "Nothing needs attention." : "No rows here."}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {rows.rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-black/[0.06] bg-white p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold text-primary">{r.data.name ?? "No name"}</p>
                    <p className="truncate text-metadata text-muted">{[r.data.address, r.data.city, r.data.state].filter(Boolean).join(", ") || "No address"}</p>
                  </div>
                  <span className="shrink-0 text-microcopy text-subtle">Row {r.rowNumber}</span>
                </div>
                <p className="mt-1.5 text-metadata text-secondary">
                  {r.outcome ? OUTCOME_LABEL[r.outcome] ?? r.outcome : "Not imported"}
                  {r.location ? <> · <Link href={`/location/${r.location.slug}`} className="text-accent hover:underline">{r.location.name}</Link></> : null}
                </p>
                {(r.outcomeNote || r.problem) && <p className="mt-0.5 text-metadata text-amber-800">{r.outcomeNote ?? r.problem}</p>}
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Row pages" className="mt-3 flex items-center justify-between text-metadata font-semibold">
            {page > 1 ? <Link href={`${base}/history/${batchId}?rows=${filter}&p=${page - 1}`} className="text-accent hover:underline">Previous</Link> : <span />}
            <span className="text-muted">Page {page} of {pages}</span>
            {page < pages ? <Link href={`${base}/history/${batchId}?rows=${filter}&p=${page + 1}`} className="text-accent hover:underline">Next</Link> : <span />}
          </nav>
        )}
      </section>

      {missing.applicable && missing.total > 0 && <MissingFromFile businessId={id} total={missing.total} entries={missing.entries} />}
    </div>
  );
}
