// Business Home → Inbox / Follow-Ups: "What needs my attention?" — ONE ranked
// preview over the records that already own each kind of attention. Nothing is
// stored and no status is invented here:
//   • Follow-Ups  — this Business's Target next steps (lib/business-follow-ups)
//   • Requests    — sent TO this Business, waiting on it (lib/business-requests)
//   • Conversations — the unified Inbox, scoped to this Business (lib/inbox)
// Order: overdue follow-ups → unread conversations → requests needing a
// response → upcoming / undated follow-ups → recent (read) conversations.
// Pure and client-safe.
import type { FollowUp } from "./business-follow-ups";
import type { BusinessRequest } from "./business-requests";
import { filterInbox, inboxTypeLabel } from "./inbox";

/** Home shows this many rows; `?inbox=all` shows every ranked row. */
export const HOME_INBOX_LIMIT = 4;
/** A read conversation counts as "recent activity" for this many days. */
export const HOME_INBOX_RECENT_DAYS = 14;
/** At most this many recent (already read) conversations are ever listed. */
export const HOME_INBOX_RECENT_LIMIT = 3;

export type HomeInboxKind = "follow_up" | "request" | "conversation";
/** Drives the state line's tone only; the words come from the record. */
export type HomeInboxTone = "overdue" | "new" | "respond" | "upcoming" | "recent";

export interface HomeInboxItem {
  key: string;
  kind: HomeInboxKind;
  /** Person / Business / place / Event on the other side. */
  title: string;
  /** Current state, in the record's own words ("Overdue", "New Message", …). */
  state: string;
  tone: HomeInboxTone;
  /** Subject / next step / context, when there is any. */
  detail: string | null;
  /** ISO timestamp shown on the right (conversations only). */
  at: string | null;
  href: string;
  /** Needs the Business to act (everything except recent read threads). */
  actionable: boolean;
}

/** The fields of lib/opportunities ConversationListItem this preview reads. */
export interface HomeInboxConversation {
  id: string;
  otherPartyLabel: string;
  subjectType: string;
  subjectId: string;
  lastMessageBody: string | null;
  lastActivityAt: string;
  productName: string | null;
  unread: boolean;
  myKeys: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Conversation → row. The state is the thread's real read state. */
function conversationItem(c: HomeInboxConversation, href: string): HomeInboxItem {
  const kind = inboxTypeLabel(c.subjectType);
  const body = c.lastMessageBody?.replace(/\s+/g, " ").trim() || null;
  return {
    key: `conversation:${c.id}`,
    kind: "conversation",
    title: c.otherPartyLabel,
    state: c.unread ? `${kind} · New Message` : kind,
    tone: c.unread ? "new" : "recent",
    detail: c.productName ? [c.productName, body].filter(Boolean).join(" · ") : body,
    at: c.lastActivityAt,
    href,
    actionable: c.unread,
  };
}

/** Request → row. Its meta already reads "Kind · Response Requested". */
function requestItem(r: BusinessRequest): HomeInboxItem {
  return { key: r.key, kind: "request", title: r.title, state: r.meta, tone: "respond", detail: r.detail, at: null, href: r.href, actionable: true };
}

function followUpItem(f: FollowUp): HomeInboxItem {
  return {
    key: f.key,
    kind: "follow_up",
    title: f.title,
    state: f.meta,
    tone: f.due === "overdue" ? "overdue" : "upcoming",
    detail: f.detail,
    at: null,
    href: f.href,
    actionable: true,
  };
}

export function buildHomeInbox({
  businessId,
  followUps,
  requests,
  conversations,
  threadHref,
  now = Date.now(),
}: {
  businessId: string;
  /** Already ordered by buildFollowUps (overdue → today → soon → later → undated). */
  followUps: readonly FollowUp[];
  /** Already ordered by buildBusinessRequests. */
  requests: readonly BusinessRequest[];
  /** Every conversation the viewer can see (any scope); this keeps THIS Business's. */
  conversations: readonly HomeInboxConversation[];
  threadHref: (conversationId: string) => string;
  now?: number;
}): { items: HomeInboxItem[]; actionableCount: number } {
  // Same scope rule as the Business Inbox (lib/inbox-server loadInboxView):
  // this Business's threads, minus Event-participation note threads, whose
  // Opportunity / invitation row already represents them.
  const threads = filterInbox(
    conversations.filter((c) => c.subjectType !== "opportunity"),
    { kind: "business", businessId }
  ).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id));
  const unread = threads.filter((c) => c.unread);
  const recentCutoff = now - HOME_INBOX_RECENT_DAYS * DAY_MS;
  const recent = threads.filter((c) => !c.unread && Date.parse(c.lastActivityAt) >= recentCutoff).slice(0, HOME_INBOX_RECENT_LIMIT);
  const overdue = followUps.filter((f) => f.due === "overdue");
  const upcoming = followUps.filter((f) => f.due !== "overdue");

  const items: HomeInboxItem[] = [
    ...overdue.map(followUpItem),
    ...unread.map((c) => conversationItem(c, threadHref(c.id))),
    ...requests.map(requestItem),
    ...upcoming.map(followUpItem),
    ...recent.map((c) => conversationItem(c, threadHref(c.id))),
  ];
  return { items, actionableCount: items.filter((i) => i.actionable).length };
}
