import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommercialIntent, TargetKind } from "./commercial-intents";
import { TARGET_COLUMN, checkCounterparty, kindOf } from "./business-targets";
import type { TargetStatus } from "./business-targets-domain";
import {
  COMMERCIAL_INQUIRY_SUBJECT,
  canMoveInquiry,
  inquiryEmail,
  inquiryHistoryLine,
  intentLabel,
  isOpenInquiry,
  statusAfterReply,
  targetStatusAfterInquiry,
  validateInquiryInput,
  type InquiryActor,
  type InquiryStatus,
} from "./commercial-inquiries-domain";
import { addEntityParticipants, addSystemMessage, ensureFindmiParticipant } from "./opportunities";
import { getEntityManagerEmails, type NotifiableEntityKind } from "./notifications/recipients";
import { sendProductNotification } from "./notifications/productNotify";
import { notifyAdmin } from "./notifications/adminNotify";

/** Commercial Inquiry v1 — server workflow over commercial_inquiries and the
 * existing Conversation system. Service-role client; NO authorization of its
 * own: callers (inquiry actions, the Business Manager page, Admin) have
 * already verified the session for the Business / entity they pass, exactly
 * like lib/business-targets.ts and lib/opportunities.ts.
 *
 * Privacy: the sender's private Target is referenced only by target_id, read
 * only for the SENDER, and never copied — no Context, Activity, Next Action,
 * status or internal notes reach the Inquiry, its Conversation or any email.
 * The counterparty side is resolved conservatively from verified members only
 * (never from text such as organizer_name); when nobody is safely resolvable
 * the Inquiry is Sender ↔ Findmi and Findmi mediates. Never creates a Find Us
 * Here entry, Appearance, Event participation, Opportunity or Order. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
type Routed = { entityType: NotifiableEntityKind; entityId: string } | null;

export const INQUIRY_COLUMNS =
  "id, sender_business_id, target_id, counterparty_business_id, counterparty_location_id, counterparty_event_id, intent, status, message, conversation_id, routed_entity_type, routed_entity_id, created_at, updated_at, status_changed_at, responded_at";

export interface InquiryRow {
  id: string;
  sender_business_id: string;
  target_id: string | null;
  counterparty_business_id: string | null;
  counterparty_location_id: string | null;
  counterparty_event_id: string | null;
  intent: CommercialIntent;
  status: InquiryStatus;
  message: string | null;
  conversation_id: string | null;
  routed_entity_type: NotifiableEntityKind | null;
  routed_entity_id: string | null;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  responded_at: string | null;
}

const COUNTERPARTY_COLUMN: Record<TargetKind, "counterparty_business_id" | "counterparty_location_id" | "counterparty_event_id"> = {
  business: "counterparty_business_id",
  location: "counterparty_location_id",
  event: "counterparty_event_id",
};
const TABLE: Record<TargetKind, "businesses" | "locations" | "events"> = { business: "businesses", location: "locations", event: "events" };

export function inquiryKind(r: Pick<InquiryRow, "counterparty_business_id" | "counterparty_location_id" | "counterparty_event_id">): TargetKind {
  return r.counterparty_location_id ? "location" : r.counterparty_event_id ? "event" : "business";
}
export const inquiryCounterpartyId = (r: Pick<InquiryRow, "counterparty_business_id" | "counterparty_location_id" | "counterparty_event_id">) =>
  (r.counterparty_location_id ?? r.counterparty_event_id ?? r.counterparty_business_id) as string;

// ── Counterparty routing (who besides Findmi joins the Conversation) ────────

async function hasMembers(admin: SupabaseClient, kind: NotifiableEntityKind, id: string): Promise<boolean> {
  const table = kind === "business" ? "business_members" : kind === "event" ? "event_members" : "location_members";
  const col = kind === "business" ? "business_id" : kind === "event" ? "event_id" : "location_id";
  const { data } = await admin.from(table).select("id").eq(col, id).limit(1);
  return ((data ?? []) as Row[]).length > 0;
}

async function liveBusinessWithMembers(admin: SupabaseClient, businessId: string, senderBusinessId: string): Promise<boolean> {
  if (businessId === senderBusinessId) return false;
  const { data } = await admin.from("businesses").select("id, is_demo, publication_status, archived_at, trashed_at").eq("id", businessId).maybeSingle();
  const b = data as { is_demo: boolean | null; publication_status: string | null; archived_at: string | null; trashed_at: string | null } | null;
  if (!b || b.is_demo || b.publication_status !== "live" || b.archived_at || b.trashed_at) return false;
  return hasMembers(admin, "business", businessId);
}

/** Conservative routing, from verified relationships only:
 *   Business → that Business (when it has members);
 *   Location → its own members, else its ONE operating Business (the primary
 *              one when several) with members;
 *   Event    → its own members, else its canonical host Business with members
 *              (never organizer_name text).
 * Null = nobody safely resolvable: Sender ↔ Findmi, Findmi mediates. */
