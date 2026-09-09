import type { SupabaseClient } from "@supabase/supabase-js";

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
  entityType: "business" | "event",
  entityId: string
): Promise<void> {
  const spec = membersTableFor(entityType);
  if (!spec) return;
  const { data } = await admin.from(spec.table).select("user_id").eq(spec.column, entityId);
  for (const row of (data ?? []) as { user_id: string }[]) {
    await addParticipant(admin, conversationId, row.user_id, entityType, entityId);
  }
}

async function addMessage(
  admin: SupabaseClient,
  conversationId: string,
  senderParticipantId: string | null,
  kind: "note" | "system",
  body: string
): Promise<void> {
  await admin.from("conversation_messages").insert({
    conversation_id: conversationId,
    sender_participant_id: senderParticipantId,
    kind,
    body,
  });
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
    return { kind: "crossed", opportunity: resolved };
  }

  // Fresh Opportunity — conversation first (Opportunity.conversation_id is
  // nullable specifically so this ordering never needs a placeholder
  // subject_id: create the Opportunity, then the Conversation pointing AT
  // it via subject_id, then attach conversation_id back onto the
  // Opportunity).
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

  const { data: conversation } = await admin
    .from("conversations")
    .insert({ subject_type: "opportunity", subject_id: opportunity.id })
    .select("id")
    .single();
  const conversationId = (conversation as { id: string } | null)?.id ?? null;

  if (conversationId) {
    const { data: withConversation } = await admin
      .from("opportunities")
      .update({ conversation_id: conversationId })
      .eq("id", opportunity.id)
      .select("*")
      .single();
    if (withConversation) opportunity = withConversation as OpportunityRow;

    const counterpartEntityType: "event" | "business" = initiatorEntityType === "event" ? "business" : "event";
    const counterpartEntityId = counterpartEntityType === "business" ? businessId : eventId;
    const initiatorParticipantId = await addParticipant(admin, conversationId, initiatorUserId, initiatorEntityType, initiatorEntityId);
    await addEntityParticipants(admin, conversationId, counterpartEntityType, counterpartEntityId);

    if (note) {
      await addMessage(admin, conversationId, initiatorParticipantId, "note", note);
    }
  }

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
