import { getAdminSupabase } from "./supabase-admin";

// Unify Site-Wide Communications pass — the smallest admin-only
// visibility into the canonical Conversation architecture (Phase 15 of
// that pass). Read-only: no moderation tooling, no per-message actions,
// just enough to see what's happening across every context (direct
// MESSAGE, Business/Event/Venue Inquiry, Findmi Sales) in one place. Not
// a second inbox for the founder to work leads from — /admin/sales-
// inquiries stays the structured CRM view for Findmi Sales specifically;
// this is the raw communication record. Same "admin reads only, plain
// getAdminSupabase()" pattern as referral-queries.ts/pro_invites — the
// real authorization is /admin/(protected)'s own session gate, already
// enforced before any page here ever renders.

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

export interface AdminConversationListItem {
  id: string;
  contextLabel: string;
  createdAt: string;
  participantLabels: string[];
  guestName: string | null;
  guestEmail: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
}

/** Newest first, capped — an operational recent-activity view, not a
 * paginated full archive (this pass's own explicit "no broad moderation
 * dashboard" scope). */
export async function getAdminConversationList(limit = 100): Promise<AdminConversationListItem[]> {
  const admin = getAdminSupabase();
  if (!admin) return [];

  const { data: conversationRows } = await admin
    .from("conversations")
    .select("id, subject_type, created_at, guest_name, guest_email")
    .order("created_at", { ascending: false })
    .limit(limit);
  const conversations = (conversationRows ?? []) as {
    id: string;
    subject_type: string;
    created_at: string;
    guest_name: string | null;
    guest_email: string | null;
  }[];
  if (conversations.length === 0) return [];
  const ids = conversations.map((c) => c.id);

  const [{ data: participantRows }, { data: messageRows }] = await Promise.all([
    admin.from("conversation_participants").select("conversation_id, entity_type, entity_id, user_id").in("conversation_id", ids),
    admin
      .from("conversation_messages")
      .select("conversation_id, body, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false }),
  ]);

  const participants = (participantRows ?? []) as (ParticipantRow & { conversation_id: string })[];
  const labels = await resolveParticipantLabels(admin, participants);
  const labelsByConversation = new Map<string, string[]>();
  participants.forEach((p, i) => {
    const list = labelsByConversation.get(p.conversation_id) ?? [];
    list.push(labels[i]);
    labelsByConversation.set(p.conversation_id, list);
  });

  const messageCountByConversation = new Map<string, number>();
  const lastMessageByConversation = new Map<string, { body: string; created_at: string }>();
  for (const m of (messageRows ?? []) as { conversation_id: string; body: string; created_at: string }[]) {
    messageCountByConversation.set(m.conversation_id, (messageCountByConversation.get(m.conversation_id) ?? 0) + 1);
    if (!lastMessageByConversation.has(m.conversation_id)) lastMessageByConversation.set(m.conversation_id, m);
  }

  return conversations.map((c) => {
    const last = lastMessageByConversation.get(c.id) ?? null;
    return {
      id: c.id,
      contextLabel: conversationContextLabel(c.subject_type),
      createdAt: c.created_at,
      participantLabels: labelsByConversation.get(c.id) ?? [],
      guestName: c.guest_name,
      guestEmail: c.guest_email,
      messageCount: messageCountByConversation.get(c.id) ?? 0,
      lastMessagePreview: last ? (last.body.length > 120 ? `${last.body.slice(0, 117)}...` : last.body) : null,
      lastMessageAt: last?.created_at ?? null,
    };
  });
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
  contextLabel: string;
  createdAt: string;
  participantLabels: string[];
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  messages: AdminConversationMessage[];
}

export async function getAdminConversationDetail(conversationId: string): Promise<AdminConversationDetail | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, subject_type, created_at, guest_name, guest_email, guest_phone")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const row = conversation as {
    id: string;
    subject_type: string;
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

  const { data: messageRows } = await admin
    .from("conversation_messages")
    .select("id, kind, body, created_at, sender_participant_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const messages: AdminConversationMessage[] = (
    (messageRows ?? []) as { id: string; kind: string; body: string; created_at: string; sender_participant_id: string | null }[]
  ).map((m) => ({
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
    contextLabel: conversationContextLabel(row.subject_type),
    createdAt: row.created_at,
    participantLabels: labels,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    messages,
  };
}
