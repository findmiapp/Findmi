import type { SupabaseClient } from "@supabase/supabase-js";

// Resend Transactional Notification System pass — the one canonical
// recipient-resolution mechanism every product notification call site
// uses, rather than each reinventing its own "whose email is this"
// logic. Deliberately resolves through Supabase Auth's own account email
// (auth.admin.getUserById — the same call lib/admin/user-queries.ts and
// lib/admin/claim-queries.ts already use elsewhere in this app), NEVER a
// public listing's own contact email (lib/contact-info.ts's
// getSiteContactInfo — a completely different, founder-configured
// concept) and NEVER a claim/inquiry's own submitted contact-email field
// (editable free text, not necessarily the account's real login email).
// A public contact email and an authenticated manager's account email
// are different things and must never be conflated.

export type NotifiableEntityKind = "business" | "event" | "location";

const MEMBER_TABLE: Record<NotifiableEntityKind, "business_members" | "event_members" | "location_members"> = {
  business: "business_members",
  event: "event_members",
  location: "location_members",
};
const MEMBER_COLUMN: Record<NotifiableEntityKind, "business_id" | "event_id" | "location_id"> = {
  business: "business_id",
  event: "event_id",
  location: "location_id",
};

/** Case-insensitive dedupe, blanks dropped, original casing of the FIRST
 * occurrence preserved (Resend itself is case-insensitive for delivery,
 * but this keeps the address as the account actually has it on file for
 * anything that logs/displays it). */
export function dedupeEmails(emails: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = raw?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** The canonical authenticated account email for a user_id — Supabase
 * Auth's own record, never anything client-submitted. Returns null for a
 * missing account or one with no email on file (never throws — a
 * lookup failure here should degrade to "no recipient", not break the
 * caller's own already-successful database action). */
export async function getAccountEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return null;
  return data.user.email ?? null;
}

/** Every CURRENT member's canonical account email for a Business/Event/
 * Location — the "appropriate active owner/managers" recipient set used
 * throughout the notification system (Section: Canonical Recipient
 * Resolution). Removed/inactive/unrelated managers are automatically
 * excluded simply by virtue of this reading the live *_members table
 * fresh, the same source of truth every authorization check in this app
 * already uses — there is no separate "notification recipient" list to
 * fall out of sync. `excludeUserId` optionally filters out the acting
 * user (Actor Awareness — a manager should not be emailed about their
 * own action). Deduplicated; empty when the entity has no members or
 * none has a resolvable email. */
export async function getEntityManagerEmails(
  admin: SupabaseClient,
  entityType: NotifiableEntityKind,
  entityId: string,
  excludeUserId?: string | null
): Promise<string[]> {
  const { data } = await admin
    .from(MEMBER_TABLE[entityType])
    .select("user_id")
    .eq(MEMBER_COLUMN[entityType], entityId);
  const userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))].filter(
    (id) => id !== excludeUserId
  );
  const emails = await Promise.all(userIds.map((id) => getAccountEmail(admin, id)));
  return dedupeEmails(emails);
}
