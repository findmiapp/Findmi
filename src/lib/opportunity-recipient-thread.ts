import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecipientStatus } from "./opportunity-listings-domain";
import { COMMERCIAL_OPPORTUNITY_SUBJECT, recipientStatusMessage, seedRecipientHistory } from "./opportunity-thread-domain";
import { addEntityParticipants, addSystemMessage, ensureFindmiParticipant } from "./opportunities";

// Opportunity Relationship Thread — one Business ↔ Findmi Conversation per
// commercial Opportunity recipient. The recipient row is the workflow; this
// thread is communication + history. Service-role only: every caller has
// already authorized (requireAdmin, or membership of the recipient's own
// Business). Never touches Targets, Appearances, Events or Find Us Here.

type RecipientRow = {
  id: string;
  business_id: string;
  conversation_id: string | null;
  status: RecipientStatus;
  offered_at: string;
  responded_at: string | null;
  status_changed_at: string;
  business: { name: string } | { name: string }[] | null;
};

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

async function readRecipient(admin: SupabaseClient, recipientId: string): Promise<RecipientRow | null> {
  const { data } = await admin
    .from("opportunity_recipients")
    .select("id, business_id, conversation_id, status, offered_at, responded_at, status_changed_at, business:businesses(name)")
    .eq("id", recipientId)
    .maybeSingle();
  return (data as unknown as RecipientRow | null) ?? null;
}

/** The recipient's thread, created exactly once (idempotent and safe under
 * concurrency: the conversation's subject is unique per recipient, so a
 * racing second create resolves to the first). Re-adds the Business's
 * CURRENT members and Findmi on every call. A thread created for a
 * recipient that already moved on is seeded from the recipient's own
 * timestamps; `created` tells callers not to add the current state again. */
export async function ensureRecipientThread(admin: SupabaseClient, recipientId: string): Promise<{ conversationId: string; created: boolean; businessName: string } | null> {
  const recipient = await readRecipient(admin, recipientId);
  if (!recipient) return null;
  const businessName = one(recipient.business)?.name ?? "This Business";

  let conversationId = recipient.conversation_id;
  let created = false;
  if (!conversationId) {
    const { data: inserted, error } = await admin
      .from("conversations")
      .insert({ subject_type: COMMERCIAL_OPPORTUNITY_SUBJECT, subject_id: recipient.id })
      .select("id")
      .single();
    if (inserted) {
      conversationId = (inserted as { id: string }).id;
      created = true;
    } else if (error?.code === "23505") {
      const { data: existing } = await admin.from("conversations").select("id").eq("subject_type", COMMERCIAL_OPPORTUNITY_SUBJECT).eq("subject_id", recipient.id).maybeSingle();
      conversationId = (existing as { id: string } | null)?.id ?? null;
    }
    if (!conversationId) return null;
    await admin.from("opportunity_recipients").update({ conversation_id: conversationId }).eq("id", recipient.id).is("conversation_id", null);
  }

  await addEntityParticipants(admin, conversationId, "business", recipient.business_id);
  await ensureFindmiParticipant(admin, conversationId);
  if (created) {
    for (const line of seedRecipientHistory({ ...recipient, businessName })) await addSystemMessage(admin, conversationId, line.body, line.createdAt);
  }
  return { conversationId, created, businessName };
}

/** Records a recipient's move into `status` in its thread (creating the
 * thread if needed — a fresh thread is seeded with the current state
 * already, so nothing is written twice). */
export async function recordRecipientStatus(admin: SupabaseClient, recipientId: string, status: RecipientStatus, by: "business" | "findmi"): Promise<string | null> {
  const thread = await ensureRecipientThread(admin, recipientId);
  if (!thread) return null;
  if (!thread.created) await addSystemMessage(admin, thread.conversationId, recipientStatusMessage(status, thread.businessName, by));
  return thread.conversationId;
}
