import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountEmail, getEntityManagerEmails, dedupeEmails } from "@/lib/notifications/recipients";
import { sendProductNotification } from "@/lib/notifications/productNotify";

// Opportunities + Conversation Foundation V1 — the one shared module both
// the owner-facing Business Manager (account/business/actions.ts) and
// Event Manager (account/event/actions.ts) call into, so Organizer<->
// Business invite/apply/accept/decline is implemented exactly once rather
// than reimplemented per surface. Deliberately a plain lib module (no
// "use server", no auth of its own) — every export here takes an
// already-authorized admin/service-role SupabaseClient, same shape as
// lib/appearance-event-sync.ts and lib/market-requests.ts. Callers are
// responsible for requireBusinessMember()/requireEventMember() BEFORE
// calling anything here; this file never re-derives authorization itself.
//
// ARCHITECTURAL INVARIANT (see the Communication Foundation Audit this
// pass implements):
//   Conversation = communication/history.
//   Opportunity  = structured workflow/decision.
//   event_businesses / event_occurrence_businesses = canonical Event<->
//     Business participation state — never duplicated, only synced TO.
//   appearances = canonical Where You'll Be schedule — never created by
//     an Opportunity directly; only ensureEventAppearance/cancelEventAppearance
//     (admin/(protected)/events/actions.ts) touch it, exactly as before
//     this pass, called from the SAME places that already resolve
//     canonical participation to 'approved'/other.

export type OpportunityType = "event_invitation" | "event_application";
export type OpportunityStatus = "pending" | "accepted" | "declined" | "withdrawn" | "superseded";
export type ConversationEntityType = "business" | "event" | "location" | "personal";

export interface OpportunityRow {
  id: string;
  type: OpportunityType;
  event_id: string;
  event_occurrence_id: string | null;
  business_id: string;
  initiator_user_id: string;
  initiator_entity_type: "event" | "business";
  initiator_entity_id: string;
  status: OpportunityStatus;
  conversation_id: string | null;
  created_at: string;
  responded_at: string | null;
  updated_at: string;
}

interface EntityMembersTable {
  table: "business_members" | "event_members" | "location_members";
  column: "business_id" | "event_id" | "location_id";
}

function membersTableFor(entityType: ConversationEntityType): EntityMembersTable | null {
  if (entityType === "business") return { table: "business_members", column: "business_id" };
  if (entityType === "event") return { table: "event_members", column: "event_id" };
  if (entityType === "location") return { table: "location_members", column: "location_id" };
  return null; // "personal" has no membership table — a single explicit participant only.
}

/** Adds one participant row (idempotent via ignoreDuplicates — the table's
 * own UNIQUE NULLS NOT DISTINCT constraint is the real guard). Returns the
 * participant's id either way (existing or newly inserted). */
async function addParticipant(
  admin: SupabaseClient,
  conversationId: string,
  userId: string,
  entityType: ConversationEntityType,
  entityId: string | null
): Promise<string | null> {
  await admin
    .from("conversation_participants")
    .upsert(
      { conversation_id: conversationId, user_id: userId, entity_type: entityType, entity_id: entityId },
      { onConflict: "conversation_id,user_id,entity_type,entity_id", ignoreDuplicates: true }
    );
  let query = admin
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("entity_type", entityType);
  // .is() (not .eq()) is required for a literal NULL comparison — entityId
  // is null only for a "personal" participant.
  query = entityId === null ? query.is("entity_id", null) : query.eq("entity_id", entityId);
  const { data } = await query.maybeSingle();
  return data?.id ?? null;
}

/** Adds a participant row for EVERY current member of an entity (all of a
 * Business's business_members, or an Event's event_members) — the
 * "account may manage multiple entities, multiple accounts may manage one
 * entity" model means a Conversation about "the Business" belongs to
 * every current owner/manager/staff of that Business, not just whichever
 * one happens to act first. Membership is re-derived fresh from the
 * existing *_members tables (never a second identity system) — see this
 * pass's own audit conclusion. */
async function addEntityParticipants(
  admin: SupabaseClient,
  conversationId: string,
  entityType: "business" | "event" | "location",
  entityId: string
): Promise<void> {
  const spec = membersTableFor(entityType);
  if (!spec) return;
  const { data } = await admin.from(spec.table).select("user_id").eq(spec.column, entityId);
  for (const row of (data ?? []) as { user_id: string }[]) {
    await addParticipant(admin, conversationId, row.user_id, entityType, entityId);
  }
}

export type MessageKind = "note" | "system" | "text";

async function addMessage(
  admin: SupabaseClient,
  conversationId: string,
  senderParticipantId: string | null,
  kind: MessageKind,
  body: string
): Promise<void> {
  await admin.from("conversation_messages").insert({
    conversation_id: conversationId,
    sender_participant_id: senderParticipantId,
    kind,
    body,
  });
}

// ── Public Messaging V1 — plain (non-Opportunity) Conversations ─────────
//
// A Conversation between two entity identities (Business<->Event,
// Business<->Business, Business<->Location) with no structured workflow
// attached — Section 8/9/10's "first true peer-to-peer messaging." Reuses
// every primitive above (addParticipant/addEntityParticipants/addMessage)
// rather than a second parallel data path — a plain Conversation and an
// Opportunity's Conversation are the exact same `conversations` row shape,
// just optionally with an opportunities row pointing at it too (see
// createOpportunity's own conversation-reuse branch below, added by this
// same pass).

export interface ConversationParty {
  entityType: ConversationEntityType;
  /** null only for "personal" (a single explicit user, no membership
   * table) — every other entityType requires a real id. */
  entityId: string | null;
}

