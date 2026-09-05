import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCustomerInquiryList } from "@/lib/inquiries";
import SupabaseImage from "@/components/SupabaseImage";
import AccountNav from "../AccountNav";

export const metadata: Metadata = {
  title: "Inquiries",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Native Inquiries V1 — the authenticated customer's own inquiry
 * threads, RLS-scoped to auth.uid() (inquiries_select_customer). Every
 * row here was created either by this pass's own native compose flow
 * (account/inquiries/new) or, in the future, any other native-inquiry
 * entry point that attaches this same user_id — never inferred from
 * email, and never another user's inquiry. */
export default async function AccountInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/inquiries");

  const inquiries = await getCustomerInquiryList(supabase, user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <AccountNav />

      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Inquiries</h1>
      <p className="mt-1.5 text-sm text-ink/50">Conversations you&rsquo;ve started with FindMi businesses.</p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {inquiries.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">No inquiries yet</p>
          <p className="mt-1 text-sm text-ink/50">
            Send a message from a business&rsquo;s FindMi profile when they offer it, and the conversation will show
            up here.
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          {inquiries.map((inq) => (
            <Link
              key={inq.id}
              href={`/account/inquiries/${inq.id}`}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm transition hover:border-black/10"
            >
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-mist">
                {inq.businessLogoUrl && (
                  <SupabaseImage src={inq.businessLogoUrl} alt={inq.businessName} fill sizes="44px" className="object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-ink">{inq.businessName}</p>
                  {inq.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-findmi" aria-label="Unread" />}
                </div>
                {inq.productName && <p className="truncate text-xs text-ink/45">Re: {inq.productName}</p>}
                {inq.lastMessage && (
                  <p className="mt-0.5 truncate text-xs text-ink/55">
                    {inq.lastMessage.senderType === "business" ? `${inq.businessName}: ` : "You: "}
                    {inq.lastMessage.body}
                  </p>
                )}
              </div>
              <StatusPill status={inq.status} />
            </Link>
          ))}
        </div>
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

function StatusPill({ status }: { status: string }) {
  return (
    <span className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink/55">
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
