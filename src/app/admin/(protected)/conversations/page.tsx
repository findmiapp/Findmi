import Link from "next/link";
import { getAdminConversationList, type CommunicationType } from "@/lib/admin/conversations";
import { formatDateShort, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_TABS: { key: CommunicationType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "business", label: "Business" },
  { key: "product", label: "Product" },
  { key: "event", label: "Event" },
  { key: "venue", label: "Venue" },
  { key: "sales", label: "Sales" },
];

function tabHref(type: CommunicationType, q: string | undefined): string {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (q) params.set("q", q);
  const qs = params.toString();
  return `/admin/conversations${qs ? `?${qs}` : ""}`;
}

/** Communications Dashboard pass — one site-wide, read-only view of
 * every canonical Conversation (Business/Product/Event/Venue Inquiry,
 * Findmi Sales, and direct/opportunity messages), for support,
 * operations, abuse/spam investigation, fraud/safety review, and sales
 * follow-up. Not a second inbox: replies happen in each participant's
 * own Findmi Messages (or, for Sales, admin follows up directly — see
 * /admin/sales-inquiries). Filters/search are URL-driven and server-
 * rendered — no client state, no new pagination framework, a bounded
 * candidate window (see lib/admin/conversations.ts's own note) rather
 * than fetching every row. */
export default async function AdminConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  const { type: typeParam, q } = await searchParams;
  const type: CommunicationType = (TYPE_TABS.find((t) => t.key === typeParam)?.key ?? "all") as CommunicationType;
  const search = q?.trim() || undefined;

  const communications = await getAdminConversationList({ type, search });

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Communications</h1>
      <p className="mt-1 text-sm text-ink/60">View communications sent through Findmi.</p>

      <form action="/admin/conversations" method="GET" className="mt-4 flex gap-2">
        {type !== "all" && <input type="hidden" name="type" value={type} />}
        <input
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder="Search by name, email, business, product, event, venue…"
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full border border-black/15 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-ink transition hover:border-black/30"
        >
          Search
        </button>
      </form>
      {/* Search limitation, stated plainly rather than silently — see
          lib/admin/conversations.ts's own note: only each conversation's
          LATEST message is checked, not its full history. */}
      <p className="mt-1.5 text-xs text-ink/40">Searches names, emails, business/product/event/venue, and the latest message only.</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TYPE_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tabHref(tab.key, search)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
              type === tab.key ? "bg-ink text-white" : "bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {communications.map((c) => (
          <Link
            key={c.id}
            href={`/admin/conversations/${c.id}`}
            className="block rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:border-black/20"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-findmi-700">{c.typeLabel}</p>
              <p className="shrink-0 text-xs text-ink/40">
                {formatDateShort(c.lastActivityAt)} · {formatTime(c.lastActivityAt)}
              </p>
            </div>

            <p className="mt-1.5 text-sm font-semibold text-ink">
              {c.senderLabel ?? c.participantLabels[0] ?? "Findmi Member"}
              {c.recipientLabel && (
                <>
                  <span className="mx-1.5 text-ink/30">→</span>
                  {c.recipientLabel}
                </>
              )}
              {!c.recipientLabel && c.participantLabels.length > 1 && (
                <>
                  <span className="mx-1.5 text-ink/30">↔</span>
                  {c.participantLabels.slice(1).join(", ")}
                </>
              )}
            </p>

            {c.contextLine && <p className="mt-0.5 text-xs font-medium text-ink/50">{c.contextLine}</p>}
            {c.lastMessagePreview && <p className="mt-1 truncate text-sm text-ink/60">&ldquo;{c.lastMessagePreview}&rdquo;</p>}
          </Link>
        ))}

        {communications.length === 0 && (
          <p className="rounded-2xl border border-black/5 bg-white p-6 text-center text-sm text-ink/50">
            {search
              ? "No communications match that search."
              : type === "all"
                ? "No communications yet."
                : `No ${TYPE_TABS.find((t) => t.key === type)?.label} communications yet.`}
          </p>
        )}
      </div>
    </div>
  );
}