export async function resolveInquiryRoute(admin: SupabaseClient, senderBusinessId: string, kind: TargetKind, counterpartyId: string): Promise<Routed> {
  if (kind === "business") return (await liveBusinessWithMembers(admin, counterpartyId, senderBusinessId)) ? { entityType: "business", entityId: counterpartyId } : null;
  if (kind === "location") {
    if (await hasMembers(admin, "location", counterpartyId)) return { entityType: "location", entityId: counterpartyId };
    const { data } = await admin.from("business_locations").select("business_id, is_primary").eq("location_id", counterpartyId);
    const operators = ((data ?? []) as { business_id: string; is_primary: boolean | null }[]).filter((o) => o.business_id !== senderBusinessId);
    const primary = operators.filter((o) => o.is_primary);
    const pick = primary.length === 1 ? primary[0] : operators.length === 1 ? operators[0] : null;
    return pick && (await liveBusinessWithMembers(admin, pick.business_id, senderBusinessId)) ? { entityType: "business", entityId: pick.business_id } : null;
  }
  if (await hasMembers(admin, "event", counterpartyId)) return { entityType: "event", entityId: counterpartyId };
  const { data } = await admin.from("events").select("host_business_id").eq("id", counterpartyId).maybeSingle();
  const host = (data as { host_business_id: string | null } | null)?.host_business_id ?? null;
  return host && (await liveBusinessWithMembers(admin, host, senderBusinessId)) ? { entityType: "business", entityId: host } : null;
}

// ── Names ──────────────────────────────────────────────────────────────────

async function names(admin: SupabaseClient, inquiry: Pick<InquiryRow, "sender_business_id" | "counterparty_business_id" | "counterparty_location_id" | "counterparty_event_id">): Promise<{ sender: string; counterparty: string }> {
  const kind = inquiryKind(inquiry);
  const [s, c] = await Promise.all([
    admin.from("businesses").select("name").eq("id", inquiry.sender_business_id).maybeSingle(),
    admin.from(TABLE[kind]).select("name").eq("id", inquiryCounterpartyId(inquiry)).maybeSingle(),
  ]);
  return { sender: (s.data as { name: string } | null)?.name ?? "A Business", counterparty: (c.data as { name: string } | null)?.name ?? "them" };
}

// ── Send ───────────────────────────────────────────────────────────────────

export type SendInquiryResult = { ok: true; inquiryId: string; conversationId: string | null; existing: boolean } | { ok: false; error: string; participation?: boolean };

async function readBy(admin: SupabaseClient, filter: (q: any) => any): Promise<InquiryRow | null> {
  const { data } = await filter(admin.from("commercial_inquiries").select(INQUIRY_COLUMNS)).maybeSingle();
  return (data as InquiryRow | null) ?? null;
}
const openFor = (senderBusinessId: string, kind: TargetKind, counterpartyId: string) => (q: any) =>
  q.eq("sender_business_id", senderBusinessId).eq(COUNTERPARTY_COLUMN[kind], counterpartyId).in("status", ["sent", "responded"]);

/** One controlled send: validate → create (or reuse) the Inquiry → its one
 * Conversation, participants, history line and opening message → emails.
 * Idempotent: the same request_key (a double tap / retry) resolves to the same
 * Inquiry, and an Inquiry already open with this counterparty is returned
 * instead of a second one. Messages and emails are written only by the call
 * that created the thread (or, after an interrupted send, when the thread is
 * still empty), so a retry never duplicates them. */
