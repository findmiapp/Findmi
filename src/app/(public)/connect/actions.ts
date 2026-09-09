"use server";

// FINDMI — Public Messaging V1. The one shared Server Actions module every
// public-page "Connect" flow (Event page, Business page, Location page)
// calls into. Every action here follows the same authorize-then-elevate
// shape the rest of the codebase already uses (requireBusinessMember/
// requireEventMember/requireLocationMember first — real membership, never
// trusted from the client — THEN the service-role client for the actual
// write), plus the email-verification gate the Opportunities +
// Conversation Foundation already established (isEmailVerified).
//
// Deliberately NOT bound to <form action> + redirect() like the Manager-
// tab actions: these are invoked from a compact modal on a PUBLIC page
// (no existing tab to redirect back to on error), so each one returns a
// plain { conversationId } | { error } result and the calling client
// component navigates to /account/messages/[id] itself on success. The
// two structured-card resolve actions at the bottom (used from the
// Conversation thread page, which DOES have a natural page to redirect
// back to) keep the classic form + redirect() shape instead.
//
// Never duplicates the Opportunity workflow itself — every apply/invite/
// accept/decline path here calls straight into the exact same
// createOpportunity/resolveOpportunity/resolveOpportunityByContext +
// ensureEventAppearance/cancelEventAppearance functions the existing
// Business/Event Manager actions already use. Only the entry point (a
// public page instead of a Manager tab) and the redirect target are new.

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isEmailVerified, requireBusinessMember, requireEventMember, requireLocationMember } from "@/lib/permissions";
import {
  createOpportunity,
  getOrCreateConversation,
  isAuthorizedForConversation,
  resolveEventApplicationDecision,
  resolveOpportunity,
  resolveOpportunityByContext,
  sendTextMessage,
  type ConversationEntityType,
} from "@/lib/opportunities";
import { ensureEventAppearance, cancelEventAppearance } from "@/lib/appearance-event-sync";

type ActionResult = { conversationId: string } | { error: string };

/** Shared preamble every initiation action below starts with: a real
 * Supabase Auth session, email-verified (Section 1/5/14's own explicit
 * requirement), plus a working service-role client. Never re-derives
 * entity membership itself — each caller does that separately, scoped to
 * whichever specific entity it's acting as. */
async function requireVerifiedSender(): Promise<{ userId: string; admin: NonNullable<ReturnType<typeof getAdminSupabase>> } | { error: string }> {
  const admin = getAdminSupabase();
  if (!admin) return { error: "Server isn't configured." };
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to continue." };
  if (!(await isEmailVerified(admin, user.id))) return { error: "Verify your email before messaging." };
  return { userId: user.id, admin };
}

function asEntityParty(entityType: ConversationEntityType, entityId: string | null) {
  return { entityType, entityId };
}

// ── Business -> Event Organizer ──────────────────────────────────────────

