import { getAdminSupabase } from "./supabase-admin";

// Communications Dashboard pass — turns the existing read-only
// Conversation visibility (Unify Site-Wide Communications pass) into a
// usable site-wide COMMUNICATIONS dashboard: type filters, search, a
// resolved sender/recipient/context line per row, and related-entity
// links. Still exactly the same underlying architecture and the same
// "admin reads only, plain getAdminSupabase()" pattern — no new tables,
// no schema change, no moderation/reply/edit/delete capability added.
// /admin/sales-inquiries stays the structured CRM view for Findmi Sales;
// this is still the raw communication record, not a competing inbox.

export type CommunicationType = "all" | "business" | "product" | "event" | "venue" | "sales";

const TYPE_SUBJECT_TYPE: Record<Exclude<CommunicationType, "all">, string> = {
  business: "business_inquiry",
  product: "product_inquiry",
  event: "event_inquiry",
  venue: "venue_inquiry",
  sales: "findmi_sales",
};

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  business_inquiry: "Business Inquiry",
  product_inquiry: "Product Inquiry",
  event_inquiry: "Event Inquiry",
  venue_inquiry: "Venue Inquiry",
  findmi_sales: "Findmi Sales",
  opportunity: "Opportunity",
  event_business_chat: "Direct Message",
  business_business_chat: "Direct Message",
  business_location_chat: "Direct Message",
};

export function conversationContextLabel(subjectType: string): string {
  return SUBJECT_TYPE_LABEL[subjectType] ?? subjectType;
}

interface ParticipantRow {
  entity_type: "business" | "event" | "location" | "personal";
  entity_id: string | null;
  user_id: string;
}

async function resolveParticipantLabels(
  admin: NonNullable<ReturnType<typeof getAdminSupabase>>,
  participants: ParticipantRow[]
): Promise<string[]> {
  const businessIds = [...new Set(participants.filter((p) => p.entity_type === "business" && p.entity_id).map((p) => p.entity_id!))];
  const eventIds = [...new Set(participants.filter((p) => p.entity_type === "event" && p.entity_id).map((p) => p.entity_id!))];
  const locationIds = [...new Set(participants.filter((p) => p.entity_type === "location" && p.entity_id).map((p) => p.entity_id!))];
  const personalUserIds = [...new Set(participants.filter((p) => p.entity_type === "personal").map((p) => p.user_id))];

  const [businesses, events, locations, profiles] = await Promise.all([
    businessIds.length ? admin.from("businesses").select("id, name").in("id", businessIds) : Promise.resolve({ data: [] }),
    eventIds.length ? admin.from("events").select("id, name").in("id", eventIds) : Promise.resolve({ data: [] }),
    locationIds.length ? admin.from("locations").select("id, name").in("id", locationIds) : Promise.resolve({ data: [] }),
    personalUserIds.length ? admin.from("profiles").select("id, display_name").in("id", personalUserIds) : Promise.resolve({ data: [] }),
  ]);
  const byKey = new Map<string, string>();
  for (const b of (businesses.data ?? []) as { id: string; name: string }[]) byKey.set(`business:${b.id}`, `${b.name} (Business)`);
  for (const e of (events.data ?? []) as { id: string; name: string }[]) byKey.set(`event:${e.id}`, `${e.name} (Event)`);
  for (const l of (locations.data ?? []) as { id: string; name: string }[]) byKey.set(`location:${l.id}`, `${l.name} (Venue)`);
  for (const p of (profiles.data ?? []) as { id: string; display_name: string | null }[])
    byKey.set(`personal:${p.id}`, `${p.display_name || "Findmi Member"} (Consumer)`);

  return participants.map((p) => {
    const key = p.entity_type === "personal" ? `personal:${p.user_id}` : `${p.entity_type}:${p.entity_id}`;
    return byKey.get(key) ?? (p.entity_type === "personal" ? "Findmi Member" : `${p.entity_type} (removed)`);
  });
}

/** Best-effort only — business_inquiry's chosen topic has no column of
 * its own; it's carried as a "Topic: X" prefix on the CONVERSATION'S
 * OPENING message (see connect/actions.ts's submitEntityInquiry). Never
 * fabricated: a conversation whose first message doesn't match this
 * exact shape (e.g. a reply, or an older/direct message type) simply
 * gets no topic line. */