export async function sendCommercialInquiry(
  admin: SupabaseClient,
  input: { senderBusinessId: string; userId: string | null; targetId: string | null; kind: TargetKind; counterpartyId: string; intent: unknown; message: unknown; requestKey: string }
): Promise<SendInquiryResult> {
  const { senderBusinessId, kind, counterpartyId } = input;
  if (!UUID.test(counterpartyId)) return { ok: false, error: "That counterparty wasn't found." };
  if (!UUID.test(input.requestKey)) return { ok: false, error: "Please try again." };
  const checked = validateInquiryInput({ kind, intent: input.intent, message: input.message });
  if (!checked.ok) return { ok: false, error: checked.error, participation: checked.error.startsWith("Event participation") };

  // A Target-linked send must be THIS Business's Target for THIS counterparty.
  let targetStatus: TargetStatus | null = null;
  if (input.targetId) {
    if (!UUID.test(input.targetId)) return { ok: false, error: "That Target wasn't found." };
    const { data } = await admin.from("business_targets").select("id, status, target_business_id, target_location_id, target_event_id").eq("id", input.targetId).eq("business_id", senderBusinessId).maybeSingle();
    const t = data as { id: string; status: TargetStatus; target_business_id: string | null; target_location_id: string | null; target_event_id: string | null } | null;
    if (!t || kindOf(t) !== kind || t[TARGET_COLUMN[kind]] !== counterpartyId) return { ok: false, error: "That Target wasn't found." };
    targetStatus = t.status;
  }

  // Retry of the same send → the same Inquiry (finish its setup if interrupted).
  const retried = await readBy(admin, (q) => q.eq("sender_business_id", senderBusinessId).eq("request_key", input.requestKey));
  if (retried) return finishSend(admin, retried, input.userId, false);
  const open = await readBy(admin, openFor(senderBusinessId, kind, counterpartyId));
  if (open) return { ok: true, inquiryId: open.id, conversationId: open.conversation_id, existing: true };

  const refused = await checkCounterparty(admin, senderBusinessId, kind, counterpartyId);
  if (refused) return { ok: false, error: refused };

  const routed = await resolveInquiryRoute(admin, senderBusinessId, kind, counterpartyId);
  const { data: inserted, error } = await admin
    .from("commercial_inquiries")
    .insert({
      sender_business_id: senderBusinessId,
      target_id: input.targetId,
      [COUNTERPARTY_COLUMN[kind]]: counterpartyId,
      intent: checked.intent,
      status: "sent",
      message: checked.message,
      routed_entity_type: routed?.entityType ?? null,
      routed_entity_id: routed?.entityId ?? null,
      request_key: input.requestKey,
      created_by_user_id: input.userId,
    })
    .select(INQUIRY_COLUMNS)
    .single();
  if (error || !inserted) {
    if (error?.code === "23505") {
      // A concurrent double tap (same key) or another open Inquiry won the race.
      const again = (await readBy(admin, (q) => q.eq("sender_business_id", senderBusinessId).eq("request_key", input.requestKey))) ?? (await readBy(admin, openFor(senderBusinessId, kind, counterpartyId)));
      if (again) return { ok: true, inquiryId: again.id, conversationId: again.conversation_id, existing: true };
    }
    console.error("sendCommercialInquiry failed:", error?.message);
    return { ok: false, error: "Couldn't send that Inquiry. Please try again." };
  }

  // Target → In Conversation (only from Target; the Activity trigger records it).
  const nextTarget = input.targetId && targetStatus ? targetStatusAfterInquiry(targetStatus) : null;
  if (nextTarget && input.targetId) {
    await admin
      .from("business_targets")
      .update({ status: nextTarget, status_actor: input.userId ? "business" : "findmi", status_actor_user_id: input.userId })
      .eq("id", input.targetId)
      .eq("business_id", senderBusinessId)
      .eq("status", "target");
  }
  return finishSend(admin, inserted as InquiryRow, input.userId, true);
}

