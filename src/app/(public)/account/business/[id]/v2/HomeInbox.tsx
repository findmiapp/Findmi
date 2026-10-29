import Link from "next/link";
import NavIcon from "@/components/NavIcon";
import ChevronIcon from "@/components/ChevronIcon";
import { listConversationsForUser } from "@/lib/opportunities";
import { buildHomeInbox, HOME_INBOX_LIMIT, type HomeInboxItem, type HomeInboxTone } from "@/lib/home-inbox";
import type { FollowUp } from "@/lib/business-follow-ups";
import type { BusinessRequest } from "@/lib/business-requests";
import { managerThreadHref } from "@/lib/manager-links";
import { APP_TIMEZONE } from "@/lib/format";
import { getManagerCore } from "../managerContext";

/** Business Home → Inbox / Follow-Ups rows. Streams in behind its own Suspense
 * boundary (BusinessHome) because the unified Inbox read is the one Home read
 * that walks every conversation the viewer can see — the rest of Home never
 * waits on it. Follow-Ups and Requests arrive already resolved as props; this
 * adds the conversations and ranks all three (lib/home-inbox.ts). If the Inbox
 * read fails, the Follow-Ups and Requests still render. The viewer and the
 * service client come from the per-request-cached, already-authorized manager
 * context (../managerContext) — no second authorization or Business read. */
export async function HomeInboxRows({
  businessId,
  basePath,
  followUps,
  requests,
  expanded,
}: {
  businessId: string;
  basePath: string;
  followUps: FollowUp[];
  requests: BusinessRequest[];
  expanded: boolean;
}) {
  const { admin, user } = await getManagerCore(businessId);
  let conversations: Awaited<ReturnType<typeof listConversationsForUser>> = [];
  let inboxFailed = false;
  // A founder Admin session has no personal Inbox (same rule as the Inbox page).
  if (user) {
    try {
      conversations = await listConversationsForUser(admin, user.id);
    } catch {
      inboxFailed = true;
    }
  }
  const { items, actionableCount } = buildHomeInbox({
    businessId,
    followUps,
    requests,
    conversations,
    threadHref: (cid) => managerThreadHref(businessId, cid),
  });
  const shown = expanded ? items : items.slice(0, HOME_INBOX_LIMIT);
  const hidden = items.length - shown.length;

  return (
    <div className="mt-2.5">
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-black/[0.07] bg-white px-3.5 py-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-findmi-50 text-findmi-700">
            <CheckGlyph className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-card-title font-semibold text-primary">Nothing needs your attention</span>
            <span className="block text-metadata text-muted">New messages, requests and follow-ups will show up here.</span>
          </span>
        </div>
      ) : (
        <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
          {shown.map((item) => (
            <li key={item.key}>
              <InboxRow item={item} />
            </li>
          ))}
        </ul>
      )}
      {(hidden > 0 || (expanded && items.length > HOME_INBOX_LIMIT)) && (
        <Link
          href={expanded ? `${basePath}#home-inbox` : `${basePath}?inbox=all#home-inbox`}
          className="mt-2 inline-flex min-h-9 items-center gap-1 text-metadata font-semibold text-accent hover:underline"
        >
          {expanded ? "Show Less" : `Show ${hidden} More`}
          <ChevronIcon direction={expanded ? "up" : "down"} className="h-3 w-3" />
        </Link>
      )}
      {inboxFailed && <p className="mt-2 text-metadata text-muted">Messages couldn&rsquo;t load right now. Open the Inbox to see them.</p>}
      <span className="sr-only">{actionableCount === 1 ? "1 item needs attention" : `${actionableCount} items need attention`}</span>
    </div>
  );
}

const TONE_CLASS: Record<HomeInboxTone, string> = {
  overdue: "font-semibold text-amber-700",
  new: "font-semibold text-findmi-700",
  respond: "font-semibold text-findmi-700",
  upcoming: "text-muted",
  recent: "text-muted",
};

const ICON_TILE: Record<HomeInboxItem["kind"], string> = {
  follow_up: "bg-amber-50 text-amber-700",
  request: "bg-findmi-50 text-findmi-700",
  conversation: "bg-black/[0.04] text-ink/60",
};

function InboxRow({ item }: { item: HomeInboxItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 px-3.5 py-3 transition hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-findmi/40"
    >
      <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ICON_TILE[item.kind]}`}>
        {item.kind === "follow_up" ? (
          <NavIcon name="target" className="h-[18px] w-[18px]" />
        ) : item.kind === "request" ? (
          <NavIcon name="storefront" className="h-[18px] w-[18px]" />
        ) : (
          <MailGlyph className="h-[18px] w-[18px]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-card-title font-semibold text-primary">{item.title}</span>
          {item.at && <span className="shrink-0 text-microcopy text-subtle">{shortWhen(item.at)}</span>}
        </span>
        <span className={`block truncate text-metadata ${TONE_CLASS[item.tone]}`}>{item.state}</span>
        {item.detail && <span className="block truncate text-metadata text-secondary">{item.detail}</span>}
      </span>
      <ChevronIcon direction="right" className="h-3.5 w-3.5 shrink-0 text-ink/25" />
    </Link>
  );
}

/** "10:14 AM" today, otherwise "Oct 20" — in the app's one time zone. */
function shortWhen(iso: string): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: APP_TIMEZONE });
  return day(d) === day(new Date())
    ? d.toLocaleTimeString("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric" });
}

/** Same geometry as three rows, so the section doesn't jump when it streams in. */
export function HomeInboxSkeleton() {
  return (
    <div aria-hidden="true" className="mt-2.5 divide-y divide-black/[0.06] overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3.5 py-3">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-black/[0.05] motion-reduce:animate-none" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-3.5 w-2/5 animate-pulse rounded bg-black/[0.06] motion-reduce:animate-none" />
            <span className="h-3 w-3/5 animate-pulse rounded bg-black/[0.04] motion-reduce:animate-none" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** 24px / 1.8-stroke family, same as NavIcon. */
function MailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12.2l2.4 2.4 4.6-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