function extractTopicPrefix(body: string | undefined): string | null {
  if (!body) return null;
  const match = /^Topic: (.+?)\n\n/.exec(body);
  return match ? match[1] : null;
}

export interface AdminEntityLink {
  label: string;
  href: string;
}

export interface AdminConversationListItem {
  id: string;
  subjectType: string;
  typeLabel: string;
  createdAt: string;
  lastActivityAt: string;
  senderLabel: string | null;
  recipientLabel: string | null;
  participantLabels: string[];
  guestEmail: string | null;
  contextLine: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
  entityLink: AdminEntityLink | null;
}

interface CandidateConversation {
  id: string;
  subject_type: string;
  subject_id: string;
  created_at: string;
  guest_name: string | null;
  guest_email: string | null;
}

/** Communications Dashboard pass — the one list query, now filterable by
 * type and a simple metadata search, sorted by most-recent-activity
 * (latest message time, falling back to when the conversation started).
 * A bounded number of batch queries regardless of row count (never
 * per-row): conversations, participants, messages (for both the latest-
 * preview AND the business_inquiry topic-prefix — same fetch, no second
 * pass), then one lookup each for products/sales_inquiries subject
 * context. Fetches a generous, still-bounded candidate window (not the
 * whole table) so sorting/searching happens correctly before the final
 * `limit` is applied — see this pass's own report on why a DB-level
 * LIMIT before that resort could otherwise drop a conversation whose
 * latest reply is recent even though it was created long ago. */
