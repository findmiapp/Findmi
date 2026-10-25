// Privileged-action audit log (admin_audit_events, service role only).
// Trust & Privacy Phase 2A. Records WHAT privileged action happened, to
// what, and when. The shared ADMIN_PASSWORD session has no individual
// identity, so admin actions are attributed to actor_kind = "admin" only;
// moving to individual admin accounts is a separate security project.
//
// Never logged: passwords, tokens, reset links, message bodies, report
// details, or other free text. `detail` keeps only short scalar values of
// non-sensitive keys (see sanitizeAuditDetail).
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditActor = { kind: "admin" } | { kind: "user"; userId: string };

export interface AdminAuditInput {
  action: string;
  actor: AuditActor;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

const FORBIDDEN_KEY = /pass|token|secret|link|body|message|details|note|email|phone/i;
const ACTION_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** Keeps short, scalar, non-sensitive fields only (exported for tests). */
export function sanitizeAuditDetail(detail: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!detail) return out;
  for (const [key, value] of Object.entries(detail).slice(0, 20)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 120);
  }
  return out;
}

/** Best-effort: a logging failure never blocks the privileged action. */
export async function recordAdminAudit(admin: SupabaseClient | null, input: AdminAuditInput): Promise<void> {
  if (!admin || !ACTION_RE.test(input.action)) return;
  try {
    await admin.from("admin_audit_events").insert({
      action: input.action,
      actor_kind: input.actor.kind,
      actor_user_id: input.actor.kind === "user" ? input.actor.userId : null,
      target_type: input.targetType ? input.targetType.slice(0, 40) : null,
      target_id: input.targetId ? String(input.targetId).slice(0, 80) : null,
      detail: sanitizeAuditDetail(input.detail),
    });
  } catch {
    // ignore
  }
}
