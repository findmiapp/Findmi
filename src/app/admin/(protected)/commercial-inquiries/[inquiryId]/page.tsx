import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftGlyph } from "@/components/admin/shell/AdminIcons";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminConversationDetail } from "@/lib/admin/conversations";
import { markFindmiRead } from "@/lib/opportunities";
import { getInquiryRow, toInquiryView } from "@/lib/commercial-inquiries";
import { INQUIRY_STATUS_LABELS, inquiryActionsFor, intentLabel } from "@/lib/commercial-inquiries-domain";
import { formatDateShort, formatTime } from "@/lib/format";
import { adminInquiryOutcome, adminInquiryReply } from "../actions";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = { accepted: "Mark Accepted", declined: "Mark Declined", closed: "Close Inquiry" };

/** One Commercial Inquiry, from Findmi's side: who, why, routing, the thread,
 * Findmi's reply box (sent AS Findmi — never an individual admin) and Findmi's
 * outcomes. The sender's private Target is never shown here either. */
export default async function AdminCommercialInquiryPage({ params, searchParams }: { params: Promise<{ inquiryId: string }>; searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { inquiryId } = await params;
  const { sent, error } = await searchParams;
  const admin = getAdminSupabase();
  if (!admin) notFound();
  const row = await getInquiryRow(admin, inquiryId);
  if (!row) notFound();
  const view = await toInquiryView(admin, row, "findmi");
  const conversation = row.conversation_id ? await getAdminConversationDetail(row.conversation_id) : null;
  if (conversation) await markFindmiRead(admin, conversation.id);
  const actions = inquiryActionsFor("findmi", row.status);

  return (
    <div className="max-w-2xl">
      <Link href="/admin/commercial-inquiries" className="inline-flex items-center gap-1 text-xs font-semibold text-ink/50 hover:text-ink">
        <ChevronLeftGlyph className="h-3 w-3" />
        Commercial Inquiries
      </Link>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-findmi-700">Commercial Inquiry · {intentLabel(row.intent)}</p>
      <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
        {view.sender.name}
        <span className="mx-2 text-ink/30">→</span>
        {view.counterparty.name}
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        {INQUIRY_STATUS_LABELS[row.status]} · Sent {formatDateShort(row.created_at)} ·{" "}
        {row.routed_entity_id ? `Routed to the ${row.routed_entity_type === "business" ? "Business" : row.routed_entity_type === "location" ? "Place" : "Event"}'s members` : "Findmi only — nobody on their side is on Findmi; reach out directly"}
      </p>
      <p className="mt-1 text-xs text-ink/45">Replies and outcomes here are recorded as Findmi.</p>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {sent && !error && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Message sent as Findmi.</p>}

      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((a) => (
            <form key={a} action={adminInquiryOutcome.bind(null, row.id, a)}>
              <button type="submit" className="rounded-full border border-black/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30">
                {ACTION_LABEL[a]}
              </button>
            </form>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {(conversation?.messages ?? []).map((m) =>
          m.kind === "system" ? (
            <p key={m.id} className="text-center text-xs text-ink/45">
              {m.body} · {formatDateShort(m.createdAt)}
            </p>
          ) : (
            <div key={m.id} className={`rounded-2xl border p-4 ${m.senderLabel === "Findmi" ? "border-findmi/25 bg-findmi-50/60" : "border-black/10 bg-white"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                {m.senderLabel ?? "Unknown"} · {formatDateShort(m.createdAt)} · {formatTime(m.createdAt)}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink/80">{m.body}</p>
            </div>
          )
        )}
        {!conversation && <p className="text-sm text-ink/50">No conversation yet — replying creates it.</p>}
      </div>

      <form action={adminInquiryReply.bind(null, row.id)} className="mt-6 flex flex-col gap-2">
        <label htmlFor="findmi-inquiry-reply" className="text-xs font-semibold text-ink/55">
          Reply as Findmi
        </label>
        <textarea id="findmi-inquiry-reply" name="body" required maxLength={4000} rows={3} autoCapitalize="sentences" className="w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none" />
        <button type="submit" className="self-end rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
          Send
        </button>
      </form>
    </div>
  );
}