async function addPartyParticipants(
  admin: SupabaseClient,
  conversationId: string,
  party: ConversationParty,
  actingUserId: string | null
): Promise<void> {
  if (party.entityType === "personal") {
    if (actingUserId) await addParticipant(admin, conversationId, actingUserId, "personal", null);
    return;
  }
  if (!party.entityId) return;
  await addEntityParticipants(admin, conversationId, party.entityType, party.entityId);
}

/** Conversation reuse rule (Section 7) — a Conversation belongs to
 * whichever two entity identities are its participants, so "does a
 * Conversation already exist for this Business<->Event (or
 * Business<->Business, Business<->Location) pair" is answered purely from
 * conversation_participants, never from subject_type/subject_id (which
 * only describes ONE conversation, created by ONE particular action — see
 * getOrCreateConversation). This deliberately finds ANY existing
 * Conversation between the pair regardless of whether it originated from
 * a plain message or an Opportunity, so structured actions and freeform
 * messages always land in the same thread (Section 9's own requirement).
 * Most-recently-created match wins when more than one exists (e.g. two
 * separate per-occurrence Opportunities with the same Event). */
async function findConversationByEntityPair(
  admin: SupabaseClient,
  partyA: ConversationParty,
  partyB: ConversationParty
): Promise<string | null> {
  let aQuery = admin.from("conversation_participants").select("conversation_id").eq("entity_type", partyA.entityType);
  aQuery = partyA.entityId === null ? aQuery.is("entity_id", null) : aQuery.eq("entity_id", partyA.entityId);
  const { data: aRows } = await aQuery;
  const aIds = [...new Set((aRows ?? []).map((r) => (r as { conversation_id: string }).conversation_id))];
  if (aIds.length === 0) return null;

  let bQuery = admin
    .from("conversation_participants")
    .select("conversation_id")
    .in("conversation_id", aIds)
    .eq("entity_type", partyB.entityType);
  bQuery = partyB.entityId === null ? bQuery.is("entity_id", null) : bQuery.eq("entity_id", partyB.entityId);
  const { data: bRows } = await bQuery;
  const matches = (bRows ?? []) as { conversation_id: string }[];
  if (matches.length === 0) return null;

  const { data: mostRecent } = await admin
    .from("conversations")
    .select("id")
    .in("id", [...new Set(matches.map((r) => r.conversation_id))])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (mostRecent as { id: string } | null)?.id ?? null;
}

/** Finds-or-creates the one Conversation between two entity identities.
 * `subjectType`/`subjectId` only matter for a brand-new row (conversations.
 * subject_id is NOT NULL) — reuse never touches them. Defensively re-adds
 * both parties' CURRENT members on every call (not just at creation), so a
 * newly-added manager on either side is a participant in an already-
 * existing thread the next time anyone sends into it. */
export async function getOrCreateConversation(
  admin: SupabaseClient,
  params: {
    subjectType: string;
    subjectId: string;
    partyA: ConversationParty;
    partyB: ConversationParty;
    actingUserId: string;
  }
): Promise<{ id: string; created: boolean }> {
  const existing = await findConversationByEntityPair(admin, params.partyA, params.partyB);
  if (existing) {
    await addPartyParticipants(admin, existing, params.partyA, params.actingUserId);
    await addPartyParticipants(admin, existing, params.partyB, params.actingUserId);
    return { id: existing, created: false };
  }

  const { data: conversation, error } = await admin
    .from("conversations")
    .insert({ subject_type: params.subjectType, subject_id: params.subjectId })
    .select("id")
    .single();
  if (error || !conversation) throw new Error(error?.message ?? "Could not create conversation.");
  const conversationId = (conversation as { id: string }).id;

  await addPartyParticipants(admin, conversationId, params.partyA, params.actingUserId);
  await addPartyParticipants(admin, conversationId, params.partyB, params.actingUserId);
  return { id: conversationId, created: true };
}

const ENTITY_TABLE: Record<"business" | "event" | "location", "businesses" | "events" | "locations"> = {
  business: "businesses",
  event: "events",
  location: "locations",
};
const ENTITY_LABEL: Record<"business" | "event" | "location", string> = {
  business: "Business",
  event: "Event",
  location: "Venue",
};

async function getEntityDisplayName(
  admin: SupabaseClient,
  entityType: ConversationEntityType,
  entityId: string | null
): Promise<string> {
  if (entityType === "personal" || !entityId) return "A Findmi member";
  const { data } = await admin.from(ENTITY_TABLE[entityType]).select("name").eq("id", entityId).maybeSingle();
  return (data as { name: string } | null)?.name ?? ENTITY_LABEL[entityType];
}

/** New-message notification — Resend Transactional Notification System
 * pass. Every OTHER current participant on this conversation (never the
 * sender), resolved straight from conversation_participants itself — the
 * exact same live recipient set isAuthorizedForConversation already uses
 * to decide who can even read the thread, so "who gets notified" can
 * never drift from "who can actually see this message." This is the
 * ONE place a text message is ever inserted (sendTextMessage below is
 * this file's only caller of addMessage for kind "text"), so a brand-new
 * conversation's first message and a later reply both funnel through
 * here exactly once — never a second, separate "conversation created"
 * email that would double up on the very first message. */
