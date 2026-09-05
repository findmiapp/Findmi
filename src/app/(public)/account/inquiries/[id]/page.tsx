import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCustomerInquiryDetail } from "@/lib/inquiries";
import SupabaseImage from "@/components/SupabaseImage";
import AccountNav from "../../AccountNav";
import { sendCustomerMessage } from "../actions";

export const metadata: Metadata = {
  title: "Inquiry",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none";

/** Native Inquiries V1 — a customer's own conversation thread with one
 * business. getCustomerInquiryDetail already scopes to
 * `.eq("user_id", user.id)` on top of inquiries_select_customer RLS, so
 * a mistyped/foreign id here resolves to notFound(), never another
 * user's thread. Marks the thread read (mark_inquiry_read RPC) on every
 * view — the simplest durable "last seen" model this pass calls for, no
 * per-message read receipts. */
export default async function AccountInquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/inquiries/${id}`)}`);

  const detail = await getCustomerInquiryDetail(supabase, id, user.id);
  if (!detail) notFound();

  await supabase.rpc("mark_inquiry_read", { p_inquiry_id: id, p_as: "customer" });

  const replyAction = sendCustomerMessage.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <Link href="/account/inquiries" className="text-xs font-semibold text-ink/50 hover:text-ink">
        ← All inquiries
      </Link>

      <div className="mt-3 flex items-center gap-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-mist">
          {detail.business.logo_url && (
            <SupabaseImage src={detail.business.logo_url} alt={detail.business.name} fill sizes="48px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <Link href={`/business/${detail.business.slug}`} className="truncate font-display text-lg font-bold tracking-tight text-ink hover:underline">
            {detail.business.name}
          </Link>
          <p className="text-xs text-ink/45">
            {STATUS_LABELS[detail.inquiry.status] ?? detail.inquiry.status}
            {detail.inquiry.product_id ? " · Product inquiry" : ""}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} businessName={detail.business.name} />
        ))}
      </div>

      <form action={replyAction} className="mt-6 flex flex-col gap-2">
        <textarea name="body" required rows={3} placeholder="Write a reply…" className={`${inputClass} resize-y`} />
        <button
          type="submit"
          className="self-start rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600"
        >
          Send
        </button>
      </form>

      {(detail.inquiry.customer_email || detail.inquiry.customer_phone) && (
        <p className="mt-4 text-xs text-ink/40">
          You shared {[detail.inquiry.customer_email, detail.inquiry.customer_phone].filter(Boolean).join(" and ")} with
          this business when you sent this inquiry.
        </p>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  replied: "Replied",
  contacted: "Contacted",
  booked: "Booked",
  closed: "Closed",
};

function MessageBubble({ message, businessName }: { message: { sender_type: string; body: string; created_at: string }; businessName: string }) {
  const fromBusiness = message.sender_type === "business";
  return (
    <div className={`flex flex-col ${fromBusiness ? "items-start" : "items-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          fromBusiness ? "bg-black/[0.04] text-ink" : "bg-findmi text-white"
        }`}
      >
        <p className="whitespace-pre-line">{message.body}</p>
      </div>
      <p className="mt-1 px-1 text-[11px] text-ink/35">
        {fromBusiness ? businessName : "You"} · {new Date(message.created_at).toLocaleString()}
      </p>
    </div>
  );
}
