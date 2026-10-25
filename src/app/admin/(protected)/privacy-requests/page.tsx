import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminPrivacyRequests } from "@/lib/admin/trust-queries";
import { formatDateShort } from "@/lib/format";
import { applyAnalyticsRetention, updatePrivacyRequest } from "./actions";
import { parseAnalyticsRetentionDays } from "@/lib/analytics/retention";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = { export: "Data Export", delete: "Account Deletion", access: "Access", correct: "Correction", other: "Other" };
const STATUSES = [
  ["received", "Received"],
  ["in_review", "In Review"],
  ["completed", "Completed"],
  ["declined", "Declined"],
  ["cancelled", "Cancelled"],
] as const;

/** Privacy Requests — account deletion, access, correction and other
 * requests from Account, Privacy & Data. Self-service downloads appear as
 * completed exports. Deletion is completed from the account's own Admin,
 * Users page, after checking what must be kept. */
export default async function AdminPrivacyRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; error?: string; saved?: string; retained?: string }> }) {
  const { status, error, saved, retained } = await searchParams;
  const retentionDays = parseAnalyticsRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);
  const active = status === "all" ? undefined : status ?? "received";
  const admin = getAdminSupabase();
  const requests = admin ? await getAdminPrivacyRequests(admin, { status: active }) : [];
  const field = "rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Privacy Requests</h1>
      <p className="mt-1 text-sm text-ink/50">
        Requests from Account, Privacy &amp; Data. For a deletion, open the account, check what must be kept (orders, payments, owned pages), delete it
        from Users, then mark the request completed. Never mark a deletion completed before it happened.
      </p>
      {error && <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}
      {saved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          {retained !== undefined ? `Retention applied. ${Number(retained).toLocaleString()} analytics rows de-identified.` : "Saved."}
        </p>
      )}
      <section className="mt-4 rounded-2xl border border-black/5 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">Analytics Retention</h2>
        {retentionDays === null ? (
          <p className="mt-1 text-sm text-ink/50">
            Not configured. Set ANALYTICS_RETENTION_DAYS (whole days, at least 30) to enable it. Findmi sets no default period.
          </p>
        ) : (
          <form action={applyAnalyticsRetention} className="mt-1 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-ink/50">
              Analytics older than {retentionDays} days lose their account link, referrer and session id. Totals are kept. This can&rsquo;t be undone.
            </p>
            <button type="submit" className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:bg-black/[0.03]">
              Apply Retention
            </button>
          </form>
        )}
      </section>
      <div className="mt-4 flex flex-wrap gap-2">
        {[...STATUSES.map(([v, l]) => [v, l] as const), ["all", "All"] as const].map(([v, l]) => (
          <Link
            key={v}
            href={`/admin/privacy-requests?status=${v}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${(active ?? "all") === v ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"}`}
          >
            {l}
          </Link>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {requests.length === 0 && <p className="text-sm text-ink/50">Nothing here.</p>}
        {requests.map((r) => (
          <div key={r.id} className="rounded-2xl border border-black/5 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-findmi-50 px-2 py-0.5 font-bold text-findmi-700">{TYPE_LABELS[r.request_type] ?? r.request_type}</span>
              <span className="text-ink/50">{formatDateShort(r.created_at)}</span>
              {r.user_id ? (
                <Link href={`/admin/users/${r.user_id}`} className="font-semibold text-findmi-700 hover:underline">
                  Open Account
                </Link>
              ) : (
                <span className="text-ink/45">Account no longer exists</span>
              )}
              {r.contact_email && <span className="text-ink/50">{r.contact_email}</span>}
            </div>
            {r.details && <p className="mt-2 whitespace-pre-wrap text-sm text-ink/70">{r.details}</p>}
            <form action={updatePrivacyRequest.bind(null, r.id)} className="mt-3 flex flex-wrap items-end gap-2">
              <select name="status" defaultValue={r.status} className={field} aria-label="Status">
                {STATUSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <input autoCapitalize="sentences" type="text" name="admin_note" defaultValue={r.admin_note ?? ""} placeholder="Internal note" className={`${field} min-w-[12rem] flex-1`} />
              <button type="submit" className="rounded-full bg-findmi px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
                Save
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
