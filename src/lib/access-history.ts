// Identity, Authorship & Entity Access V1 — the narrow access history.
// Not an application audit log: only the actions listed in
// ACCESS_EVENT_ACTIONS are ever recorded. Best-effort — a history write
// never blocks or fails the access change itself (and before the
// 20261020000000 migration exists the insert simply no-ops).
import type { SupabaseClient } from "@supabase/supabase-js";

export const ACCESS_EVENT_ACTIONS = [
  "claim_approved",
  "manager_added",
  "manager_removed",
  "role_changed",
  "owner_removed",
  "ownership_transferred",
  "all_managers_removed",
  "author_changed",
] as const;
export type AccessEventAction = (typeof ACCESS_EVENT_ACTIONS)[number];

export type AccessActor = { kind: "admin" } | { kind: "user"; userId: string };

export interface AccessEventInput {
  entityType: "business" | "moment";
  entityId: string;
  action: AccessEventAction;
  actor: AccessActor;
  subjectUserId?: string | null;
  detail?: Record<string, unknown>;
}

export function accessEventRow(e: AccessEventInput) {
  return {
    entity_type: e.entityType,
    entity_id: e.entityId,
    action: e.action,
    subject_user_id: e.subjectUserId ?? null,
    actor_kind: e.actor.kind,
    actor_user_id: e.actor.kind === "user" ? e.actor.userId : null,
    detail: e.detail ?? {},
  };
}

/** `admin` must be the service-role client (access_events is service-role only). */
export async function recordAccessEvents(admin: SupabaseClient, events: AccessEventInput[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await admin.from("access_events").insert(events.map(accessEventRow));
  } catch {
    // History is best-effort by design.
  }
}

export interface AccessEventRow {
  id: string;
  action: AccessEventAction;
  subject_user_id: string | null;
  actor_kind: "admin" | "user";
  actor_user_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function listAccessEvents(admin: SupabaseClient, entityType: "business" | "moment", entityId: string, limit = 25): Promise<AccessEventRow[]> {
  const { data, error } = await admin
    .from("access_events")
    .select("id, action, subject_user_id, actor_kind, actor_user_id, detail, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return error ? [] : ((data ?? []) as AccessEventRow[]);
}
