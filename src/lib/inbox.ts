// Unified Inbox — pure rules over the ONE Conversation system (conversations /
// conversation_participants / conversation_messages). No second inbox, no
// second read state: a scope only FILTERS the conversations a person can
// already see, by which of their identities takes part.
//
//   All       — every conversation (each once, however many identities join it)
//   Personal  — the ones none of their Businesses is part of
//   Business  — the ones that Business is part of
//
// Requests stay structured items to decide on (lib/business-requests); an
// unread message never becomes a Request. Pure (client + server).

export type InboxScope = { kind: "all" } | { kind: "personal" } | { kind: "business"; businessId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?scope=` → a scope, limited to Businesses this person manages. */
export function parseInboxScope(raw: unknown, managedBusinessIds: readonly string[]): InboxScope {
  if (raw === "personal") return { kind: "personal" };
  if (typeof raw === "string" && raw.startsWith("business:")) {
    const id = raw.slice("business:".length);
    if (UUID.test(id) && managedBusinessIds.includes(id)) return { kind: "business", businessId: id };
  }
  return { kind: "all" };
}

export interface ScopedConversation {
  id: string;
  unread: boolean;
  /** The viewer's own identities taking part: "business:<id>", "personal:<uid>", "event:<id>", "location:<id>". */
  myKeys: readonly string[];
}

export function inScope(c: ScopedConversation, scope: InboxScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "business") return c.myKeys.includes(`business:${scope.businessId}`);
  return !c.myKeys.some((k) => k.startsWith("business:"));
}

export function filterInbox<T extends ScopedConversation>(items: readonly T[], scope: InboxScope): T[] {
  return items.filter((c) => inScope(c, scope));
}

/** Unread conversations per scope. Counted by conversation, so All never
 * double-counts a thread several of the viewer's identities share. */
export function inboxUnreadCounts(items: readonly ScopedConversation[], businessIds: readonly string[]): { all: number; personal: number; business: Record<string, number> } {
  const unread = items.filter((c) => c.unread);
  const business: Record<string, number> = {};
  for (const id of businessIds) business[id] = unread.filter((c) => inScope(c, { kind: "business", businessId: id })).length;
  return { all: new Set(unread.map((c) => c.id)).size, personal: unread.filter((c) => inScope(c, { kind: "personal" })).length, business };
}

// ── Why a thread exists ────────────────────────────────────────────────────

/** Business-language name for each kind of conversation (never subject_type). */
export const INBOX_TYPE_LABELS: Record<string, string> = {
  commercial_inquiry: "Commercial Inquiry",
  commercial_opportunity: "Opportunity",
  business_inquiry: "Customer Inquiry",
  product_inquiry: "Product Inquiry",
  event_inquiry: "Event Inquiry",
  venue_inquiry: "Place Inquiry",
  findmi_commercial_request: "Request To Findmi",
  findmi_sales: "Findmi",
  opportunity: "Event Participation",
  event_business_chat: "Message",
  business_business_chat: "Message",
  business_location_chat: "Message",
};

export const inboxTypeLabel = (subjectType: string) => INBOX_TYPE_LABELS[subjectType] ?? "Message";

/** The source object a thread is about, inside one Business's Manager — so a
 * thread can say "View Inquiry" / "View Opportunity" without duplicating it.
 * Null when there is nothing for this Business to open. */
export function threadSourceLink(subjectType: string, subjectId: string, businessId: string | null): { label: string; href: string } | null {
  if (!businessId || !UUID.test(subjectId)) return null;
  const b = `/account/business/${businessId}`;
  if (subjectType === "commercial_inquiry") return { label: "View Inquiry", href: `${b}/inquiries/${subjectId}?from=inbox` };
  if (subjectType === "commercial_opportunity") return { label: "View Opportunity", href: `${b}/opportunities/${subjectId}` };
  if (subjectType === "product_inquiry") return { label: "View Product", href: `${b}?tab=products&editing=${subjectId}#product-${subjectId}` };
  return null;
}