async function notifyNewMessage(
  admin: SupabaseClient,
  conversationId: string,
  senderUserId: string,
  senderEntityType: ConversationEntityType,
  senderEntityId: string | null,
  body: string
): Promise<void> {
  const { data } = await admin.from("conversation_participants").select("user_id").eq("conversation_id", conversationId);
  const recipientUserIds = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))].filter(
    (id) => id !== senderUserId
  );
  if (recipientUserIds.length === 0) return;
  const emails = await Promise.all(recipientUserIds.map((id) => getAccountEmail(admin, id)));
  const to = dedupeEmails(emails);
  if (to.length === 0) return;

  const senderName = await getEntityDisplayName(admin, senderEntityType, senderEntityId);
  const preview = body.length > 160 ? `${body.slice(0, 157)}...` : body;

  await sendProductNotification({
    to,
    type: "message_new",
    subject: `New message from ${senderName} on Findmi`,
    heading: `New message from ${senderName}`,
    body: [`"${preview}"`],
    actionLabel: "Reply on Findmi",
    actionUrl: `/account/messages/${conversationId}`,
  });
}

/** Sends one freeform text reply — the reply composer's only entry point.
 * The caller is responsible for authorization (current membership of
 * senderEntityType/senderEntityId, or "personal" + a real session) BEFORE
 * calling this, same discipline as every other export in this file; this
 * never re-derives it. Content lives ONLY as a conversation_messages row —
 * never duplicated onto any Opportunity. */
export async function sendTextMessage(
  admin: SupabaseClient,
  conversationId: string,
  senderUserId: string,
  senderEntityType: ConversationEntityType,
  senderEntityId: string | null,
  body: string
): Promise<void> {
  const participantId = await addParticipant(admin, conversationId, senderUserId, senderEntityType, senderEntityId);
  await addMessage(admin, conversationId, participantId, "text", body);
  await notifyNewMessage(admin, conversationId, senderUserId, senderEntityType, senderEntityId, body);
}

/** Entity-aware identity, re-derived live (Section 14) — never trusts a
 * stored conversation_participants row as authorization on its own. A
 * user is authorized to read a Conversation if EITHER (a) they're the
 * user_id on a "personal" participant row, OR (b) they currently hold a
 * *_members row for any entity_type/entity_id that appears as a
 * participant — regardless of which user originally added that
 * participant row (entity-level access, not row-level: a newly-added
 * manager gets full history, a removed one loses access even though their
 * old participant row still exists). */
