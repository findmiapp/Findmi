import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import { inboxTypeLabel } from "@/lib/inbox";

export interface InboxThreadRow {
  id: string;
  href: string;
  otherPartyLabel: string;
  subjectType: string;
  /** Intent, Opportunity title or product, when known. */
  detail: string | null;
  /** Which of the viewer's identities it reached, when that helps (All scope). */
  viaLabel: string | null;
  lastMessageBody: string | null;
  lastActivityAt: string;
  unread: boolean;
}

/** Inbox rows — who, why ("Commercial Inquiry · Pop-Up"), the latest line and
 * when. Flat divided rows; the whole row opens the thread. */
export default function InboxThreadList({ rows, empty }: { rows: InboxThreadRow[]; empty: string }) {
  if (!rows.length) return <p className="text-body text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-black/[0.06]">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={c.href} className="flex min-h-[64px] items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-body font-semibold text-primary">
                {c.unread && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-findmi" />}
                <span className="truncate">{c.otherPartyLabel}</span>
              </p>
              <p className="mt-0.5 truncate text-metadata font-semibold text-secondary">{[inboxTypeLabel(c.subjectType), c.detail, c.viaLabel].filter(Boolean).join(" · ")}</p>
              <p className="mt-0.5 truncate text-metadata text-muted">{c.lastMessageBody || "No messages yet"}</p>
            </div>
            <span className="shrink-0 pt-0.5 text-microcopy text-subtle">{formatDateShort(c.lastActivityAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