/** "Message Organizer" from the public Event page. */
export async function messageEventOrganizer(eventId: string, actingBusinessId: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { error: "Write a message first." };

  try {
    await requireBusinessMember(actingBusinessId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that business." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  const { data: event } = await admin.from("events").select("id").eq("id", eventId).eq("is_demo", false).maybeSingle();
  if (!event) return { error: "That event is no longer available." };

  const { id: conversationId } = await getOrCreateConversation(admin, {
    subjectType: "event_business_chat",
    subjectId: eventId,
    partyA: asEntityParty("business", actingBusinessId),
    partyB: asEntityParty("event", eventId),
    actingUserId: userId,
  });
  await sendTextMessage(admin, conversationId, userId, "business", actingBusinessId, text);
  return { conversationId };
}

/** "Apply to Participate" from the public Event page — same roster/
 * Opportunity logic as the existing Business Manager "Option 1: Apply to
 * an existing FindMi event" (addAppearanceFromEvent in account/business/
 * actions.ts), just reachable from the Event page directly instead of
 * requiring a trip through the Business Manager first (Section 12). An
 * event-linked Appearance is still never created at application time —
 * only once participation resolves to 'approved' (already-invited case
 * here, or a later organizer approval), via the same ensureEventAppearance
 * every other approval path uses. */
/** Occurrence-Aware Event Participation pass — Phase 2's product rule,
 * enforced server-side (never trusted from the client alone): for an
 * Event with NO occurrence rows, legacy whole-event application behavior
 * is unchanged. For an Event with exactly ONE occurrence, an empty
 * selection auto-applies to that one date. For an Event with MULTIPLE
 * occurrences, at least one date MUST be selected — never a silent
 * "whole event" default (that default is exactly what produced the
 * Palermo Ceramics bug this pass fixes: an approved application with no
 * recorded occurrence, invisible on the public per-occurrence roster).
 * Each selected occurrence gets its OWN Opportunity (event_occurrence_id
 * set) — createOpportunity's existing per-occurrence pending/duplicate/
 * crossed-resolution rules apply independently to each, and its existing
 * Conversation-reuse logic (findConversationByEntityPair, keyed on the
 * business+event identity pair, not occurrence) means every selected
 * date's Opportunity lands in the SAME conversation — one thread, not
 * one per date. */
export async function applyToEventPublic(
  eventId: string,
  occurrenceIds: string[],
  actingBusinessId: string,
  note: string
): Promise<ActionResult> {
  try {
    await requireBusinessMember(actingBusinessId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that business." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  const { data: event } = await admin.from("events").select("id").eq("id", eventId).eq("is_demo", false).maybeSingle();
  if (!event) return { error: "That event is no longer available." };

  const { data: occurrenceRows } = await admin.from("event_occurrences").select("id").eq("event_id", eventId);
  const allOccurrenceIds = ((occurrenceRows ?? []) as { id: string }[]).map((o) => o.id);
  const isRecurring = allOccurrenceIds.length > 0;

  let selectedOccurrenceIds = [...new Set(occurrenceIds.filter(Boolean))];
  if (isRecurring) {
    if (allOccurrenceIds.length === 1 && selectedOccurrenceIds.length === 0) {
      selectedOccurrenceIds = allOccurrenceIds;
    } else {
      // Defense in depth — only accept ids that actually belong to this
      // event, regardless of what the client claims.
      const validIds = new Set(allOccurrenceIds);
      selectedOccurrenceIds = selectedOccurrenceIds.filter((id) => validIds.has(id));
    }
    if (selectedOccurrenceIds.length === 0) {
      return { error: "Choose at least one date to apply for." };
    }
  }

  let conversationId: string | null = null;

  if (!isRecurring) {
    const { data: existingRow } = await admin
      .from("event_businesses")
      .select("status")
      .eq("event_id", eventId)
      .eq("business_id", actingBusinessId)
      .maybeSingle();
    const currentStatus = (existingRow as { status: string } | null)?.status ?? null;
    if (currentStatus === "approved") return { error: "You're already a confirmed participant in that event." };

    if (currentStatus === "invited") {
      await admin.from("event_businesses").update({ status: "approved" }).eq("event_id", eventId).eq("business_id", actingBusinessId);
      await ensureEventAppearance(admin, eventId, actingBusinessId);
    } else if (currentStatus !== "applied" && currentStatus !== "pending") {
      await admin.from("event_businesses").upsert({ event_id: eventId, business_id: actingBusinessId, status: "applied" }, { onConflict: "event_id,business_id" });
    }

    try {
      const outcome = await createOpportunity(admin, {
        type: "event_application",
        eventId,
        eventOccurrenceId: null,
        businessId: actingBusinessId,
        initiatorUserId: userId,
        initiatorEntityType: "business",
        initiatorEntityId: actingBusinessId,
        note: note.trim() || null,
      });
      if ("opportunity" in outcome) conversationId = outcome.opportunity.conversation_id;
    } catch (err) {
      console.error("[opportunities] failed to record application Opportunity", err);
    }
  } else {
    for (const occurrenceId of selectedOccurrenceIds) {
      const { data: existingRow } = await admin
        .from("event_occurrence_businesses")
        .select("status")
        .eq("occurrence_id", occurrenceId)
        .eq("business_id", actingBusinessId)
        .maybeSingle();
      const currentStatus = (existingRow as { status: string } | null)?.status ?? null;
      if (currentStatus === "approved") continue; // already confirmed for this date — nothing to (re)apply for
      if (currentStatus !== "applied" && currentStatus !== "pending") {
        await admin
          .from("event_occurrence_businesses")
          .upsert({ occurrence_id: occurrenceId, business_id: actingBusinessId, status: "applied" }, { onConflict: "occurrence_id,business_id" });
      }

      try {
        const outcome = await createOpportunity(admin, {
          type: "event_application",
          eventId,
          eventOccurrenceId: occurrenceId,
          businessId: actingBusinessId,
          initiatorUserId: userId,
          initiatorEntityType: "business",
          initiatorEntityId: actingBusinessId,
          note: note.trim() || null,
        });
        if (!conversationId && "opportunity" in outcome) conversationId = outcome.opportunity.conversation_id;
      } catch (err) {
        console.error("[opportunities] failed to record application Opportunity", err);
      }
    }
  }

  if (!conversationId) {
    // Fallback: no Opportunity conversation resulted (e.g. already-invited
    // -> immediately approved with no fresh Opportunity created) — a plain
    // Business<->Event Conversation still gives the applicant somewhere to
    // land and keep talking to the organizer.
    const { id } = await getOrCreateConversation(admin, {
      subjectType: "event_business_chat",
      subjectId: eventId,
      partyA: asEntityParty("business", actingBusinessId),
      partyB: asEntityParty("event", eventId),
      actingUserId: userId,
    });
    conversationId = id;
  }

  return { conversationId };
}

// ── Event -> Business (Invite) / Business <-> Business / Business <-> Location ──

/** "Message Business" from the public Business page, acting as either a
 * Business (peer-to-peer, Section 8) or an Event (organizer reaching out
 * to a vendor, Section 9) — never as a personal consumer identity (the
 * existing Inquiry flow stays the consumer's own path, untouched — Section
 * 2's own explicit carve-out). */
export async function messageBusiness(
  targetBusinessId: string,
  actingEntityType: "business" | "event",
  actingEntityId: string,
  body: string
): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { error: "Write a message first." };
  if (actingEntityId === targetBusinessId) return { error: "You can't message your own business." };

  try {
    if (actingEntityType === "business") await requireBusinessMember(actingEntityId);
    else await requireEventMember(actingEntityId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  const { data: business } = await admin.from("businesses").select("id").eq("id", targetBusinessId).eq("is_demo", false).maybeSingle();
  if (!business) return { error: "That business is no longer available." };

  const { id: conversationId } = await getOrCreateConversation(admin, {
    subjectType: actingEntityType === "business" ? "business_business_chat" : "event_business_chat",
    subjectId: actingEntityType === "business" ? targetBusinessId : actingEntityId,
    partyA: asEntityParty(actingEntityType, actingEntityId),
    partyB: asEntityParty("business", targetBusinessId),
    actingUserId: userId,
  });
  await sendTextMessage(admin, conversationId, userId, actingEntityType, actingEntityId, text);
  return { conversationId };
}

/** "Invite to Event" from the public Business page — same roster/
 * Opportunity logic as the existing Event Manager's inviteParticipatingBusiness,
 * just reachable directly from the Business page (acting identity = the
 * organizer's Event) instead of requiring a trip through the Event Manager
 * first. Whole-event only, same limitation inviteParticipatingBusiness
 * already has (no occurrence parameter). */
export async function inviteBusinessToEventPublic(actingEventId: string, targetBusinessId: string, note: string): Promise<ActionResult> {
  try {
    await requireEventMember(actingEventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that event." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  const { data: business } = await admin.from("businesses").select("id").eq("id", targetBusinessId).eq("is_demo", false).maybeSingle();
  if (!business) return { error: "That business is no longer available." };

  const { error } = await admin
    .from("event_businesses")
    .upsert({ event_id: actingEventId, business_id: targetBusinessId, status: "invited" }, { onConflict: "event_id,business_id", ignoreDuplicates: true });
  if (error) return { error: error.message };

  let conversationId: string | null = null;
  try {
    const outcome = await createOpportunity(admin, {
      type: "event_invitation",
      eventId: actingEventId,
      eventOccurrenceId: null,
      businessId: targetBusinessId,
      initiatorUserId: userId,
      initiatorEntityType: "event",
      initiatorEntityId: actingEventId,
      note: note.trim() || null,
    });
    if ("opportunity" in outcome) conversationId = outcome.opportunity.conversation_id;
    if (outcome.kind === "crossed") {
      await admin.from("event_businesses").update({ status: "approved" }).eq("event_id", actingEventId).eq("business_id", targetBusinessId);
      await ensureEventAppearance(admin, actingEventId, targetBusinessId);
    }
  } catch (err) {
    console.error("[opportunities] failed to record invitation Opportunity", err);
  }

  if (!conversationId) {
    const { id } = await getOrCreateConversation(admin, {
      subjectType: "event_business_chat",
      subjectId: actingEventId,
      partyA: asEntityParty("event", actingEventId),
      partyB: asEntityParty("business", targetBusinessId),
      actingUserId: userId,
    });
    conversationId = id;
  }

  return { conversationId };
}

// ── Business <-> Location ────────────────────────────────────────────────

/** "Message Location" from the public Location page — Business acting
 * identity only (Section 10's minimal scope: plain messaging plugged into
 * the same Conversation model, no Location-specific structured Opportunity
 * type this pass). */
export async function messageLocation(targetLocationId: string, actingBusinessId: string, body: string): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { error: "Write a message first." };

  try {
    await requireBusinessMember(actingBusinessId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that business." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  const { data: location } = await admin.from("locations").select("id").eq("id", targetLocationId).eq("is_demo", false).maybeSingle();
  if (!location) return { error: "That venue is no longer available." };

  const { id: conversationId } = await getOrCreateConversation(admin, {
    subjectType: "business_location_chat",
    subjectId: targetLocationId,
    partyA: asEntityParty("business", actingBusinessId),
    partyB: asEntityParty("location", targetLocationId),
    actingUserId: userId,
  });
  await sendTextMessage(admin, conversationId, userId, "business", actingBusinessId, text);
  return { conversationId };
}

// ── Conversation thread — reply composer + structured-card actions ──────

/** The reply composer's one entry point (Section 5). Two independent
 * checks before anything is written: the acting identity is verified LIVE
 * (requireBusinessMember/requireEventMember/requireLocationMember — never
 * trusted from the client), AND the sending user is currently authorized
 * for THIS conversation at all (isAuthorizedForConversation — guards
 * against a real business/event owner replying into a private thread that
 * isn't theirs just by naming a conversationId). */
export async function sendReply(
  conversationId: string,
  actingEntityType: ConversationEntityType,
  actingEntityId: string | null,
  body: string
): Promise<ActionResult> {
  const text = body.trim();
  if (!text) return { error: "Write a message first." };

  try {
    if (actingEntityType === "business") await requireBusinessMember(actingEntityId!);
    else if (actingEntityType === "event") await requireEventMember(actingEntityId!);
    else if (actingEntityType === "location") await requireLocationMember(actingEntityId!);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "You don't have access to that." };
  }
  const sender = await requireVerifiedSender();
  if ("error" in sender) return sender;
  const { userId, admin } = sender;

  if (!(await isAuthorizedForConversation(admin, conversationId, userId))) {
    return { error: "You don't have access to this conversation." };
  }

  await sendTextMessage(admin, conversationId, userId, actingEntityType, actingEntityId, text);
  return { conversationId };
}

function threadPath(conversationId: string): string {
  return `/account/messages/${conversationId}`;
}

/** Business-side Accept/Decline on an EVENT INVITATION card inside the
 * thread — identical canonical-participation + Appearance-sync + Opportunity
 * resolution as the existing respondToEventInvitation (Business Manager
 * "Opportunities" tab); this only differs in where it redirects back to
 * (the Conversation thread instead of the Manager tab), so the invitation
 * and its resolution stay visible in the same place the conversation
 * happened (Section 6). */
export async function respondToInvitationInThread(conversationId: string, opportunityId: string, businessId: string, response: "accepted" | "declined") {
  const redirectPath = threadPath(conversationId);
  try {
    await requireBusinessMember(businessId);
  } catch (err) {
    redirect(`${redirectPath}?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to this business.")}`);
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(`${redirectPath}?error=${encodeURIComponent("Server isn't configured.")}`);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && !(await isEmailVerified(admin, user.id))) {
    redirect(`${redirectPath}?error=${encodeURIComponent("Verify your email before responding.")}`);
  }

  const { data: opportunity } = await admin
    .from("opportunities")
    .select("id, event_id, business_id")
    .eq("id", opportunityId)
    .eq("business_id", businessId)
    .eq("type", "event_invitation")
    .eq("status", "pending")
    .maybeSingle();
  if (!opportunity) redirect(`${redirectPath}?error=${encodeURIComponent("That invitation is no longer available.")}`);

  const eventId = (opportunity as { event_id: string }).event_id;
  if (response === "accepted") {
    await admin.from("event_businesses").update({ status: "approved" }).eq("event_id", eventId).eq("business_id", businessId);
    await ensureEventAppearance(admin, eventId, businessId);
  } else {
    await admin.from("event_businesses").update({ status: "declined" }).eq("event_id", eventId).eq("business_id", businessId);
    await cancelEventAppearance(admin, eventId, businessId);
  }
  await resolveOpportunity(admin, opportunityId, response, response === "accepted" ? "Invitation accepted." : "Invitation declined.");

  redirect(`${redirectPath}?updated=1`);
}

/** Organizer-side Approve/Decline on an EVENT APPLICATION card inside the
 * thread — identical canonical-participation + Appearance-sync + Opportunity
 * resolution as the existing updateParticipatingBusinessStatus (Event
 * Manager "Participants" tab); only the redirect target differs, same
 * reasoning as respondToInvitationInThread above. Whole-event applications
 * only — occurrence-specific applications still resolve admin-side only,
 * same existing limitation the Participants tab already has. */
/** Occurrence-Aware Event Participation pass — this now goes through
 * resolveEventApplicationDecision FIRST (lib/opportunities.ts), which is
 * occurrence-aware: an application to specific date(s) writes
 * event_occurrence_businesses + an occurrence Appearance for exactly
 * those date(s), never a whole-event Appearance that made the Business
 * invisible on the public per-occurrence roster (see that function's own
 * root-cause comment). Only when NO application Opportunity is found for
 * this context at all ("not_found" — most commonly because this approval
 * is actually against the organizer's own outstanding invitation, not an
 * application) does this fall back to the original unscoped whole-event
 * write, preserving that existing behavior exactly. An "ambiguous" legacy
 * application (event_occurrence_id null, on an Event that DOES have
 * occurrence rows) refuses approval outright rather than guessing which
 * date(s) were meant — see Phase 9 of this pass's own spec. */
export async function respondToApplicationInThread(conversationId: string, eventId: string, businessId: string, response: "approved" | "declined") {
  const redirectPath = threadPath(conversationId);
  try {
    await requireEventMember(eventId);
  } catch (err) {
    redirect(`${redirectPath}?error=${encodeURIComponent(err instanceof Error ? err.message : "You don't have access to this event.")}`);
  }
  const admin = getAdminSupabase();
  if (!admin) redirect(`${redirectPath}?error=${encodeURIComponent("Server isn't configured.")}`);

  const decision = await resolveEventApplicationDecision(admin, eventId, businessId, response);

  if (decision.kind === "ambiguous") {
    redirect(
      `${redirectPath}?error=${encodeURIComponent("This application doesn't say which date(s) the business applied for. Ask them to submit a new application with specific date(s) selected before you can approve it.")}`
    );
  }

  if (decision.kind === "not_found") {
    // Not an application in the Opportunity system for this context —
    // most likely the organizer's own outstanding invitation. Preserve
    // the original unscoped, whole-event behavior exactly as it was.
    const { error } = await admin.from("event_businesses").update({ status: response }).eq("event_id", eventId).eq("business_id", businessId);
    if (error) redirect(`${redirectPath}?error=${encodeURIComponent(error.message)}`);

    if (response === "approved") {
      await ensureEventAppearance(admin, eventId, businessId);
    } else {
      await cancelEventAppearance(admin, eventId, businessId);
    }

    try {
      await resolveOpportunityByContext(
        admin,
        { eventId, eventOccurrenceId: null, businessId },
        response === "approved" ? "accepted" : "declined",
        response === "approved" ? "Approved by the organizer." : "Declined by the organizer."
      );
    } catch (err) {
      console.error("[opportunities] failed to resolve Opportunity for application response", err);
    }
  }

  redirect(`${redirectPath}?updated=1`);
}