export async function isAuthorizedForConversation(admin: SupabaseClient, conversationId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("conversation_participants")
    .select("entity_type, entity_id, user_id")
    .eq("conversation_id", conversationId);
  const rows = (data ?? []) as { entity_type: ConversationEntityType; entity_id: string | null; user_id: string }[];

  const seen = new Set<string>();
  for (const row of rows) {
    if (row.entity_type === "personal") {
      if (row.user_id === userId) return true;
      continue;
    }
    if (!row.entity_id) continue;
    const key = `${row.entity_type}:${row.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = membersTableFor(row.entity_type);
    if (!spec) continue;
    const { data: membership } = await admin.from(spec.table).select("id").eq("user_id", userId).eq(spec.column, row.entity_id).maybeSingle();
    if (membership) return true;
  }
  return false;
}

/** Every entity (Business/Event/Location) the given user currently
 * manages — the acting-identity selector's data source everywhere a
 * public page's "Message"/"Apply"/"Invite" flow needs to know who this
 * visitor can act as. Deliberately takes userId explicitly (unlike every
 * OTHER export in this file, which take an already-authorized admin
 * client and infer nothing about "whose" data it is) since there's no
 * single entityId to authorize against here — the caller already knows
 * userId from its own session check. */
export async function getUserManagedEntities(
  admin: SupabaseClient,
  userId: string
): Promise<{
  businesses: { id: string; name: string }[];
  events: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}> {
  const [{ data: b }, { data: e }, { data: l }] = await Promise.all([
    admin.from("business_members").select("business_id, businesses(name)").eq("user_id", userId),
    admin.from("event_members").select("event_id, events(name)").eq("user_id", userId),
    admin.from("location_members").select("location_id, locations(name)").eq("user_id", userId),
  ]);
  type Row<K extends string> = Record<K, string> & Record<string, { name: string } | { name: string }[] | null>;
  const businesses = ((b ?? []) as Row<"business_id">[])
    .map((r) => ({ id: r.business_id, name: one(r.businesses as { name: string } | { name: string }[] | null)?.name }))
    .filter((r): r is { id: string; name: string } => Boolean(r.name));
  const events = ((e ?? []) as Row<"event_id">[])
    .map((r) => ({ id: r.event_id, name: one(r.events as { name: string } | { name: string }[] | null)?.name }))
    .filter((r): r is { id: string; name: string } => Boolean(r.name));
  const locations = ((l ?? []) as Row<"location_id">[])
    .map((r) => ({ id: r.location_id, name: one(r.locations as { name: string } | { name: string }[] | null)?.name }))
    .filter((r): r is { id: string; name: string } => Boolean(r.name));
  return { businesses, events, locations };
}

/** Freshly-created invitation/application notification — Resend
 * Transactional Notification System pass. Notifies the COUNTERPART side
 * (never the initiator, who already knows they just acted): an
 * organizer's invitation goes to the invited Business's managers, a
 * business's application goes to the Event's managers. */
async function notifyOpportunityCreated(admin: SupabaseClient, opportunity: OpportunityRow): Promise<void> {
  const [{ data: event }, { data: business }] = await Promise.all([
    admin.from("events").select("name").eq("id", opportunity.event_id).maybeSingle(),
    admin.from("businesses").select("name").eq("id", opportunity.business_id).maybeSingle(),
  ]);
  const eventName = (event as { name: string } | null)?.name ?? "an Event";
  const businessName = (business as { name: string } | null)?.name ?? "a Business";
  const conversationUrl = opportunity.conversation_id ? `/account/messages/${opportunity.conversation_id}` : null;

  if (opportunity.type === "event_invitation") {
    // Actor Awareness — never notify the initiator (the organizer who
    // just sent this invitation) even if they also happen to manage the
    // invited Business.
    const to = await getEntityManagerEmails(admin, "business", opportunity.business_id, opportunity.initiator_user_id);
    await sendProductNotification({
      to,
      type: "opportunity_invitation",
      subject: `${eventName} invited you to participate`,
      heading: `${eventName} invited your business to participate`,
      body: [`${eventName} invited ${businessName} to participate. Review the invitation and respond on Findmi.`],
      actionLabel: "Review Invitation",
      actionUrl: conversationUrl ?? `/account/business/${opportunity.business_id}?tab=opportunities`,
    });
  } else {
    const to = await getEntityManagerEmails(admin, "event", opportunity.event_id, opportunity.initiator_user_id);
    await sendProductNotification({
      to,
      type: "opportunity_application",
      subject: `${businessName} applied to ${eventName}`,
      heading: `${businessName} applied to your Event`,
      body: [`${businessName} applied to participate in ${eventName}. Review the application and respond on Findmi.`],
      actionLabel: "Review Application",
      actionUrl: conversationUrl ?? `/account/event/${opportunity.event_id}?tab=participants`,
    });
  }
}

/** Terminal-decision notification — the side that DIDN'T just act. An
 * invitation resolved (accepted/declined) means the Business just
 * responded, so the Event's managers are notified; an application
 * resolved means the organizer just decided, so the Business's managers
 * are notified. Also the single notification point for a "crossed"
 * Opportunity resolution (createOpportunity's own crossing branch calls
 * this directly on the now-accepted EXISTING opportunity) — reusing this
 * exact function there means the crossing case gets the identical
 * correct-recipient, correct-copy, no-duplicate final-state email as a
 * normal accept/decline, with no separate bespoke code path (Section:
 * "one useful notification, not duplicate contradictory sends"). No-ops
 * for any status other than accepted/declined (withdrawn/superseded
 * aren't user-facing decisions worth emailing about). */
async function notifyOpportunityResolved(admin: SupabaseClient, opportunity: OpportunityRow): Promise<void> {
  if (opportunity.status !== "accepted" && opportunity.status !== "declined") return;
  const [{ data: event }, { data: business }] = await Promise.all([
    admin.from("events").select("name").eq("id", opportunity.event_id).maybeSingle(),
    admin.from("businesses").select("name").eq("id", opportunity.business_id).maybeSingle(),
  ]);
  const eventName = (event as { name: string } | null)?.name ?? "the Event";
  const businessName = (business as { name: string } | null)?.name ?? "the Business";
  const accepted = opportunity.status === "accepted";

  if (opportunity.type === "event_invitation") {
    // The Business responded to the organizer's invite -> Event managers.
    const to = await getEntityManagerEmails(admin, "event", opportunity.event_id);
    await sendProductNotification({
      to,
      type: `opportunity_invitation_${opportunity.status}`,
      subject: accepted ? `${businessName} confirmed for ${eventName}` : `${businessName} declined your invitation`,
      heading: accepted ? `${businessName} is confirmed for ${eventName}` : `${businessName} declined your invitation`,
      body: [
        accepted
          ? `${businessName} accepted your invitation and is now confirmed for ${eventName}.`
          : `${businessName} declined your invitation to ${eventName}.`,
      ],
      actionLabel: "View Event",
      actionUrl: `/account/event/${opportunity.event_id}?tab=participants`,
    });
  } else {
    // The organizer responded to the Business's application -> Business managers.
    const to = await getEntityManagerEmails(admin, "business", opportunity.business_id);
    await sendProductNotification({
      to,
      type: `opportunity_application_${opportunity.status}`,
      subject: accepted ? `You're confirmed for ${eventName}` : `Update on your application to ${eventName}`,
      heading: accepted ? `You're confirmed for ${eventName}` : `Your application to ${eventName} was declined`,
      body: [
        accepted
          ? `Your application to participate in ${eventName} was approved — you're now confirmed.`
          : `Your application to participate in ${eventName} wasn't approved this time.`,
      ],
      actionLabel: "View Business",
      actionUrl: `/account/business/${opportunity.business_id}?tab=opportunities`,
    });
  }
}

export interface CreateOpportunityInput {
  type: OpportunityType;
  eventId: string;
  eventOccurrenceId: string | null;
  businessId: string;
  initiatorUserId: string;
  initiatorEntityType: "event" | "business";
  initiatorEntityId: string;
  /** Optional initial note — stored ONLY as a conversation_messages row,
   * never duplicated onto the Opportunity row itself (task's own explicit
   * "avoid duplicated message content" requirement). */
  note?: string | null;
}

export type CreateOpportunityOutcome =
  | { kind: "already_participating" }
  | { kind: "reused_pending"; opportunity: OpportunityRow }
  | { kind: "crossed"; opportunity: OpportunityRow }
  | { kind: "created"; opportunity: OpportunityRow };

/** The one entry point for both "organizer invites" and "business
 * applies." Handles every duplicate/crossing rule from this pass's own
 * spec:
 *   - Business already approved on this exact context -> no Opportunity
 *     created at all ("already_participating").
 *   - An identical-type pending Opportunity already exists for this exact
 *     context -> reused as-is, no duplicate row ("reused_pending").
 *   - An OPPOSITE-type pending Opportunity exists (an invite crossing an
 *     application, or vice versa) -> mutual intent now exists; the old
 *     Opportunity is resolved to 'accepted' and this call reports
 *     "crossed" so the caller immediately moves canonical participation to
 *     'approved' and runs the existing Appearance sync ONCE — never two
 *     independently-actionable pending Opportunities for one context.
 *   - Otherwise -> a fresh Conversation + participants (both sides' every
 *     CURRENT member — see addEntityParticipants) + the Opportunity row,
 *     plus one 'note' message if a note was supplied.
 * Never touches event_businesses/event_occurrence_businesses or
 * appearances itself — the caller does that, using the same existing
 * roster/appearance functions as before this pass, based on this
 * function's returned `kind`. */
