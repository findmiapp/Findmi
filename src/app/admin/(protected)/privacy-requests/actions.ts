"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { recordAdminAudit } from "@/lib/admin/audit";
import { RETIRED_SESSION_ID, analyticsRetentionCutoff, parseAnalyticsRetentionDays } from "@/lib/analytics/retention";

const STATUSES = ["received", "in_review", "completed", "declined", "cancelled"] as const;

/** Records the handling state of one privacy request. Marking a deletion
 * "completed" is only correct after the account was actually deleted
 * (Admin, Users, the account's page, Delete Account). */
export async function updatePrivacyRequest(id: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("admin_note") ?? "").trim().slice(0, 4000) || null;
  if (!(STATUSES as readonly string[]).includes(status)) redirect(`/admin/privacy-requests?error=${encodeURIComponent("Choose a status.")}`);
  const closed = status === "completed" || status === "declined" || status === "cancelled";
  const { error } = await supabase
    .from("privacy_requests")
    .update({ status, admin_note: note, resolved_at: closed ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) redirect(`/admin/privacy-requests?error=${encodeURIComponent("Couldn't save. Please try again.")}`);
  await recordAdminAudit(supabase, { action: "privacy_request_status_changed", actor: { kind: "admin" }, targetType: "privacy_request", targetId: id, detail: { status } });
  revalidatePath("/admin/privacy-requests");
  redirect("/admin/privacy-requests?saved=1");
}

/** Applies the configured analytics retention (lib/analytics/retention):
 * de-identifies analytics rows older than ANALYTICS_RETENTION_DAYS. Runs
 * only when an admin presses it and the variable is set. */
export async function applyAnalyticsRetention() {
  const supabase = await requireAdminSupabase();
  const days = parseAnalyticsRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);
  if (days === null) redirect(`/admin/privacy-requests?error=${encodeURIComponent("Set ANALYTICS_RETENTION_DAYS first.")}`);
  const cutoff = analyticsRetentionCutoff(days);
  const { count, error } = await supabase
    .from("analytics_events")
    .update({ user_id: null, referrer: null, session_id: RETIRED_SESSION_ID }, { count: "exact" })
    .lt("occurred_at", cutoff)
    .neq("session_id", RETIRED_SESSION_ID);
  if (error) redirect(`/admin/privacy-requests?error=${encodeURIComponent("Couldn't apply retention. Please try again.")}`);
  await recordAdminAudit(supabase, { action: "analytics_retention_applied", actor: { kind: "admin" }, targetType: "analytics_events", targetId: null, detail: { days, rows: count ?? 0 } });
  revalidatePath("/admin/privacy-requests");
  redirect(`/admin/privacy-requests?saved=1&retained=${count ?? 0}`);
}
