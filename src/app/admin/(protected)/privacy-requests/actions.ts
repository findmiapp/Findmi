"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { recordAdminAudit } from "@/lib/admin/audit";

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