export async function createOpportunity(
  admin: SupabaseClient,
  input: CreateOpportunityInput
): Promise<CreateOpportunityOutcome> {
  const { type, eventId, eventOccurrenceId, businessId, initiatorUserId, initiatorEntityType, initiatorEntityId, note } = input;

  const participationTable = eventOccurrenceId ? "event_occurrence_businesses" : "event_businesses";
  const participationMatch = eventOccurrenceId ? { occurrence_id: eventOccurrenceId, business_id: businessId } : { event_id: eventId, business_id: businessId };
  const { data: currentParticipation } = await admin
    .from(participationTable)
    .select("status")
    .match(participationMatch)
    .maybeSingle();
  if ((currentParticipation as { status: string } | null)?.status === "approved") {
    return { kind: "already_participating" };
  }

  let pendingQuery = admin
    .from("opportunities")
    .select("*")
    .eq("event_id", eventId)
    .eq("business_id", businessId)
    .eq("status", "pending");
  pendingQuery = eventOccurrenceId ? pendingQuery.eq("event_occurrence_id", eventOccurrenceId) : pendingQuery.is("event_occurrence_id", null);
  const { data: existing } = await pendingQuery.maybeSingle();

  if (existing) {
    const existingRow = existing as OpportunityRow;
    if (existingRow.type === type) {
      return { kind: "reused_pending", opportunity: existingRow };
    }

    // Crossing: the other side already initiated the opposite workflow —
    // mutual intent exists now. Resolve the OLD Opportunity rather than
    // leaving two live pending rows for the same context.
    const { data: updated } = await admin
      .from("opportunities")
      .update({ status: "accepted", responded_at: new Date().toISOString() })
      .eq("id", existingRow.id)
      .select("*")
      .single();
    const resolved = (updated ?? existingRow) as OpportunityRow;
    if (resolved.conversation_id) {
      if (note) {
        const participantId = await addParticipant(admin, resolved.conversation_id, initiatorUserId, initiatorEntityType, initiatorEntityId);
        await addMessage(admin, resolved.conversation_id, participantId, "note", note);
      }
      const crossedLabel = existingRow.type === "event_invitation" ? "invitation" : "application";
      await addMessage(admin, resolved.conversation_id, null, "system", `Matched an existing ${crossedLabel} — participation confirmed.`);
    }
    await notifyOpportunityResolved(admin, resolved);
    return { kind: "crossed", opportunity: resolved };
  }

  // Fresh Opportunity.
  const { data: created, error: createError } = await admin
    .from("opportunities")
    .insert({
      type,
      event_id: eventId,
      event_occurrence_id: eventOccurrenceId,
      business_id: businessId,
      initiator_user_id: initiatorUserId,
      initiator_entity_type: initiatorEntityType,
      initiator_entity_id: initiatorEntityId,
      status: "pending",
    })
    .select("*")
    .single();
  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not create Opportunity.");
  }
  let opportunity = created as OpportunityRow;

  const counterpartEntityType: "event" | "business" = initiatorEntityType === "event" ? "business" : "event";
  const counterpartEntityId = counterpartEntityType === "business" ? businessId : eventId;

  // Conversation: reuse (Section 7 — "Opportunity may attach to an
  // existing Conversation") if a plain or prior-Opportunity Conversation
  // already exists between these exact two entity identities; otherwise
  // create a fresh one, subject_type='opportunity' pointing at THIS
  // Opportunity (Opportunity.conversation_id is nullable specifically so
  // this ordering never needs a placeholder subject_id: create the
  // Opportunity, then the Conversation, then attach conversation_id back
  // onto the Opportunity).
  const initiatorParty: ConversationParty = { entityType: initiatorEntityType, entityId: initiatorEntityId };
  const counterpartParty: ConversationParty = { entityType: counterpartEntityType, entityId: counterpartEntityId };
  const reused = await findConversationByEntityPair(admin, initiatorParty, counterpartParty);
  let conversationId = reused;
  if (!conversationId) {
    const { data: conversation } = await admin
      .from("conversations")
      .insert({ subject_type: "opportunity", subject_id: opportunity.id })
      .select("id")
      .single();
    conversationId = (conversation as { id: string } | null)?.id ?? null;
  }

  if (conversationId) {
    const { data: withConversation } = await admin
      .from("opportunities")
      .update({ conversation_id: conversationId })
      .eq("id", opportunity.id)
      .select("*")
      .single();
    if (withConversation) opportunity = withConversation as OpportunityRow;

    const initiatorParticipantId = await addParticipant(admin, conversationId, initiatorUserId, initiatorEntityType, initiatorEntityId);
    await addEntityParticipants(admin, conversationId, counterpartEntityType, counterpartEntityId);

    const kindLabel = type === "event_invitation" ? "an invitation" : "an application";
    if (reused) {
      await addMessage(admin, conversationId, null, "system", `Sent ${kindLabel}.`);
    }
    if (note) {
      await addMessage(admin, conversationId, initiatorParticipantId, "note", note);
    }
  }

  await notifyOpportunityCreated(admin, opportunity);
  return { kind: "created", opportunity };
}