async function finishSend(admin: SupabaseClient, inquiry: InquiryRow, userId: string | null, createdNow: boolean): Promise<SendInquiryResult> {
  const thread = await ensureInquiryThread(admin, inquiry);
  if (!thread) return { ok: true, inquiryId: inquiry.id, conversationId: null, existing: !createdNow };
  if (thread.writeOpening) {
    const n = await names(admin, inquiry);
    await addSystemMessage(admin, thread.conversationId, inquiryHistoryLine("sent", n, inquiry.intent));
    if (inquiry.message) {
      const sender = await senderParticipantId(admin, thread.conversationId, inquiry.sender_business_id, userId);
      await admin.from("conversation_messages").insert({ conversation_id: thread.conversationId, sender_participant_id: sender, kind: "text", body: inquiry.message });
    }
    await notifyInquiryCreated(admin, inquiry, thread.conversationId, n);
  }
  return { ok: true, inquiryId: inquiry.id, conversationId: thread.conversationId, existing: !createdNow };
}

/** The sending member's own participant row (else any of the sender Business's). */
async function senderParticipantId(admin: SupabaseClient, conversationId: string, businessId: string, userId: string | null): Promise<string | null> {
  const { data } = await admin.from("conversation_participants").select("id, user_id").eq("conversation_id", conversationId).eq("entity_type", "business").eq("entity_id", businessId);
  const rows = (data ?? []) as { id: string; user_id: string | null }[];
  return (rows.find((r) => r.user_id === userId) ?? rows[0])?.id ?? null;
}

/** The Inquiry's one Conversation, created exactly once (the subject is unique
 * per Inquiry, so a racing create resolves to the first). Participants are
 * re-added idempotently on every call: the sender Business's members, Findmi,
 * and the routed counterparty's members. `writeOpening` is true only for the
 * call that created the thread, or when an interrupted send left it empty. */
export async function ensureInquiryThread(admin: SupabaseClient, inquiry: InquiryRow): Promise<{ conversationId: string; writeOpening: boolean } | null> {
  let conversationId = inquiry.conversation_id;
  let created = false;
  if (!conversationId) {
    const { data, error } = await admin.from("conversations").insert({ subject_type: COMMERCIAL_INQUIRY_SUBJECT, subject_id: inquiry.id }).select("id").single();
    if (data) {
      conversationId = (data as { id: string }).id;
      created = true;
    } else if (error?.code === "23505") {
      const { data: existing } = await admin.from("conversations").select("id").eq("subject_type", COMMERCIAL_INQUIRY_SUBJECT).eq("subject_id", inquiry.id).maybeSingle();
      conversationId = (existing as { id: string } | null)?.id ?? null;
    }
    if (!conversationId) return null;
    await admin.from("commercial_inquiries").update({ conversation_id: conversationId }).eq("id", inquiry.id).is("conversation_id", null);
  }
  await addEntityParticipants(admin, conversationId, "business", inquiry.sender_business_id);
  await ensureFindmiParticipant(admin, conversationId);
  if (inquiry.routed_entity_type && inquiry.routed_entity_id) await addEntityParticipants(admin, conversationId, inquiry.routed_entity_type, inquiry.routed_entity_id);
  let writeOpening = created;
  if (!created) {
    const { data } = await admin.from("conversation_messages").select("id").eq("conversation_id", conversationId).limit(1);
    writeOpening = ((data ?? []) as Row[]).length === 0;
  }
  return { conversationId, writeOpening };
}

// ── Replies and outcomes ───────────────────────────────────────────────────

/** Called after a text message lands in an Inquiry's thread: the first reply
 * from the other side (or Findmi) moves Sent → Responded. Conditional on the
 * row still being Sent, so concurrent replies move it once. */
export async function recordInquiryReply(admin: SupabaseClient, conversationId: string, by: { entityType: string; entityId: string | null }): Promise<void> {
  const inquiry = await readBy(admin, (q) => q.eq("conversation_id", conversationId));
  if (!inquiry) return;
  const actor: InquiryActor = by.entityType === "findmi" ? "findmi" : by.entityType === "business" && by.entityId === inquiry.sender_business_id ? "sender" : "counterparty";
  const next = statusAfterReply(inquiry.status, actor);
  if (next === inquiry.status) return;
  await admin.from("commercial_inquiries").update({ status: next, responded_at: new Date().toISOString() }).eq("id", inquiry.id).eq("status", "sent");
}

