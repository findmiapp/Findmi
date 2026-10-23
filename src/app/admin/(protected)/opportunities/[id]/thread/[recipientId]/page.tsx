import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftGlyph } from "@/components/admin/shell/AdminIcons";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getAdminConversationDetail } from "@/lib/admin/conversations";
import { markFindmiRead } from "@/lib/opportunities";
import { RECIPIENT_STATUS_LABELS, type RecipientStatus } from "@/lib/opportunity-listings-domain";
import { formatDateShort, formatTime } from "@/lib/format";
import { RECIPIENT_BADGE } from "../../../format";
import { openRecipientThread, sendFindmiReply } from "../../../actions";

export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** One commercial Opportunity recipient's Business ↔ Findmi thread. The only
 * place Admin writes into a Conversation, and only as "Findmi" (never an
 * individual admin) — the global /admin/conversations view stays read-only. */
export default async function OpportunityRecipientThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; recipientId: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { id, recipientId } = await params;
  const { sent, error } = await searchParams;
  const admin = getAdminSupabase();
  if (!admin) notFound();

  const { data } = await admin
    .from("opportunity_recipients")
    .select("id, status, conversation_id, business:businesses(name), listing:opportunity_listings(title)")
    .eq("id", recipientId)
    .eq("listing_id", id)
    .maybeSingle();
  if (!data) notFound();
  const recipient = data as unknown as {
    id: string;
    status: RecipientStatus;
    conversation_id: string | null;
    business: { name: string } | { name: string }[] | null;
    listing: { title: string } | { title: string }[] | null;
  };
  const businessName = one(recipient.business)?.name ?? "Business";
  const listingTitle = one(recipient.listing)?.title ?? "Opportunity";

  const conversation = recipient.conversation_id ? await getAdminConversationDetail(recipient.conversation_id) : null;
  if (conversation) await markFindmiRead(admin, conversation.id);

  return (
    <div className="max-w-2xl">
      <Link href={`/admin/opportunities/${id}#recipient-${recipientId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-ink/50 hover:text-ink">
        <ChevronLeftGlyph className="h-3 w-3" />
        {listingTitle}
      </Link>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">Opportunity Thread</p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-ink">
            {businessName}
            <span className="mx-2 text-ink/30">↔</span>
            Findmi
          </h1>
        </div>
        <span className={`mt-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RECIPIENT_BADGE[recipient.status]}`}>
          {RECIPIENT_STATUS_LABELS[recipient.status]}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink/45">Replies here are sent as Findmi. The Business never sees which admin wrote them.</p>

      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {sent && !error && <p className="mt-4 rounded-xl border border-findmi/30 bg-findmi-50 px-4 py-3 text-sm text-findmi-700">Message sent as Findmi.</p>}

      {!conversation ? (
        <form action={openRecipientThread.bind(null, id, recipientId)} className="mt-6">
          <p className="text-sm text-ink/60">No conversation yet for this Business.</p>
          <button type="submit" className="mt-3 rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
            Start Thread
          </button>
        </form>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {conversation.messages.map((m) =>
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
            {conversation.messages.length === 0 && <p className="text-sm text-ink/50">No messages yet.</p>}
          </div>

          <form action={sendFindmiReply.bind(null, id, recipientId)} className="mt-6 flex flex-col gap-2">
            <label htmlFor="findmi-reply" className="text-xs font-semibold text-ink/55">
              Reply as Findmi
            </label>
            <textarea
              id="findmi-reply"
              name="body"
              required
              maxLength={4000}
              rows={3}
              autoCapitalize="sentences"
              className="w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
            />
            <button type="submit" className="self-end rounded-full bg-findmi px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-findmi-600">
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