/** Resolves a still-pending Opportunity to a terminal status (accepted/
 * declined/withdrawn) and records a plain system message — the caller is
 * responsible for the matching canonical-participation update and any
 * Appearance sync, exactly as every existing status-change action already
 * does; this only ever touches the opportunities/conversation_messages
 * rows. Returns null (no-op) if the Opportunity is missing or already
 * resolved, so a stale page/duplicate click is always safe. */
export async function resolveOpportunity(
  admin: SupabaseClient,
  opportunityId: string,
  status: Exclude<OpportunityStatus, "pending">,
  systemMessage?: string
): Promise<OpportunityRow | null> {
  const { data: updated } = await admin
    .from("opportunities")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("id", opportunityId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (!updated) return null;
  const row = updated as OpportunityRow;
  if (row.conversation_id && systemMessage) {
    await addMessage(admin, row.conversation_id, null, "system", systemMessage);
  }
  await notifyOpportunityResolved(admin, row);
  return row;
}

/** Same as resolveOpportunity, but resolves BY CONTEXT (event/occurrence/
 * business, optionally scoped to one `type`) instead of a known
 * opportunity id — used by the organizer's existing approve/decline
 * action (updateParticipatingBusinessStatus), whose own signature this
 * pass deliberately does not change (no opportunityId is threaded through
 * that UI). `type` is left unscoped by default because that one existing
 * action already legitimately resolves EITHER an application ("approve
 * this business that applied") OR the organizer's own outstanding
 * invitation (its Approve/Decline buttons already show for status
 * 'invited' too, letting an organizer force-resolve their own invite
 * without waiting on the business) — the partial unique index guarantees
 * at most one pending row of either type exists for a given context, so
 * there is never an ambiguous match to resolve. No-op if no matching
 * pending row exists — never an error, since not every status change
 * originates from an Opportunity (e.g. a direct admin add predating this
 * pass). */
export async function resolveOpportunityByContext(
  admin: SupabaseClient,
  context: { eventId: string; eventOccurrenceId: string | null; businessId: string; type?: OpportunityType },
  status: Exclude<OpportunityStatus, "pending">,
  systemMessage?: string
): Promise<OpportunityRow | null> {
  let query = admin
    .from("opportunities")
    .select("id")
    .eq("event_id", context.eventId)
    .eq("business_id", context.businessId);
  if (context.type) query = query.eq("type", context.type);
  query = query
    .eq("status", "pending");
  query = context.eventOccurrenceId ? query.eq("event_occurrence_id", context.eventOccurrenceId) : query.is("event_occurrence_id", null);
  const { data: existing } = await query.maybeSingle();
  if (!existing) return null;
  return resolveOpportunity(admin, existing.id as string, status, systemMessage);
}

// ── Read helpers ─────────────────────────────────────────────────────────

export interface OpportunityListItem {
  id: string;
  type: OpportunityType;
  status: OpportunityStatus;
  eventId: string;
  eventName: string;
  eventSlug: string;
  eventOccurrenceId: string | null;
  occurrenceStartAt: string | null;
  occurrenceLocationName: string | null;
  businessId: string;
  businessName: string;
  note: string | null;
  createdAt: string;
  respondedAt: string | null;
}

type OpportunityJoinRow = OpportunityRow & {
  events: { name: string; slug: string } | { name: string; slug: string }[] | null;
  event_occurrences: { start_at: string; locations: { name: string } | { name: string }[] | null } | { start_at: string; locations: { name: string } | { name: string }[] | null }[] | null;
  businesses: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function notesByOpportunity(admin: SupabaseClient, conversationIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (conversationIds.length === 0) return map;
  const { data } = await admin
    .from("conversation_messages")
    .select("conversation_id, body, created_at")
    .in("conversation_id", conversationIds)
    .eq("kind", "note")
    .order("created_at", { ascending: true });
  for (const row of (data ?? []) as { conversation_id: string; body: string }[]) {
    if (!map.has(row.conversation_id)) map.set(row.conversation_id, row.body);
  }
  return map;
}

function toListItem(row: OpportunityJoinRow, noteByConversation: Map<string, string>): OpportunityListItem {
  const event = one(row.events);
  const occurrence = one(row.event_occurrences);
  const business = one(row.businesses);
  const occurrenceLocation = occurrence ? one(occurrence.locations) : null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    eventId: row.event_id,
    eventName: event?.name ?? "Unknown event",
    eventSlug: event?.slug ?? "",
    eventOccurrenceId: row.event_occurrence_id,
    occurrenceStartAt: occurrence?.start_at ?? null,
    occurrenceLocationName: occurrenceLocation?.name ?? null,
    businessId: row.business_id,
    businessName: business?.name ?? "Unknown business",
    note: row.conversation_id ? (noteByConversation.get(row.conversation_id) ?? null) : null,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

/** Business-side "Event Invitations" — pending invitations targeting this
 * Business only (the surface the Communication Foundation Audit found
 * completely missing before this pass). */
export async function getPendingInvitationsForBusiness(admin: SupabaseClient, businessId: string): Promise<OpportunityListItem[]> {
  const { data } = await admin
    .from("opportunities")
    .select("*, events(name, slug), event_occurrences(start_at, locations(name)), businesses(name)")
    .eq("business_id", businessId)
    .eq("type", "event_invitation")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as OpportunityJoinRow[];
  const notes = await notesByOpportunity(admin, rows.map((r) => r.conversation_id).filter((v): v is string => Boolean(v)));
  return rows.map((r) => toListItem(r, notes));
}

/** Business-side "My Applications" — every application this Business has
 * initiated, any status, most recent first. */
export async function getApplicationsForBusiness(admin: SupabaseClient, businessId: string): Promise<OpportunityListItem[]> {
  const { data } = await admin
    .from("opportunities")
    .select("*, events(name, slug), event_occurrences(start_at, locations(name)), businesses(name)")
    .eq("business_id", businessId)
    .eq("type", "event_application")
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as OpportunityJoinRow[];
  const notes = await notesByOpportunity(admin, rows.map((r) => r.conversation_id).filter((v): v is string => Boolean(v)));
  return rows.map((r) => toListItem(r, notes));
}

// ── Public Messaging V1 — Conversation thread + Messages list ───────────

async function labelsForParticipants(
  admin: SupabaseClient,
  participants: { entity_type: ConversationEntityType; entity_id: string | null; user_id: string }[]
): Promise<Map<string, string>> {
  const businessIds = [...new Set(participants.filter((p) => p.entity_type === "business" && p.entity_id).map((p) => p.entity_id as string))];
  const eventIds = [...new Set(participants.filter((p) => p.entity_type === "event" && p.entity_id).map((p) => p.entity_id as string))];
  const locationIds = [...new Set(participants.filter((p) => p.entity_type === "location" && p.entity_id).map((p) => p.entity_id as string))];
  const personalUserIds = [...new Set(participants.filter((p) => p.entity_type === "personal").map((p) => p.user_id))];

  const [businesses, events, locations, profiles] = await Promise.all([
    businessIds.length ? admin.from("businesses").select("id, name").in("id", businessIds) : Promise.resolve({ data: [] }),
    eventIds.length ? admin.from("events").select("id, name").in("id", eventIds) : Promise.resolve({ data: [] }),
    locationIds.length ? admin.from("locations").select("id, name").in("id", locationIds) : Promise.resolve({ data: [] }),
    personalUserIds.length ? admin.from("profiles").select("id, display_name").in("id", personalUserIds) : Promise.resolve({ data: [] }),
  ]);
  const map = new Map<string, string>();
  for (const b of (businesses.data ?? []) as { id: string; name: string }[]) map.set(`business:${b.id}`, b.name);
  for (const e of (events.data ?? []) as { id: string; name: string }[]) map.set(`event:${e.id}`, e.name);
  for (const l of (locations.data ?? []) as { id: string; name: string }[]) map.set(`location:${l.id}`, l.name);
  for (const p of (profiles.data ?? []) as { id: string; display_name: string | null }[]) map.set(`personal:${p.id}`, p.display_name || "Findmi Member");
  return map;
}

function labelKey(entityType: ConversationEntityType, entityId: string | null, userId: string): string {
  return entityType === "personal" ? `personal:${userId}` : `${entityType}:${entityId}`;
}

export interface ConversationThreadParty {
  entityType: ConversationEntityType;
  entityId: string | null;
  label: string;
}

export interface ConversationMessageItem {
  id: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
  senderLabel: string | null;
  senderEntityType: ConversationEntityType | null;
  senderUserId: string | null;
}

export interface ConversationOpportunityCard {
  id: string;
  type: OpportunityType;
  status: OpportunityStatus;
  eventId: string;
  eventName: string;
  eventSlug: string;
  eventOccurrenceId: string | null;
  occurrenceStartAt: string | null;
  businessId: string;
  businessName: string;
  createdAt: string;
}

export interface ConversationThread {
  id: string;
  parties: ConversationThreadParty[];
  messages: ConversationMessageItem[];
  opportunityCards: ConversationOpportunityCard[];
}

/** The conversation thread view's one data source — chronological
 * messages (note/system/text all render, distinguished by `kind`) plus
 * every structured Opportunity attached to this Conversation, in creation
 * order. Returns null for a signed-in visitor with no CURRENT authorized
 * identity in this Conversation (see isAuthorizedForConversation) — the
 * caller treats that exactly like "not found," never a partial render. */
export async function getConversationThread(
  admin: SupabaseClient,
  conversationId: string,
  viewerUserId: string
): Promise<ConversationThread | null> {
  const authorized = await isAuthorizedForConversation(admin, conversationId, viewerUserId);
  if (!authorized) return null;

  const { data: participantRows } = await admin
    .from("conversation_participants")
    .select("id, entity_type, entity_id, user_id")
    .eq("conversation_id", conversationId);
  const participants = (participantRows ?? []) as { id: string; entity_type: ConversationEntityType; entity_id: string | null; user_id: string }[];
  const labels = await labelsForParticipants(admin, participants);

  const partiesMap = new Map<string, ConversationThreadParty>();
  for (const p of participants) {
    const key = labelKey(p.entity_type, p.entity_id, p.user_id);
    if (!partiesMap.has(key)) {
      partiesMap.set(key, {
        entityType: p.entity_type,
        entityId: p.entity_type === "personal" ? null : p.entity_id,
        label: labels.get(key) ?? "Findmi Member",
      });
    }
  }

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const { data: messageRows } = await admin
    .from("conversation_messages")
    .select("id, kind, body, created_at, sender_participant_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const messages: ConversationMessageItem[] = (
    (messageRows ?? []) as { id: string; kind: MessageKind; body: string; created_at: string; sender_participant_id: string | null }[]
  ).map((m) => {
    const sender = m.sender_participant_id ? participantById.get(m.sender_participant_id) : null;
    return {
      id: m.id,
      kind: m.kind,
      body: m.body,
      createdAt: m.created_at,
      senderLabel: sender ? (labels.get(labelKey(sender.entity_type, sender.entity_id, sender.user_id)) ?? null) : null,
      senderEntityType: sender?.entity_type ?? null,
      senderUserId: sender?.user_id ?? null,
    };
  });

  const { data: opportunityRows } = await admin
    .from("opportunities")
    .select("*, events(name, slug), event_occurrences(start_at), businesses(name)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const opportunityCards: ConversationOpportunityCard[] = ((opportunityRows ?? []) as unknown as OpportunityJoinRow[]).map((row) => {
    const event = one(row.events);
    const occurrence = one(row.event_occurrences);
    const business = one(row.businesses);
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      eventId: row.event_id,
      eventName: event?.name ?? "Unknown event",
      eventSlug: event?.slug ?? "",
      eventOccurrenceId: row.event_occurrence_id,
      occurrenceStartAt: occurrence?.start_at ?? null,
      businessId: row.business_id,
      businessName: business?.name ?? "Unknown business",
      createdAt: row.created_at,
    };
  });

  return { id: conversationId, parties: [...partiesMap.values()], messages, opportunityCards };
}

export interface ConversationListItem {
  id: string;
  otherPartyLabel: string;
  otherPartyEntityType: ConversationEntityType;
  lastMessageBody: string | null;
  lastActivityAt: string;
}

/** The Messages entry point's one data source — every Conversation the
 * user is currently authorized for (via any managed entity, or a
 * "personal" participant row of their own), newest activity first. Per
 * Section 11: no folders/search/unread count — just participant name,
 * last message preview, last activity timestamp. */
export async function listConversationsForUser(admin: SupabaseClient, userId: string): Promise<ConversationListItem[]> {
  const managed = await getUserManagedEntities(admin, userId);
  const businessIds = managed.businesses.map((b) => b.id);
  const eventIds = managed.events.map((e) => e.id);
  const locationIds = managed.locations.map((l) => l.id);

  const results: { data: { conversation_id: string }[] | null }[] = [
    await admin.from("conversation_participants").select("conversation_id").eq("entity_type", "personal").eq("user_id", userId),
  ];
  if (businessIds.length) results.push(await admin.from("conversation_participants").select("conversation_id").eq("entity_type", "business").in("entity_id", businessIds));
  if (eventIds.length) results.push(await admin.from("conversation_participants").select("conversation_id").eq("entity_type", "event").in("entity_id", eventIds));
  if (locationIds.length) results.push(await admin.from("conversation_participants").select("conversation_id").eq("entity_type", "location").in("entity_id", locationIds));

  const conversationIds = [...new Set(results.flatMap((r) => (r.data ?? []).map((row) => row.conversation_id)))];
  if (conversationIds.length === 0) return [];

  const [{ data: conversationRows }, { data: participantRows }, { data: messageRows }] = await Promise.all([
    admin.from("conversations").select("id, created_at").in("id", conversationIds),
    admin.from("conversation_participants").select("conversation_id, entity_type, entity_id, user_id").in("conversation_id", conversationIds),
    admin
      .from("conversation_messages")
      .select("conversation_id, body, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
  ]);

  const participants = (participantRows ?? []) as { conversation_id: string; entity_type: ConversationEntityType; entity_id: string | null; user_id: string }[];
  const labels = await labelsForParticipants(admin, participants);

  const myEntityKeys = new Set<string>([
    `personal:${userId}`,
    ...businessIds.map((id) => `business:${id}`),
    ...eventIds.map((id) => `event:${id}`),
    ...locationIds.map((id) => `location:${id}`),
  ]);

  const partiesByConversation = new Map<string, typeof participants>();
  for (const p of participants) {
    const list = partiesByConversation.get(p.conversation_id) ?? [];
    list.push(p);
    partiesByConversation.set(p.conversation_id, list);
  }

  const lastMessageByConversation = new Map<string, { body: string; created_at: string }>();
  for (const m of (messageRows ?? []) as { conversation_id: string; body: string; created_at: string }[]) {
    if (!lastMessageByConversation.has(m.conversation_id)) lastMessageByConversation.set(m.conversation_id, m);
  }
  const createdAtByConversation = new Map(((conversationRows ?? []) as { id: string; created_at: string }[]).map((c) => [c.id, c.created_at]));

  const items: ConversationListItem[] = [];
  for (const conversationId of conversationIds) {
    const parties = partiesByConversation.get(conversationId) ?? [];
    const other = parties.find((p) => !myEntityKeys.has(labelKey(p.entity_type, p.entity_id, p.user_id)));
    if (!other) continue;
    const last = lastMessageByConversation.get(conversationId) ?? null;
    items.push({
      id: conversationId,
      otherPartyLabel: labels.get(labelKey(other.entity_type, other.entity_id, other.user_id)) ?? "Findmi Member",
      otherPartyEntityType: other.entity_type,
      lastMessageBody: last?.body ?? null,
      lastActivityAt: last?.created_at ?? createdAtByConversation.get(conversationId) ?? new Date(0).toISOString(),
    });
  }

  items.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  return items;
}

/** Organizer-side note lookup for the existing Participants tab — keyed by
 * business_id, only for this Event's currently-pending applications, so
 * the existing roster list can show "optional initial note if present"
 * (this pass's own requirement) without restructuring that tab. */
export async function getPendingApplicationNotesForEvent(admin: SupabaseClient, eventId: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from("opportunities")
    .select("business_id, conversation_id")
    .eq("event_id", eventId)
    .eq("type", "event_application")
    .eq("status", "pending")
    .not("conversation_id", "is", null);
  const rows = (data ?? []) as { business_id: string; conversation_id: string }[];
  const notes = await notesByOpportunity(admin, rows.map((r) => r.conversation_id));
  const byBusiness = new Map<string, string>();
  for (const r of rows) {
    const note = notes.get(r.conversation_id);
    if (note) byBusiness.set(r.business_id, note);
  }
  return byBusiness;
}
