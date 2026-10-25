import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminAuditEvents } from "@/lib/admin/trust-queries";
import { formatDateShort, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Audit Log — privileged actions (account deletion, password resets,
 * access changes, Moment authorship changes, sensitive Manage-As writes,
 * report and privacy-request decisions). Admin actions all come from the
 * one shared admin password, so they are attributed to "Admin", not to a
 * person. */
export default async function AdminAuditPage() {
  const admin = getAdminSupabase();
  const events = admin ? await getAdminAuditEvents(admin) : [];
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Audit Log</h1>
      <p className="mt-1 text-sm text-ink/50">
        The latest 200 privileged actions. Admin actions share one admin password, so they can&rsquo;t be attributed to an individual person.
      </p>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/5 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink/45">
            <tr>
              <th className="px-4 py-2 font-semibold">When</th>
              <th className="px-4 py-2 font-semibold">Action</th>
              <th className="px-4 py-2 font-semibold">By</th>
              <th className="px-4 py-2 font-semibold">Target</th>
              <th className="px-4 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-ink/50">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2 text-ink/60">
                  {formatDateShort(e.created_at)} {formatTime(e.created_at)}
                </td>
                <td className="px-4 py-2 font-medium text-ink">{e.action}</td>
                <td className="px-4 py-2 text-ink/60">{e.actor_kind === "admin" ? "Admin" : "Account"}</td>
                <td className="px-4 py-2 text-ink/60">{[e.target_type, e.target_id].filter(Boolean).join(" ")}</td>
                <td className="px-4 py-2 text-xs text-ink/50">{Object.keys(e.detail ?? {}).length > 0 ? JSON.stringify(e.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
