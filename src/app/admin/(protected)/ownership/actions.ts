"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { str } from "@/lib/admin/form-helpers";
import { isLocationReviewDecision, planLocationReview } from "@/lib/admin/ownership-plan";

// Admin Ownership & Management — management changes for Events and
// Locations over their existing tables only. Each action changes exactly
// one kind of relationship:
//   Event:    events.host_business_id (managing Page) and/or event_members
//             (direct managers). Never the Event row's other fields, its
//             occurrences, participants (event_businesses), media, URLs,
//             appearances or analytics.
//   Location: location_members / location_claim_requests (management) and
//             is_demo (listing approval) — never parent_location_id,
//             business_locations or any other field.
// Audit: access_events only accepts business / moment entities, so these
// Event / Location changes can't be recorded there without a migration.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const back = (kind: "events" | "locations", id: string, params: Record<string, string>) =>
  `/admin/${kind}/${id}?${new URLSearchParams(params).toString()}#ownership`;

async function lookupUserByEmail(supabase: Awaited<ReturnType<typeof requireAdminSupabase>>, email: string | null): Promise<string | null> {
  if (!email) return null;
  const { data } = await supabase.rpc("lookup_auth_user_id_by_email", { p_email: email });
  return typeof data === "string" ? data : null;
}

// ── Events ──────────────────────────────────────────────────────────────

/** Reassign the managing Page (host Business) — optionally removing the
 * listed direct managers in the same confirmed action. */
export async function reassignEventManagingPage(eventId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const businessId = str(formData, "business_id");
  const removeIds = formData.getAll("remove_member_id").filter((v): v is string => typeof v === "string" && UUID.test(v));
  if (!UUID.test(eventId) || !businessId || !UUID.test(businessId)) redirect(back("events", eventId, { ownership_error: "Choose the Business that should manage this Event." }));
  const { data: business } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!business) redirect(back("events", eventId, { ownership_error: "That Business no longer exists." }));

  const { error } = await supabase.from("events").update({ host_business_id: businessId }).eq("id", eventId);
  if (error) redirect(back("events", eventId, { ownership_error: "Couldn't change the managing Page. Nothing was changed." }));

  for (const memberId of removeIds) {
    const removed = await removeEventMemberRow(supabase, eventId, memberId);
    if (!removed) redirect(back("events", eventId, { ownership_error: "The managing Page changed, but a direct manager couldn't be removed. Review below." }));
  }
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/account");
  redirect(back("events", eventId, { ownership: "reassigned" }));
}

async function removeEventMemberRow(supabase: Awaited<ReturnType<typeof requireAdminSupabase>>, eventId: string, memberId: string): Promise<boolean> {
  const { data: row } = await supabase.from("event_members").select("id, role").eq("id", memberId).eq("event_id", eventId).maybeSingle();
  if (!row) return true; // already gone
  if ((row as { role: string }).role === "owner") {
    const { error } = await supabase.rpc("remove_event_owner", { p_event_id: eventId });
    return !error;
  }
  const { error } = await supabase.from("event_members").delete().eq("id", memberId).eq("event_id", eventId);
  return !error;
}

export async function removeEventManager(eventId: string, memberId: string) {
  const supabase = await requireAdminSupabase();
  if (!UUID.test(eventId) || !UUID.test(memberId)) redirect(back("events", eventId, { ownership_error: "Unknown manager." }));
  const ok = await removeEventMemberRow(supabase, eventId, memberId);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/account");
  redirect(back("events", eventId, ok ? { ownership: "manager_removed" } : { ownership_error: "Couldn't remove that manager." }));
}

export async function addEventManager(eventId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const userId = await lookupUserByEmail(supabase, str(formData, "email"));
  if (!userId) redirect(back("events", eventId, { ownership_error: "No Findmi account found with that email." }));
  const { error } = await supabase.from("event_members").insert({ event_id: eventId, user_id: userId, role: "manager" });
  if (error) redirect(back("events", eventId, { ownership_error: error.code === "23505" ? "That person already manages this Event." : "Couldn't add that manager." }));
  revalidatePath(`/admin/events/${eventId}`);
  redirect(back("events", eventId, { ownership: "manager_added" }));
}

// ── Locations ───────────────────────────────────────────────────────────

/** Review a Location submission. Listing approval (is_demo) and the
 * management request are separate decisions — see planLocationReview. */
export async function reviewLocationSubmission(locationId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const decision = formData.get("decision");
  const claimId = str(formData, "claim_id");
  if (!UUID.test(locationId) || !isLocationReviewDecision(decision)) redirect(back("locations", locationId, { ownership_error: "Choose a decision." }));
  const plan = planLocationReview(decision);
  if ((plan.approveRequest || (plan.declineRequest && decision === "decline_request")) && (!claimId || !UUID.test(claimId))) {
    redirect(back("locations", locationId, { ownership_error: "There's no pending management request to decide." }));
  }
  if (plan.approveRequest) {
    // The existing claim approval (atomic: owner membership + approved).
    const { error } = await supabase.rpc("approve_location_claim", { p_claim_id: claimId });
    if (error) redirect(back("locations", locationId, { ownership_error: error.message === "already_owned" ? "This Location already has an Owner — add a Manager instead." : "Couldn't approve that request." }));
  }
  if (plan.declineRequest && claimId && UUID.test(claimId)) {
    await supabase.from("location_claim_requests").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", claimId).eq("location_id", locationId).eq("status", "pending");
  }
  if (plan.publish) {
    const { error } = await supabase.from("locations").update({ is_demo: false }).eq("id", locationId);
    if (error) redirect(back("locations", locationId, { ownership_error: "Couldn't approve the Location listing." }));
  }
  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath("/admin/locations");
  redirect(back("locations", locationId, { ownership: decision }));
}

export async function removeLocationManager(locationId: string, memberId: string) {
  const supabase = await requireAdminSupabase();
  if (!UUID.test(locationId) || !UUID.test(memberId)) redirect(back("locations", locationId, { ownership_error: "Unknown manager." }));
  const { data: row } = await supabase.from("location_members").select("role").eq("id", memberId).eq("location_id", locationId).maybeSingle();
  let ok = true;
  if (row && (row as { role: string }).role === "owner") ok = !(await supabase.rpc("remove_location_owner", { p_location_id: locationId })).error;
  else if (row) ok = !(await supabase.from("location_members").delete().eq("id", memberId).eq("location_id", locationId)).error;
  revalidatePath(`/admin/locations/${locationId}`);
  redirect(back("locations", locationId, ok ? { ownership: "manager_removed" } : { ownership_error: "Couldn't remove that manager." }));
}

export async function addLocationManager(locationId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const userId = await lookupUserByEmail(supabase, str(formData, "email"));
  if (!userId) redirect(back("locations", locationId, { ownership_error: "No Findmi account found with that email." }));
  const { error } = await supabase.from("location_members").insert({ location_id: locationId, user_id: userId, role: "manager" });
  if (error) redirect(back("locations", locationId, { ownership_error: error.code === "23505" ? "That person already manages this Location." : "Couldn't add that manager." }));
  revalidatePath(`/admin/locations/${locationId}`);
  redirect(back("locations", locationId, { ownership: "manager_added" }));
}
