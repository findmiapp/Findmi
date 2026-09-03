"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { getPublicOrigin } from "@/lib/site-url";

// Admin Users Pass 2 — user-detail actions. Every write here is scoped to
// the one FindMi account this page manages, gated by requireAdminSupabase()
// (founder session verified, service-role client only), and never trusts a
// client-submitted role/user id beyond what it's used to look the row up —
// the same posture as admin/businesses/actions.ts and admin/claims/
// actions.ts, whose business_members/event_members patterns this mirrors
// exactly rather than reinventing.

function userPath(userId: string) {
  return `/admin/users/${userId}`;
}

// ── Password & Account Access ───────────────────────────────────────────

/** Reuses the exact self-service reset flow (resetPasswordForEmail) —
 * available on any Supabase client, not just the anon-key one — so no new
 * email template or delivery mechanism is introduced. The email is looked
 * up fresh server-side via getUserById, never trusted from the client. */
export async function sendPasswordResetEmail(userId: string) {
  const supabase = await requireAdminSupabase();
  const path = userPath(userId);

  const { data, error: lookupError } = await supabase.auth.admin.getUserById(userId);
  if (lookupError || !data.user?.email) {
    redirect(errorRedirectUrl(path, "Couldn't find that user's email."));
  }

  const { error } = await supabase.auth.resetPasswordForEmail(data.user!.email!, {
    redirectTo: `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent("/reset-password")}&type=recovery`,
  });
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't send the reset email. Please try again."));
  }

  revalidatePath(path);
  redirect(`${path}?password_action=reset_sent`);
}

/** Admin-entered temporary/replacement password. Write-only: this action
 * never reads back or displays a password, and updateUserById() is the
 * only place it's ever handed to. */
export async function setUserPassword(userId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const path = userPath(userId);

  // Raw, not trimmed — matches signup/actions.ts and reset-password/
  // actions.ts's existing convention for password values.
  const password = String(formData.get("password") ?? "");
  if (!password || password.length < 8) {
    redirect(errorRedirectUrl(path, "New password must be at least 8 characters."));
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, { password });
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't set that password. Please try again."));
  }

  revalidatePath(path);
  redirect(`${path}?password_action=set`);
}

// ── Business access ──────────────────────────────────────────────────────
// Same insert/delete shape as admin/businesses/actions.ts's
// assignBusinessMember/removeBusinessMember, just addressed the other way
// (fixed user_id, chosen business_id) and redirecting back to this page.

export async function assignUserToBusiness(userId: string, formData: FormData) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const businessId = str(formData, "business_id");
  if (!businessId) {
    redirect(errorRedirectUrl(path, "Choose a business to assign."));
  }

  const { data: existing } = await supabase
    .from("business_members")
    .select("id")
    .eq("business_id", businessId as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    redirect(errorRedirectUrl(path, "That user already has access to this business."));
  }

  const { error } = await supabase
    .from("business_members")
    .insert({ business_id: businessId, user_id: userId, role: "manager" });
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't assign that business. Please try again."));
  }

  revalidatePath(path);
  redirect(`${path}?access_updated=1`);
}

/** Never removes an owner row — `.neq("role", "owner")` guard, identical
 * to removeBusinessMember/removeMember elsewhere. Ownership only ever
 * changes via the claims page's remove_business_owner()/
 * transfer_business_ownership(), untouched by this pass. */
export async function removeUserBusinessAccess(userId: string, memberId: string) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from("business_members")
    .delete()
    .eq("id", memberId)
    .eq("user_id", userId)
    .neq("role", "owner")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl(path, "Couldn't remove that access — it may already be gone, or it's an owner row."));
  }

  revalidatePath(path);
  redirect(`${path}?access_updated=1`);
}

// ── Event access (identical pattern, event_members) ─────────────────────

export async function assignUserToEvent(userId: string, formData: FormData) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const eventId = str(formData, "event_id");
  if (!eventId) {
    redirect(errorRedirectUrl(path, "Choose an event to assign."));
  }

  const { data: existing } = await supabase
    .from("event_members")
    .select("id")
    .eq("event_id", eventId as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    redirect(errorRedirectUrl(path, "That user already has access to this event."));
  }

  const { error } = await supabase
    .from("event_members")
    .insert({ event_id: eventId, user_id: userId, role: "manager" });
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't assign that event. Please try again."));
  }

  revalidatePath(path);
  redirect(`${path}?access_updated=1`);
}

export async function removeUserEventAccess(userId: string, memberId: string) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from("event_members")
    .delete()
    .eq("id", memberId)
    .eq("user_id", userId)
    .neq("role", "owner")
    .select()
    .maybeSingle();

  if (error || !data) {
    redirect(errorRedirectUrl(path, "Couldn't remove that access — it may already be gone, or it's an owner row."));
  }

  revalidatePath(path);
  redirect(`${path}?access_updated=1`);
}