export async function getAdminConversationList(params: {
  type?: CommunicationType;
  search?: string;
  limit?: number;
} = {}): Promise<AdminConversationListItem[]> {
  const { type = "all", search, limit = 60 } = params;
  const admin = getAdminSupabase();
  if (!admin) return [];

  const CANDIDATE_CAP = 500;
  let query = admin
    .from("conversations")
    .select("id, subject_type, subject_id, created_at, guest_name, guest_email")
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_CAP);
  if (type !== "all") query = query.eq("subject_type", TYPE_SUBJECT_TYPE[type]);
  const { data: conversationRows } = await query;
  const conversations = (conversationRows ?? []) as CandidateConversation[];
  if (conversations.length === 0) return [];
  const ids = conversations.map((c) => c.id);

  const [{ data: participantRows }, { data: messageRows }] = await Promise.all([
    admin.from("conversation_participants").select("id, conversation_id, entity_type, entity_id, user_id").in("conversation_id", ids),
    admin
      .from("conversation_messages")
      .select("conversation_id, body, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  const participants = (participantRows ?? []) as (ParticipantRow & { id: string; conversation_id: string })[];
  const labels = await resolveParticipantLabels(admin, participants);
  const participantsByConversation = new Map<string, { entityType: ParticipantRow["entity_type"]; label: string }[]>();
  participants.forEach((p, i) => {
    const list = participantsByConversation.get(p.conversation_id) ?? [];
    list.push({ entityType: p.entity_type, label: labels[i] });
    participantsByConversation.set(p.conversation_id, list);
  });

  const messageCountByConversation = new Map<string, number>();
  const lastMessageByConversation = new Map<string, { body: string; created_at: string }>();
  const firstMessageByConversation = new Map<string, { body: string; created_at: string }>();
  // Iterated newest-first: the first write per id is the latest message,
  // the last write per id (unconditional) ends up being the earliest —
  // both captured in one pass over one query, no second fetch.
  for (const m of (messageRows ?? []) as { conversation_id: string; body: string; created_at: string }[]) {
    messageCountByConversation.set(m.conversation_id, (messageCountByConversation.get(m.conversation_id) ?? 0) + 1);
    if (!lastMessageByConversation.has(m.conversation_id)) lastMessageByConversation.set(m.conversation_id, m);
    firstMessageByConversation.set(m.conversation_id, m);
  }

  // Subject context — only for the two inquiry types whose subject_id
  // points somewhere OTHER than the recipient entity participant
  // (product_inquiry -> a Product; findmi_sales -> a sales_inquiries
  // row). business_inquiry/event_inquiry/venue_inquiry's subject_id IS
  // the recipient entity id, already covered by participant labels.
  const productSubjectIds = [...new Set(conversations.filter((c) => c.subject_type === "product_inquiry").map((c) => c.subject_id))];
  const salesSubjectIds = [...new Set(conversations.filter((c) => c.subject_type === "findmi_sales").map((c) => c.subject_id))];
  const [{ data: productRows }, { data: salesRows }] = await Promise.all([
    productSubjectIds.length ? admin.from("products").select("id, name, business_id").in("id", productSubjectIds) : Promise.resolve({ data: [] }),
    salesSubjectIds.length
      ? admin.from("sales_inquiries").select("id, business_name, city_market_count, regions").in("id", salesSubjectIds)
      : Promise.resolve({ data: [] }),
  ]);
  const productById = new Map(
    ((productRows ?? []) as { id: string; name: string; business_id: string }[]).map((p) => [p.id, p])
  );
  const productBusinessIds = [...new Set([...productById.values()].map((p) => p.business_id))];
  const { data: productBusinessRows } = productBusinessIds.length
    ? await admin.from("businesses").select("id, name").in("id", productBusinessIds)
    : { data: [] };
  const businessNameById = new Map(((productBusinessRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const salesById = new Map(
    ((salesRows ?? []) as { id: string; business_name: string; city_market_count: number; regions: string }[]).map((s) => [s.id, s])
  );

  const items: AdminConversationListItem[] = conversations.map((c) => {
    const last = lastMessageByConversation.get(c.id) ?? null;
    const first = firstMessageByConversation.get(c.id) ?? null;
    const parties = participantsByConversation.get(c.id) ?? [];
    const personalParty = parties.find((p) => p.entityType === "personal");
    const entityParty = parties.find((p) => p.entityType !== "personal");

    let senderLabel: string | null = c.guest_name ?? personalParty?.label ?? null;
    let recipientLabel: string | null = entityParty?.label ?? null;
    let contextLine: string | null = null;
    let entityLink: AdminEntityLink | null = null;

    if (c.subject_type === "business_inquiry") {
      contextLine = extractTopicPrefix(first?.body);
      if (entityParty) entityLink = { label: "View Business", href: `/admin/businesses/${c.subject_id}` };
    } else if (c.subject_type === "product_inquiry") {
      const product = productById.get(c.subject_id);
      if (product) {
        contextLine = `Product: ${product.name}`;
        recipientLabel = businessNameById.get(product.business_id) ?? recipientLabel;
        entityLink = { label: "View Product", href: `/admin/products/${c.subject_id}` };
      }
    } else if (c.subject_type === "event_inquiry") {
      entityLink = { label: "View Event", href: `/admin/events/${c.subject_id}` };
    } else if (c.subject_type === "venue_inquiry") {
      entityLink = { label: "View Venue", href: `/admin/locations/${c.subject_id}` };
    } else if (c.subject_type === "findmi_sales") {
      const sale = salesById.get(c.subject_id);
      recipientLabel = "Findmi";
      if (sale) {
        senderLabel = sale.business_name || senderLabel;
        contextLine = [sale.city_market_count ? `${sale.city_market_count} cities` : null, sale.regions || null]
          .filter(Boolean)
          .join(" · ") || null;
      }
      entityLink = { label: "View Sales Inquiry", href: "/admin/sales-inquiries" };
    }

    return {
      id: c.id,
      subjectType: c.subject_type,
      typeLabel: conversationContextLabel(c.subject_type),
      createdAt: c.created_at,
      lastActivityAt: last?.created_at ?? c.created_at,
      senderLabel,
      recipientLabel,
      participantLabels: parties.map((p) => p.label),
      guestEmail: c.guest_email,
      contextLine,
      lastMessagePreview: last ? (last.body.length > 140 ? `${last.body.slice(0, 137)}...` : last.body) : null,
      messageCount: messageCountByConversation.get(c.id) ?? 0,
      entityLink,
    };
  });

  // Search — metadata-only (Step 5's own documented limitation: only the
  // LATEST message body is checked, not full history, to avoid scanning
  // every message of every conversation for a list view). Every field
  // checked here is already resolved above, so this costs no extra
  // query — a plain in-memory filter over the already-built rows.
  const term = search?.trim().toLowerCase();
  const filtered = term
    ? items.filter((item) =>
        [item.senderLabel, item.recipientLabel, item.guestEmail, item.contextLine, item.lastMessagePreview, ...item.participantLabels]
          .filter((v): v is string => Boolean(v))
          .some((v) => v.toLowerCase().includes(term))
      )
    : items;

  filtered.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  return filtered.slice(0, limit);
}

export interface AdminConversationMessage {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  senderLabel: string | null;
}

export interface AdminConversationDetail {
  id: string;
  subjectType: string;
  typeLabel: string;
  createdAt: string;
  senderLabel: string | null;
  recipientLabel: string | null;
  participantLabels: string[];
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  contextLine: string | null;
  entityLink: AdminEntityLink | null;
  messages: AdminConversationMessage[];
}

export async function getAdminConversationDetail(conversationId: string): Promise<AdminConversationDetail | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, subject_type, subject_id, created_at, guest_name, guest_email, guest_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const row = conversation as {
    id: string;
    subject_type: string;
    subject_id: string;
    created_at: string;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
  };

  const { data: participantRows } = await admin
    .from("conversation_participants")
    .select("id, entity_type, entity_id, user_id")
    .eq("conversation_id", conversationId);
  const participants = (participantRows ?? []) as (ParticipantRow & { id: string })[];
  const labels = await resolveParticipantLabels(admin, participants);
  const labelByParticipantId = new Map(participants.map((p, i) => [p.id, labels[i]]));
  const entityParty = participants.find((p) => p.entity_type !== "personal");
  const personalParty = participants.find((p) => p.entity_type === "personal");

  let senderLabel: string | null = row.guest_name ?? (personalParty ? (labelByParticipantId.get(personalParty.id) ?? null) : null);
  let recipientLabel: string | null = entityParty ? (labelByParticipantId.get(entityParty.id) ?? null) : null;
  let contextLine: string | null = null;
  let entityLink: AdminEntityLink | null = null;

  const { data: messageRows } = await admin
    .from("conversation_messages")
    .select("id, kind, body, created_at, sender_participant_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const rawMessages = (messageRows ?? []) as { id: string; kind: string; body: string; created_at: string; sender_participant_id: string | null }[];

  if (row.subject_type === "business_inquiry") {
    contextLine = extractTopicPrefix(rawMessages[0]?.body);
    entityLink = { label: "View Business", href: `/admin/businesses/${row.subject_id}` };
  } else if (row.subject_type === "product_inquiry") {
    const { data: product } = await admin.from("products").select("id, name, business_id").eq("id", row.subject_id).maybeSingle();
    if (product) {
      const p = product as { id: string; name: string; business_id: string };
      contextLine = `Product: ${p.name}`;
      const { data: business } = await admin.from("businesses").select("name").eq("id", p.business_id).maybeSingle();
      recipientLabel = (business as { name: string } | null)?.name ?? recipientLabel;
      entityLink = { label: "View Product", href: `/admin/products/${row.subject_id}` };
    }
  } else if (row.subject_type === "event_inquiry") {
    entityLink = { label: "View Event", href: `/admin/events/${row.subject_id}` };
  } else if (row.subject_type === "venue_inquiry") {
    entityLink = { label: "View Venue", href: `/admin/locations/${row.subject_id}` };
  } else if (row.subject_type === "findmi_sales") {
    recipientLabel = "Findmi";
    const { data: sale } = await admin
      .from("sales_inquiries")
      .select("business_name, city_market_count, regions")
      .eq("id", row.subject_id)
      .maybeSingle();
    if (sale) {
      const s = sale as { business_name: string; city_market_count: number; regions: string };
      senderLabel = s.business_name || senderLabel;
      contextLine = [s.city_market_count ? `${s.city_market_count} cities` : null, s.regions || null].filter(Boolean).join(" · ") || null;
    }
    entityLink = { label: "View Sales Inquiry", href: "/admin/sales-inquiries" };
  }

  const messages: AdminConversationMessage[] = rawMessages.map((m) => ({
    id: m.id,
    kind: m.kind,
    body: m.body,
    createdAt: m.created_at,
    senderLabel: m.sender_participant_id
      ? (labelByParticipantId.get(m.sender_participant_id) ?? null)
      : row.guest_name
        ? `${row.guest_name} (Guest)`
        : null,
  }));

  return {
    id: row.id,
    subjectType: row.subject_type,
    typeLabel: conversationContextLabel(row.subject_type),
    createdAt: row.created_at,
    senderLabel,
    recipientLabel,
    participantLabels: labels,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    contextLine,
    entityLink,
    messages,
  };
}
