import Link from "next/link";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getPublicProfilesByUserIds } from "@/lib/profiles";
import type { Inquiry } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Native Inquiries V1 — compact admin visibility only, per this pass's
 * own "do not build a giant CRM" instruction: a flat list (business,
 * customer public identity, status, timestamp), read-only, no reply
 * capability here (replies stay a Business Manager action). Uses the
 * existing requireAdminSupabase()-gated service-role pattern every other
 * admin list page already uses — never exposes customer_email/
 * customer_phone in this view. */
export default async function AdminInquiriesPage() {
  const supabase = await requireAdminSupabase();

  const { data } = await supabase
    .from("inquiries")
    .select("*, business:businesses(name, slug), product:products(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  type Row = Inquiry & { business: { name: string; slug: string } | null; product: { name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const userIds = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id));
  const profiles = await getPublicProfilesByUserIds(supabase, userIds);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Inquiries</h1>
      <p className="mt-1 text-sm text-ink/50">
        Every native FindMi inquiry across all businesses — read-only. Replies happen in the business&rsquo;s own
        Business Manager.
      </p>

      <div className="mt-5 overflow-x-auto rounded-2xl border border-black/10 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-black/10 text-xs font-bold uppercase tracking-wide text-ink/40">
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Context</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const profile = r.user_id ? profiles.get(r.user_id) : undefined;
              return (
                <tr key={r.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/inquiries/${r.id}`} className="font-medium text-findmi-700 hover:underline">
                      {r.business?.name ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {profile ? `${profile.display_name || `@${profile.username}`}` : r.user_id ? "FindMi account" : "Anonymous"}
                  </td>
                  <td className="px-4 py-3 text-ink/50">{r.product?.name ?? "General"}</td>
                  <td className="px-4 py-3 text-ink/70">{r.status}</td>
                  <td className="px-4 py-3 text-ink/45">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink/40">
                  No inquiries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