export type InquiryOutcomeResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** An explicit outcome. The caller has resolved `actor` from a real session
 * (inquiryActorFor / Admin). Conditional on the status read, so a double tap
 * moves it once; the history line and emails follow only a real change.
 * Never touches the Target, Find Us Here, Appearances, participation or Orders. */
export async function setInquiryOutcome(admin: SupabaseClient, inquiryId: string, actor: InquiryActor, next: InquiryStatus): Promise<InquiryOutcomeResult> {
  if (!UUID.test(inquiryId)) return { ok: false, error: "That Inquiry wasn't found." };
  const inquiry = await readBy(admin, (q) => q.eq("id", inquiryId));
  if (!inquiry) return { ok: false, error: "That Inquiry wasn't found." };
  if (inquiry.status === next) return { ok: true, changed: false };
  if (!canMoveInquiry(actor, inquiry.status, next)) return { ok: false, error: isOpenInquiry(inquiry.status) ? "You can't do that on this Inquiry." : "This Inquiry is already resolved." };
  const { data } = await admin.from("commercial_inquiries").update({ status: next }).eq("id", inquiry.id).eq("status", inquiry.status).select("id");
  if (!((data ?? []) as Row[]).length) return { ok: true, changed: false };
  const n = await names(admin, inquiry);
  if (inquiry.conversation_id) await addSystemMessage(admin, inquiry.conversation_id, inquiryHistoryLine(next, n, inquiry.intent));
  await notifyInquiryOutcome(admin, inquiry, next, n);
  return { ok: true, changed: true };
}

/** The viewer's role on an Inquiry for one of their Businesses / entities:
 * sender (a member of the sending Business) or counterparty (a member of the
 * routed entity). Never inferred from text, category or the Target. */
export function inquiryActorForEntity(inquiry: Pick<InquiryRow, "sender_business_id" | "routed_entity_type" | "routed_entity_id">, entity: { entityType: string; entityId: string }): InquiryActor | null {
  if (entity.entityType === "business" && entity.entityId === inquiry.sender_business_id) return "sender";
  if (inquiry.routed_entity_type && entity.entityType === inquiry.routed_entity_type && entity.entityId === inquiry.routed_entity_id) return "counterparty";
  return null;
}

// ── Notifications ──────────────────────────────────────────────────────────

const threadUrl = (conversationId: string | null) => (conversationId ? `/account/messages/${conversationId}` : "/account/messages");

async function notifyInquiryCreated(admin: SupabaseClient, inquiry: InquiryRow, conversationId: string, n: { sender: string; counterparty: string }): Promise<void> {
  if (inquiry.routed_entity_type && inquiry.routed_entity_id) {
    const copy = inquiryEmail("received", n, inquiry.intent);
    await sendProductNotification({
      to: await getEntityManagerEmails(admin, inquiry.routed_entity_type, inquiry.routed_entity_id),
      type: "commercial_inquiry_received",
      subject: copy.subject,
      heading: copy.heading,
      body: [copy.body],
      actionLabel: "Open Inquiry",
      actionUrl: threadUrl(conversationId),
    });
  }
  await notifyAdmin({
    subject: `New Commercial Inquiry: ${n.sender} → ${n.counterparty}`,
    heading: `${n.sender} sent an Inquiry (${intentLabel(inquiry.intent)})`,
    body: [inquiry.routed_entity_type ? `${n.counterparty} was added to the conversation.` : `No one on ${n.counterparty}'s side is on Findmi yet — Findmi mediates this one.`],
    actionLabel: "Open Inquiry",
    actionUrl: `/admin/commercial-inquiries/${inquiry.id}`,
  });
}

