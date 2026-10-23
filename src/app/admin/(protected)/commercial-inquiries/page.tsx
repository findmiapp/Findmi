import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { adminListInquiries } from "@/lib/commercial-inquiries";
import { INQUIRY_STATUSES, INQUIRY_STATUS_LABELS, intentLabel, isInquiryStatus } from "@/lib/commercial-inquiries-domain";
import { formatDateShort } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Commercial Inquiries — every Business → counterparty Inquiry Findmi is
 * mediating. "Findmi Only" means nobody on the other side was safely resolved:
 * Findmi reaches out itself. Never shows the sender's private Target. */
export default async function AdminCommercialInquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const admin = getAdminSupabase();
  if (!admin) notFound();
  const filter = isInquiryStatus(status) ? status : null;
  const rows = await adminListInquiries(admin, filter);

  return (
    <div className="max-w-3xl">
      <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">Communications</p>
      <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">Commercial Inquiries</h1>
      <p className="mt-1 text-sm text-ink/55">Business Inquiries Findmi mediates. Replies from here are sent as Findmi.</p>

      <nav className="mt-4 flex flex-wrap gap-1.5 text-xs font-semibold">
        <Link href="/admin/commercial-inquiries" className={`rounded-full px-3 py-1.5 ${!filter ? "bg-ink text-white" : "bg-black/[0.05] text-ink/70"}`}>
          All
        </Link>
        {INQUIRY_STATUSES.map((s) => (
          <Link key={s} href={`/admin/commercial-inquiries?status=${s}`} className={`rounded-full px-3 py-1.5 ${filter === s ? "bg-ink text-white" : "bg-black/[0.05] text-ink/70"}`}>
            {INQUIRY_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      <ul className="mt-4 divide-y divide-black/[0.06] rounded-2xl border border-black/10 bg-white">
        {rows.length === 0 && <li className="px-4 py-6 text-sm text-ink/50">No Inquiries yet.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/commercial-inquiries/${r.id}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-black/[0.02]">
              <span className="text-sm font-semibold text-ink">
                {r.senderName} <span className="text-ink/30">→</span> {r.counterpartyName}
              </span>
              <span className="text-xs text-ink/55">
                {intentLabel(r.intent)} · {INQUIRY_STATUS_LABELS[r.status]} · {r.routed_entity_id ? "Routed" : "Findmi Only"} · {formatDateShort(r.created_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
