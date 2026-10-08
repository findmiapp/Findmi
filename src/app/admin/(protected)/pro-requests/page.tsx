import Link from "next/link";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminProAccessRequests, type ProAccessRequestStatus } from "@/lib/pro-access-requests";
import { approveProAccessRequest, declineProAccessRequest } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_VIEWS: { value: ProAccessRequestStatus | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
];

function filterHref(status: ProAccessRequestStatus | undefined): string {
  return status ? `/admin/pro-requests?status=${status}` : "/admin/pro-requests";
}

/** Pro Access Request Workflow V1 — the minimum usable admin review
 * screen: list + status filter + per-row Approve/Decline, following
 * /admin/claims' own established pattern exactly (see that page). No
 * bulk actions, no SLA/assignment system, no CRM — one business's one
 * pending request at a time. */
export default async function AdminProAccessRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; approved?: string; declined?: string }>;
}) {
  const { status, error, approved, declined } = await searchParams;
  const activeStatus = STATUS_VIEWS.find((v) => v.value === status)?.value;

  const admin = getAdminSupabase();
  const requests = admin ? await getAdminProAccessRequests(admin, { status: activeStatus }) : [];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Pro Access Requests</h1>
      <p className="mt-1 text-sm text-ink/50">
        Businesses asking for Findmi Pro directly, with no payment submitted. Approving grants Pro the same way a
        Pro Invite does — review each request before approving.
      </p>

      {error && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
      )}
      {approved && !error && (
        <p className="mt-3 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">
          Request approved — Pro enabled.
        </p>
      )}
      {declined && !error && (
        <p className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 text-sm text-ink/70">
          Request declined.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_VIEWS.map((v) => (
          <Link
            key={v.label}
            href={filterHref(v.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              activeStatus === v.value ? "bg-findmi text-white" : "border border-black/10 text-ink/60 hover:border-black/20"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {requests.length === 0 && (
          <p className="text-sm text-ink/50">
            No{activeStatus ? ` ${STATUS_VIEWS.find((v) => v.value === activeStatus)?.label.toLowerCase()}` : ""} Pro access
            requests{activeStatus ? "." : " yet."}
          </p>
        )}

        {requests.map((r) => {
          const isPending = r.status === "pending";
          return (
            <div
              key={r.id}
              className={`rounded-2xl border p-4 text-sm ${isPending ? "border-black/10 bg-white" : "border-black/5 bg-black/[0.015]"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{r.business?.name ?? "Unknown business"}</p>
                  {r.business?.slug && <p className="text-xs text-ink/40">/business/{r.business.slug}</p>}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                    r.status === "approved"
                      ? "bg-findmi-50 text-findmi-700"
                      : r.status === "declined"
                        ? "bg-black/[0.06] text-ink/40"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {r.status}
                </span>
              </div>

              <p className={`mt-2 ${isPending ? "text-ink/70" : "text-ink/50"}`}>Requested by: {r.requesterEmail || "—"}</p>
              {r.message && <p className="mt-2 text-ink/60">&ldquo;{r.message}&rdquo;</p>}
              <p className="mt-2 text-xs text-ink/40">
                Submitted {new Date(r.createdAt).toLocaleString("en-US")}
                {r.reviewedAt && ` · Reviewed ${new Date(r.reviewedAt).toLocaleString("en-US")}`}
              </p>
              {!isPending && r.adminNote && <p className="mt-2 text-xs text-ink/50">Admin note: {r.adminNote}</p>}

              {isPending && r.business && (
                <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3 sm:flex-row sm:items-end">
                  <form action={approveProAccessRequest.bind(null, r.id)} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-ink/40">
                        Expires (optional — blank = permanent)
                      </span>
                      <input
                        type="date"
                        name="plan_expires_at"
                        className="rounded-lg border border-black/10 px-2.5 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-ink/40">Admin note (internal only)</span>
                      <input
                        type="text"
                        name="admin_note"
                        placeholder="Optional"
                        className="rounded-lg border border-black/10 px-2.5 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      className="h-9 shrink-0 rounded-lg bg-findmi px-3.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
                    >
                      Approve
                    </button>
                  </form>
                  <form action={declineProAccessRequest.bind(null, r.id)} className="flex shrink-0 items-end gap-2">
                    <input type="text" name="admin_note" placeholder="Optional note" className="rounded-lg border border-black/10 px-2.5 py-1.5 text-sm" />
                    <button
                      type="submit"
                      className="h-9 shrink-0 rounded-lg border border-black/10 px-3.5 text-xs font-bold uppercase tracking-wide text-ink/60 transition hover:bg-black/[0.03]"
                    >
                      Decline
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
