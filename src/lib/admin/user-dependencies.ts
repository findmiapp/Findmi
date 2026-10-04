import { getAdminSupabase } from "./supabase-admin";

// Admin → Users — Recovery pass. What one account is connected to, and
// whether removing the auth account is SAFE. Deleting an auth.users row
// cascades (or detaches) a lot of public data via FKs, so the rule here
// is conservative: anything valuable to the platform or to other people
// (ownership, public Journal content, billing records) BLOCKS deletion
// outright instead of being cascaded away. The delete action recomputes
// this server-side; the page only displays it.

export interface UserClaimRow {
  kind: "business" | "event" | "location";
  name: string;
  status: string;
  createdAt: string;
}

export interface UserJournalRow {
  id: string;
  title: string;
  visibility: string;
  status: string;
  entryDate: string;
}

export interface UserDependencySummary {
  claims: UserClaimRow[];
  journal: UserJournalRow[];
  counts: {
    ownerMemberships: number;
    otherMemberships: number;
    savesAndFollows: number;
    entitlements: number;
    stripeCustomers: number;
    proRedemptions: number;
    subscriptionsPaid: number;
    orders: number;
    inquiries: number;
    inquiryMessages: number;
    marketRequests: number;
    marketInterestsWithoutEmail: number;
    handles: number;
    conversations: number;
    opportunities: number;
  };
  /** Reasons deletion is refused. Empty = deletion allowed (with the
   * warnings below, after typed confirmation). */
  blockers: string[];
  /** What a permitted deletion would remove or detach. */
  effects: string[];
}

