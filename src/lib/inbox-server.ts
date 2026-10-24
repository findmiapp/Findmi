import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { intentLabel } from "./commercial-inquiries-domain";
import type { CommercialIntent } from "./commercial-intents";
import { filterInbox, inboxUnreadCounts, type InboxScope } from "./inbox";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One short detail per listed thread — the Inquiry's intent ("Pop-Up"), the
 * Opportunity's title — from at most two batched reads over ONLY the threads
 * being shown (never the whole Inbox). Product names already come with the
 * list. Threads with nothing more to say get no entry. */
export async function inboxThreadDetails(admin: SupabaseClient, items: readonly { id: string; subjectType: string; subjectId: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = (type: string) => [...new Set(items.filter((i) => i.subjectType === type && UUID.test(i.subjectId)).map((i) => i.subjectId))];
  const inquiryIds = ids("commercial_inquiry");
  const recipientIds = ids("commercial_opportunity");
  const [inquiries, recipients] = await Promise.all([
    inquiryIds.length ? admin.from("commercial_inquiries").select("id, intent").in("id", inquiryIds) : Promise.resolve({ data: [] as Row[] }),
    recipientIds.length ? admin.from("opportunity_recipients").select("id, listing:opportunity_listings(title)").in("id", recipientIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const intentBy = new Map(((inquiries.data ?? []) as Row[]).map((r) => [r.id as string, intentLabel(r.intent as CommercialIntent)]));
  const titleBy = new Map(
    ((recipients.data ?? []) as Row[]).map((r) => {
      const l = Array.isArray(r.listing) ? r.listing[0] : r.listing;
      return [r.id as string, ((l as Row | null)?.title as string | undefined) ?? ""];
    })
  );
  for (const i of items) {
    const d = i.subjectType === "commercial_inquiry" ? intentBy.get(i.subjectId) : i.subjectType === "commercial_opportunity" ? titleBy.get(i.subjectId) : undefined;
    if (d) out.set(i.id, d);
  }
  return out;
}

/** The most threads one Inbox page lists (newest activity first). */
export const INBOX_PAGE_SIZE = 50;

export interface InboxView<T> {
  rows: (T & { detail: string | null })[];
  total: number;
  counts: { all: number; personal: number; business: Record<string, number> };
}

/** One scope of the unified Inbox: the person's authorized conversations
 * (lib/opportunities listConversationsForUser — the same read the Inbox always
 * used), minus Event-participation note threads (their Opportunity row already
 * represents them), filtered to the scope, capped, with details for the shown
 * rows only. Counts cover every scope from the same list. */
export async function loadInboxView<T extends { id: string; subjectType: string; subjectId: string; unread: boolean; myKeys: string[] }>(
  admin: SupabaseClient,
  all: readonly T[],
  scope: InboxScope,
  businessIds: readonly string[]
): Promise<InboxView<T>> {
  const visible = all.filter((c) => c.subjectType !== "opportunity");
  const scoped = filterInbox(visible, scope);
  const shown = scoped.slice(0, INBOX_PAGE_SIZE);
  const details = await inboxThreadDetails(admin, shown);
  return {
    rows: shown.map((c) => ({ ...c, detail: details.get(c.id) ?? null })),
    total: scoped.length,
    counts: inboxUnreadCounts(visible, businessIds),
  };
}
