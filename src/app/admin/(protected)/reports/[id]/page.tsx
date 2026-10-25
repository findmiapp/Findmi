import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { describeReportedEntity, getAdminReport } from "@/lib/admin/trust-queries";
import {
  REPORTER_RELATIONSHIP_LABELS,
  REPORT_REASON_LABELS,
  REPORT_RESOLUTIONS,
  REPORT_RESOLUTION_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  isReportReason,
  isReporterRelationship,
} from "@/lib/reports-domain";
import { formatDateShort, formatTime } from "@/lib/format";
import { updateReport } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminReportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const admin = getAdminSupabase();
  if (!admin) notFound();
  const report = await getAdminReport(admin, id);
  if (!report) notFound();
  const about = await describeReportedEntity(admin, report.entity_type, report.entity_id);
  const field = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink";

  return (
    <div className="max-w-2xl">
      <Link href="/admin/reports" className="text-sm text-ink/50 hover:text-ink">
        Reports
      </Link>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink">{about.name}</h1>
      <p className="mt-1 text-sm text-ink/50">
        {report.report_kind} · {isReportReason(report.reason) ? REPORT_REASON_LABELS[report.reason] : report.reason} · {formatDateShort(report.created_at)}{" "}
        {formatTime(report.created_at)}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {about.adminHref && (
          <Link href={about.adminHref} className="font-semibold text-findmi-700 hover:underline">
            Open In Admin
          </Link>
        )}
        {about.publicHref && (
          <Link href={about.publicHref} className="font-semibold text-findmi-700 hover:underline">
            View Public Page
          </Link>
        )}
      </div>
      {error && <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}
      {saved && !error && <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Saved.</p>}

      <dl className="mt-5 grid gap-3 rounded-2xl border border-black/5 bg-white p-4 text-sm">
        <div>
          <dt className="text-xs font-semibold text-ink/45">Details</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-ink">{report.details ?? "None given."}</dd>
        </div>
        {report.evidence_url && (
          <div>
            <dt className="text-xs font-semibold text-ink/45">Link</dt>
            <dd className="mt-0.5 break-all text-ink">{report.evidence_url}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-semibold text-ink/45">Reporter</dt>
          <dd className="mt-0.5 text-ink">
            {report.reporter_relationship && isReporterRelationship(report.reporter_relationship) ? REPORTER_RELATIONSHIP_LABELS[report.reporter_relationship] : "Relationship not given"}
            {" · "}
            {report.reporter_user_id ? "Signed-in account" : report.reporter_email ? `Guest, reply to ${report.reporter_email}` : "Guest, no reply requested"}
          </dd>
        </div>
      </dl>

      <form action={updateReport.bind(null, report.id)} className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold text-ink/60">Status</span>
          <select name="status" defaultValue={report.status} className={field}>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REPORT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold text-ink/60">Outcome (when resolved or dismissed)</span>
          <select name="resolution" defaultValue={report.resolution ?? ""} className={field}>
            <option value="">None</option>
            {REPORT_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_RESOLUTION_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold text-ink/60">Internal note (never shown to the reporter)</span>
          <textarea autoCapitalize="sentences" name="admin_note" rows={3} defaultValue={report.admin_note ?? ""} className={field} />
        </label>
        <button type="submit" className="self-start rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
          Save
        </button>
      </form>
    </div>
  );
}