const SAVE_FOLLOW_TABLES = [
  "account_saved_businesses",
  "account_saved_events",
  "account_saved_products",
  "account_saved_locations",
  "account_followed_businesses",
  "account_followed_events",
  "account_followed_locations",
] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function getUserDependencySummary(userId: string): Promise<UserDependencySummary | null> {
  const supabase = getAdminSupabase();
  if (!supabase) return null;

  type CountQuery = any;
  const count = async (table: string, column: string, extra?: (q: CountQuery) => CountQuery): Promise<number> => {
    let q: CountQuery = supabase.from(table).select("*", { count: "exact", head: true }).eq(column, userId);
    if (extra) q = extra(q);
    const { count: n } = await q;
    return n ?? 0;
  };
  const memberships = async (table: string) => {
    const { data } = await supabase.from(table).select("role").eq("user_id", userId);
    const rows = (data ?? []) as { role: string }[];
    return { owner: rows.filter((r) => r.role === "owner").length, other: rows.filter((r) => r.role !== "owner").length };
  };
  const claims = async (table: string, embed: string, kind: UserClaimRow["kind"]): Promise<UserClaimRow[]> => {
    const { data } = await supabase.from(table).select(`status, created_at, ${embed}(name)`).eq("user_id", userId);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const e = r[embed] as { name: string } | { name: string }[] | null;
      const entity = Array.isArray(e) ? e[0] : e;
      return { kind, name: entity?.name ?? "(removed)", status: String(r.status), createdAt: String(r.created_at) };
    });
  };

  const [bm, em, lm, bc, ec, lc, journalRes, saveCounts, entitlements, stripeCustomers, proRedemptions, subscriptionsPaid, orders, inquiries, inquiryMessages, marketRequests, marketInterestsWithoutEmail, handles, conversations, opportunities] =
    await Promise.all([
      memberships("business_members"),
      memberships("event_members"),
      memberships("location_members"),
      claims("business_claim_requests", "businesses", "business"),
      claims("event_claim_requests", "events", "event"),
      claims("location_claim_requests", "locations", "location"),
      supabase.from("journal_entries").select("id, title, visibility, status, entry_date").eq("user_id", userId).order("entry_date", { ascending: false }),
      Promise.all(SAVE_FOLLOW_TABLES.map((t) => count(t, "user_id"))),
      count("account_entitlements", "user_id"),
      count("stripe_customers", "user_id"),
      count("pro_invite_redemptions", "redeemed_by"),
      count("business_subscriptions", "payer_user_id"),
      count("orders", "user_id"),
      count("inquiries", "user_id"),
      count("inquiry_messages", "sender_user_id"),
      count("market_requests", "requester_user_id"),
      count("market_request_interests", "user_id", (q) => q.is("email", null)),
      count("handles", "user_id"),
      count("conversation_participants", "user_id"),
      count("opportunities", "initiator_user_id"),
    ]);

  const journal: UserJournalRow[] = ((journalRes.data ?? []) as { id: string; title: string; visibility: string; status: string; entry_date: string }[]).map(
    (j) => ({ id: j.id, title: j.title, visibility: j.visibility, status: j.status, entryDate: j.entry_date })
  );
  const publicJournal = journal.filter((j) => j.visibility === "public" && j.status === "published").length;
  const counts = {
    ownerMemberships: bm.owner + em.owner + lm.owner,
    otherMemberships: bm.other + em.other + lm.other,
    savesAndFollows: saveCounts.reduce((a, b) => a + b, 0),
    entitlements,
    stripeCustomers,
    proRedemptions,
    subscriptionsPaid,
    orders,
    inquiries,
    inquiryMessages,
    marketRequests,
    marketInterestsWithoutEmail,
    handles,
    conversations,
    opportunities,
  };

  const blockers: string[] = [];
  if (counts.ownerMemberships > 0)
    blockers.push(`Owns ${plural(counts.ownerMemberships, "Business/Event/Location", "Businesses/Events/Locations")} — transfer ownership first.`);
  if (publicJournal > 0) blockers.push(`Has ${plural(publicJournal, "public Journal entry", "public Journal entries")} — deleting the account would delete them.`);
  if (counts.entitlements > 0 || counts.stripeCustomers > 0) blockers.push("Has membership / billing records (entitlements or a Stripe customer).");
  if (counts.subscriptionsPaid > 0) blockers.push(`Pays for ${plural(counts.subscriptionsPaid, "business subscription")}.`);
  if (counts.proRedemptions > 0) blockers.push(`Redeemed ${plural(counts.proRedemptions, "Pro invite")} (the database refuses to detach these).`);
  if (counts.marketInterestsWithoutEmail > 0) blockers.push("Has Market interest signups with no email on file (the database refuses to detach these).");

  const claimsAll = [...bc, ...ec, ...lc];
  const privateJournal = journal.length - publicJournal;
  const effects: string[] = ["Removes the sign-in account and profile."];
  if (counts.otherMemberships > 0) effects.push(`Removes ${plural(counts.otherMemberships, "manager/staff access grant")} (the entities themselves stay).`);
  if (claimsAll.length > 0) effects.push(`Deletes ${plural(claimsAll.length, "claim request")}.`);
  if (privateJournal > 0) effects.push(`Deletes ${plural(privateJournal, "private or draft Journal entry", "private or draft Journal entries")}.`);
  if (counts.savesAndFollows > 0) effects.push(`Deletes ${plural(counts.savesAndFollows, "save/follow")}.`);
  const detached = [
    counts.orders && plural(counts.orders, "order"),
    counts.inquiries && plural(counts.inquiries, "inquiry", "inquiries"),
    counts.inquiryMessages && plural(counts.inquiryMessages, "inquiry message"),
    counts.marketRequests && plural(counts.marketRequests, "Market request"),
    counts.handles && plural(counts.handles, "handle"),
  ].filter(Boolean);
  if (detached.length > 0) effects.push(`Keeps but un-links ${detached.join(", ")} (records stay; the account link is cleared).`);
  if (counts.conversations > 0 || counts.opportunities > 0)
    effects.push("Conversation and opportunity history stays as-is for the other participants.");

  return { claims: claimsAll, journal, counts, blockers, effects };
}