async function notifyInquiryOutcome(admin: SupabaseClient, inquiry: InquiryRow, next: InquiryStatus, n: { sender: string; counterparty: string }): Promise<void> {
  const url = threadUrl(inquiry.conversation_id);
  const counterpartyEmails = () => (inquiry.routed_entity_type && inquiry.routed_entity_id ? getEntityManagerEmails(admin, inquiry.routed_entity_type, inquiry.routed_entity_id) : Promise.resolve([] as string[]));
  if (next === "accepted" || next === "declined") {
    const copy = inquiryEmail(next, n, inquiry.intent);
    await sendProductNotification({ to: await getEntityManagerEmails(admin, "business", inquiry.sender_business_id), type: `commercial_inquiry_${next}`, subject: copy.subject, heading: copy.heading, body: [copy.body], actionLabel: "Open Inquiry", actionUrl: url });
  } else if (next === "withdrawn") {
    const copy = inquiryEmail("withdrawn", n, inquiry.intent);
    await sendProductNotification({ to: await counterpartyEmails(), type: "commercial_inquiry_withdrawn", subject: copy.subject, heading: copy.heading, body: [copy.body], actionLabel: "Open Conversation", actionUrl: url });
  } else if (next === "closed") {
    const copy = inquiryEmail("closed", n, inquiry.intent);
    const to = [...new Set([...(await getEntityManagerEmails(admin, "business", inquiry.sender_business_id)), ...(await counterpartyEmails())])];
    await sendProductNotification({ to, type: "commercial_inquiry_closed", subject: copy.subject, heading: copy.heading, body: [copy.body], actionLabel: "Open Conversation", actionUrl: url });
  }
  if (next !== "closed") {
    await notifyAdmin({ subject: `Inquiry ${next}: ${n.sender} → ${n.counterparty}`, heading: `Inquiry ${next}`, body: [`${intentLabel(inquiry.intent)} · ${n.sender} → ${n.counterparty}`], actionLabel: "Open Inquiry", actionUrl: `/admin/commercial-inquiries/${inquiry.id}` });
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

export interface InquiryParty {
  kind: TargetKind;
  id: string;
  name: string;
  imageUrl: string | null;
  href: string | null;
}

/** What a party to the Inquiry may see. There is deliberately no Target data
 * here; `targetId` is set only in the SENDER's view (its own Target). */
export interface InquiryView {
  id: string;
  role: InquiryActor;
  sender: InquiryParty;
  counterparty: InquiryParty;
  intent: CommercialIntent;
  status: InquiryStatus;
  message: string | null;
  conversationId: string | null;
  createdAt: string;
  statusChangedAt: string;
  /** Findmi mediates alone (no one on the other side resolved). */
  findmiOnly: boolean;
  targetId: string | null;
}

async function party(admin: SupabaseClient, kind: TargetKind, id: string): Promise<InquiryParty> {
  const cols = kind === "business" ? "id, name, slug, logo_url, cover_image_url" : kind === "location" ? "id, name, slug, cover_image_url, logo_url" : "id, name, slug, cover_image_url";
  const { data } = await admin.from(TABLE[kind]).select(cols).eq("id", id).maybeSingle();
  const r = (data ?? {}) as Row;
  const path = kind === "business" ? "business" : kind === "location" ? "location" : "event";
  return {
    kind,
    id,
    name: (r.name as string) ?? (kind === "business" ? "A Business" : kind === "location" ? "A Place" : "An Event"),
    imageUrl: ((kind === "business" ? r.logo_url ?? r.cover_image_url : r.cover_image_url ?? r.logo_url) as string | null) ?? null,
    href: r.slug ? `/${path}/${r.slug}` : null,
  };
}

export async function toInquiryView(admin: SupabaseClient, inquiry: InquiryRow, role: InquiryActor): Promise<InquiryView> {
  const kind = inquiryKind(inquiry);
  const [sender, counterparty] = await Promise.all([party(admin, "business", inquiry.sender_business_id), party(admin, kind, inquiryCounterpartyId(inquiry))]);
  return {
    id: inquiry.id,
    role,
    sender,
    counterparty,
    intent: inquiry.intent,
    status: inquiry.status,
    message: inquiry.message,
    conversationId: inquiry.conversation_id,
    createdAt: inquiry.created_at,
    statusChangedAt: inquiry.status_changed_at,
    findmiOnly: !inquiry.routed_entity_id,
    targetId: role === "sender" ? inquiry.target_id : null,
  };
}

/** One Inquiry as seen by one of the viewer's Businesses (sender or routed
 * counterparty); null when that Business is neither — never a partial view. */
export async function getInquiryForBusiness(admin: SupabaseClient, businessId: string, inquiryId: string): Promise<InquiryView | null> {
  if (!UUID.test(inquiryId)) return null;
  const inquiry = await readBy(admin, (q) => q.eq("id", inquiryId));
  if (!inquiry) return null;
  const role = inquiryActorForEntity(inquiry, { entityType: "business", entityId: businessId });
  return role ? toInquiryView(admin, inquiry, role) : null;
}

export async function getInquiryByConversation(admin: SupabaseClient, conversationId: string): Promise<InquiryRow | null> {
  return UUID.test(conversationId) ? readBy(admin, (q) => q.eq("conversation_id", conversationId)) : null;
}

export async function getInquiryRow(admin: SupabaseClient, inquiryId: string): Promise<InquiryRow | null> {
  return UUID.test(inquiryId) ? readBy(admin, (q) => q.eq("id", inquiryId)) : null;
}

/** The sender's Inquiries from one of its Targets, newest first (Target workspace). */
export async function getTargetInquiries(admin: SupabaseClient, businessId: string, targetId: string): Promise<{ id: string; intent: CommercialIntent; status: InquiryStatus; conversationId: string | null; createdAt: string }[]> {
  if (!UUID.test(targetId)) return [];
  const { data, error } = await admin
    .from("commercial_inquiries")
    .select("id, intent, status, conversation_id, created_at")
    .eq("sender_business_id", businessId)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return ((data ?? []) as { id: string; intent: CommercialIntent; status: InquiryStatus; conversation_id: string | null; created_at: string }[]).map((r) => ({ id: r.id, intent: r.intent, status: r.status, conversationId: r.conversation_id, createdAt: r.created_at }));
}

/** Home → Requests: Inquiries routed to THIS Business still awaiting its
 * first response (Sent). One bounded read. */
export async function getInboundInquiryRequests(admin: SupabaseClient, businessId: string): Promise<{ id: string; senderName: string; intent: CommercialIntent; counterpartyName: string | null; createdAt: string }[]> {
  const { data, error } = await admin
    .from("commercial_inquiries")
    .select("id, intent, created_at, counterparty_location_id, counterparty_event_id, sender:businesses!commercial_inquiries_sender_business_id_fkey(name), location:locations(name), event:events(name)")
    .eq("routed_entity_type", "business")
    .eq("routed_entity_id", businessId)
    .eq("status", "sent")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return [];
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  type R = { id: string; intent: CommercialIntent; created_at: string; sender: { name: string } | { name: string }[] | null; location: { name: string } | { name: string }[] | null; event: { name: string } | { name: string }[] | null };
  return ((data ?? []) as unknown as R[]).map((r) => ({ id: r.id, senderName: one(r.sender)?.name ?? "A Business", intent: r.intent, counterpartyName: one(r.location)?.name ?? one(r.event)?.name ?? null, createdAt: r.created_at }));
}

/** Admin list — every Inquiry, newest first, bounded. */
export async function adminListInquiries(admin: SupabaseClient, status: InquiryStatus | null): Promise<(InquiryRow & { senderName: string; counterpartyName: string })[]> {
  let q = admin.from("commercial_inquiries").select(INQUIRY_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return [];
  const rows = (data ?? []) as InquiryRow[];
  const ids = (k: TargetKind) => [...new Set(rows.filter((r) => inquiryKind(r) === k).map(inquiryCounterpartyId))];
  const bizIds = [...new Set([...rows.map((r) => r.sender_business_id), ...ids("business")])];
  const [b, l, e] = await Promise.all([
    bizIds.length ? admin.from("businesses").select("id, name").in("id", bizIds) : Promise.resolve({ data: [] }),
    ids("location").length ? admin.from("locations").select("id, name").in("id", ids("location")) : Promise.resolve({ data: [] }),
    ids("event").length ? admin.from("events").select("id, name").in("id", ids("event")) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map<string, string>([...((b.data ?? []) as Row[]), ...((l.data ?? []) as Row[]), ...((e.data ?? []) as Row[])].map((r) => [r.id as string, r.name as string]));
  return rows.map((r) => ({ ...r, senderName: nameOf.get(r.sender_business_id) ?? "A Business", counterpartyName: nameOf.get(inquiryCounterpartyId(r)) ?? "—" }));
}
