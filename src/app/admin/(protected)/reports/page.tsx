import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminReports } from "@/lib/admin/trust-queries";
import { REPORT_REASON_LABELS, REPORT_STATUS_LABELS, REPORT_STATUSES, isReportReason, isReportStatus } from "@/lib/reports-domain";
import { formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  correction: "Correction",
  removal: "Removal Request",
  report: "Report",
  copyright: "Copyright",
  trademark: "Trademark",
};

/** Reports queue — corrections, removal requests, reports and copyright /
 * trademark complaints from public pages, Moments and conversations. */
export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const { status, kind } = await searchParams;
  const activeStatus = isReportStatus(status) ? status : status === "all" ? undefined : "open";
  const admin = getAdminSupabase();
  const reports = admin ? await getAdminReports(admin, { status: activeStatus, kind }) : [];
  const href = (s?: string) => `/admin/reports${s ? `?status=${s}` : "?status=all"}`;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Reports</h1>
      <p className="mt-1 text-sm text-ink/50">
        Corrections, removal requests, reports and copyright or trademark complaints. Nothing is changed or removed automatically: review each one,
        make any change in that content&rsquo;s own editor, then record the outcome here.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[...REPORT_STATUSES, undefined].map((s) => (
          <Link
            key={s ?? "all"}
            href={href(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${activeStatus === s ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"}`}
          >
            {s ? REPORT_STATUS_LABELS[s] : "All"}
          </Link>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        {reports.length === 0 && <p className="text-sm text-ink/50">Nothing here.</p>}
        {reports.map((r) => (
          <Link key={r.id} href={`/admin/reports/${r.id}`} className="rounded-2xl border border-black/5 bg-white p-4 transition hover:border-black/15">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-findmi-50 px-2 py-0.5 font-bold text-findmi-700">{KIND_LABELS[r.report_kind] ?? r.report_kind}</span>
              <span className="font-semibold text-ink/70">{isReportReason(r.reason) ? REPORT_REASON_LABELS[r.reason] : r.reason}</span>
              <span className="text-ink/40">{r.entity_type}</span>
              <span className="ml-auto text-ink/40">{formatDateShort(r.created_at)}</span>
            </div>
            {r.details && <p className="mt-2 line-clamp-2 text-sm text-ink/70">{r.details}</p>}
            <p className="mt-1 text-xs text-ink/45">{isReportStatus(r.status) ? REPORT_STATUS_LABELS[r.status] : r.status}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
