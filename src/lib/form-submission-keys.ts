import type { SupabaseClient } from "@supabase/supabase-js";

/** Creation-form idempotency (2026-11-02 incident: one Create Event form was
 * submitted three times in ~5 seconds and produced three identical Events).
 *
 * A creation form renders a one-time `submission_key` (a UUID minted when
 * the page renders). Its Server Action CLAIMS that key in
 * public.form_submission_keys before creating anything. The table's primary
 * key makes the claim atomic, so of N submissions of the same rendered form
 * exactly one proceeds; every other one is told which entity the first one
 * created (or that it is still being created) instead of creating another.
 *
 * Service-role only (RLS on, no policies) — always pass getAdminSupabase(). */

export const SUBMISSION_KEY_FIELD = "submission_key";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A well-formed key from the form, or null (an old cached form without one
 * still works — it just isn't deduplicated). */
export function readSubmissionKey(formData: FormData): string | null {
  const raw = formData.get(SUBMISSION_KEY_FIELD);
  return typeof raw === "string" && UUID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

export type SubmissionClaim =
  /** This submission owns the key — go ahead and create. */
  | { status: "claimed" }
  /** A previous submission of the same form already created this entity. */
  | { status: "duplicate"; entityId: string }
  /** A previous submission of the same form is still creating it. */
  | { status: "in_progress" }
  /** No key, or the table couldn't be reached — proceed unprotected rather
   * than block a legitimate creation. */
  | { status: "unprotected" };

/** Pure decision for a claim attempt — exported for tests. */
export function decideSubmissionClaim(
  insertError: { code?: string } | null,
  existing: { entity_id: string | null; user_id: string } | null,
  userId: string
): SubmissionClaim {
  if (!insertError) return { status: "claimed" };
  if (insertError.code !== "23505") return { status: "unprotected" };
  // Someone else's key (never expected — keys are random per render): don't
  // leak their entity, and don't block this user either.
  if (!existing || existing.user_id !== userId) return { status: "unprotected" };
  return existing.entity_id ? { status: "duplicate", entityId: existing.entity_id } : { status: "in_progress" };
}

const IN_PROGRESS_WAIT_MS = 8000;
const IN_PROGRESS_POLL_MS = 400;

export async function claimSubmissionKey(
  admin: SupabaseClient,
  { key, kind, userId }: { key: string | null; kind: string; userId: string }
): Promise<SubmissionClaim> {
  if (!key) return { status: "unprotected" };
  const { error } = await admin.from("form_submission_keys").insert({ key, kind, user_id: userId });
  if (!error) return { status: "claimed" };
  if (error.code !== "23505") return { status: "unprotected" };

  // The same form was already submitted. Wait (briefly) for the first
  // submission to finish so this one can land on the same result.
  const deadline = Date.now() + IN_PROGRESS_WAIT_MS;
  for (;;) {
    const { data } = await admin.from("form_submission_keys").select("entity_id, user_id").eq("key", key).maybeSingle();
    const decision = decideSubmissionClaim(error, (data as { entity_id: string | null; user_id: string } | null) ?? null, userId);
    if (decision.status !== "in_progress" || Date.now() >= deadline) return decision;
    await new Promise((r) => setTimeout(r, IN_PROGRESS_POLL_MS));
  }
}

/** Records what the claimed submission created. */
export async function completeSubmissionKey(admin: SupabaseClient, key: string | null, entityId: string): Promise<void> {
  if (!key) return;
  await admin.from("form_submission_keys").update({ entity_id: entityId }).eq("key", key);
}

/** Frees a claimed key when creation failed, so correcting the form and
 * submitting again isn't mistaken for a duplicate. */
export async function releaseSubmissionKey(admin: SupabaseClient, key: string | null): Promise<void> {
  if (!key) return;
  await admin.from("form_submission_keys").delete().eq("key", key).is("entity_id", null);
}
