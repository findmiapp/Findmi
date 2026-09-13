import { getAdminSalesInquiries } from "@/lib/admin/sales-inquiries";
import { formatDateShort } from "@/lib/format";
import { updateSalesInquiryStatus } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["new", "contacted", "qualified", "closed"] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  new: "bg-findmi-50 text-findmi-700",
  contacted: "bg-black/5 text-ink/70",
  qualified: "bg-findmi-50 text-findmi-700",
  closed: "bg-black/5 text-ink/40",
};

/** Multi-Region / National Sales Inquiry pass — a small, deliberately
 * plain lead queue for /join's "Talk to Sales" submissions
 * (sales_inquiries, source='join_multi_region'). Not a general lead-
 * management system: no filtering/search/pagination, no assignment, no
 * notes — this pass's own scope is "the founder can see what came in and
 * mark it worked," matching the smallest existing admin list-page
 * convention (referrals/page.tsx) rather than building anything new. */
export default async function AdminSalesInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const inquiries = await getAdminSalesInquiries();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Sales Inquiries</h1>
      <p className="mt-1 text-sm text-ink/60">
        Multi-Region / National leads submitted through /join&rsquo;s &ldquo;Talk to Sales&rdquo; form. Notified
        to Findmiapp@gmail.com when submitted — this list is the durable record.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/10">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-black/[0.02] text-xs font-semibold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Cities/Markets</th>
              <th className="px-4 py-3">Regions</th>
              <th className="px-4 py-3">Goals</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {inquiries.map((inquiry) => (
              <tr key={inquiry.id} className="align-top hover:bg-black/[0.015]">
                <td className="px-4 py-3 font-semibold text-ink">
                  {inquiry.business_name}
                  {inquiry.website_or_instagram && (
                    <p className="text-xs font-normal text-ink/45">{inquiry.website_or_instagram}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {inquiry.contact_name}
                  {inquiry.phone && <p className="text-xs text-ink/45">{inquiry.phone}</p>}
                </td>
                <td className="px-4 py-3 text-ink/70">{inquiry.email}</td>
                <td className="px-4 py-3 text-ink/70">{inquiry.city_market_count}</td>
                <td className="px-4 py-3 max-w-[220px] text-ink/70">{inquiry.regions}</td>
                <td className="px-4 py-3 max-w-[280px] text-ink/70">{inquiry.goals}</td>
                <td className="px-4 py-3 text-ink/50">{formatDateShort(inquiry.created_at)}</td>
                <td className="px-4 py-3">
                  <form action={updateSalesInquiryStatus} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={inquiry.id} />
                    <select
                      name="status"
                      defaultValue={inquiry.status}
                      className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE_CLASS[inquiry.status] ?? "bg-black/5 text-ink/70"}`}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-semibold text-ink/60 transition hover:border-black/30"
                    >
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {inquiries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-ink/50">
                  No sales inquiries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
