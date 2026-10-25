"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { getPublicOrigin } from "@/lib/site-url";
import { getUserDependencySummary } from "@/lib/admin/user-dependencies";
import { recordAdminAudit } from "@/lib/admin/audit";
import { variantPathsFor } from "@/lib/image-variants-server";
import { JOURNAL_MEDIA_BUCKET } from "@/lib/journal";

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

  await recordAdminAudit(supabase, { action: "password_reset_sent", actor: { kind: "admin" }, targetType: "user", targetId: userId });
  revalidatePath(path);
  redirect(`${path}?password_action=reset_sent`);
}

// Trust & Privacy Phase 2A: the admin "set this user's password" action
// was removed. An admin must never be able to choose the password of an
// existing account (it is an account takeover). Use the reset email above,
// which lets the person set their own password.

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
  await recordAdminAudit(supabase, { action: "business_access_granted", actor: { kind: "admin" }, targetType: "user", targetId: userId });
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
  await recordAdminAudit(supabase, { action: "business_access_removed", actor: { kind: "admin" }, targetType: "user", targetId: userId });
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
  await recordAdminAudit(supabase, { action: "event_access_granted", actor: { kind: "admin" }, targetType: "user", targetId: userId });
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
  await recordAdminAudit(supabase, { action: "event_access_removed", actor: { kind: "admin" }, targetType: "user", targetId: userId });
  redirect(`${path}?access_updated=1`);
}

// ── Location access (identical pattern, location_members) ───────────────
// Core Entity Management pass — Location already has its own independent
// membership table (location_members, checked by requireLocationMember)
// exactly like business_members/event_members; this only wires the same
// existing admin/users assign-and-remove shape to it. No new table.

export async function assignUserToLocation(userId: string, formData: FormData) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const locationId = str(formData, "location_id");
  if (!locationId) {
    redirect(errorRedirectUrl(path, "Choose a location to assign."));
  }

  const { data: existing } = await supabase
    .from("location_members")
    .select("id")
    .eq("location_id", locationId as string)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    redirect(errorRedirectUrl(path, "That user already has access to this location."));
  }

  const { error } = await supabase
    .from("location_members")
    .insert({ location_id: locationId, user_id: userId, role: "manager" });
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't assign that location. Please try again."));
  }

  revalidatePath(path);
  await recordAdminAudit(supabase, { action: "location_access_granted", actor: { kind: "admin" }, targetType: "user", targetId: userId });
  redirect(`${path}?access_updated=1`);
}

export async function removeUserLocationAccess(userId: string, memberId: string) {
  const path = userPath(userId);
  const supabase = await requireAdminSupabase();

  const { data, error } = await supabase
    .from("location_members")
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
  await recordAdminAudit(supabase, { action: "location_access_removed", actor: { kind: "admin" }, targetType: "user", targetId: userId });
  redirect(`${path}?access_updated=1`);
}

// ── Delete user (Recovery pass) ─────────────────────────────────────────
// Safe workflow only: the dependency summary is recomputed HERE (never
// trusted from the page), any blocker refuses outright, and the admin
// must type the account's email (or DELETE when it has none) to confirm.
// Nothing beyond the auth account's own FK behavior is removed — no
// Business/Event/Location, public Journal entry or billing record can be
// cascaded away, because any of those is a blocker.
export async function deleteUserAccount(userId: string, formData: FormData) {
  const supabase = await requireAdminSupabase();
  const path = userPath(userId);

  const { data, error: lookupError } = await supabase.auth.admin.getUserById(userId);
  if (lookupError || !data.user) redirect(errorRedirectUrl(path, "Couldn't find that user."));
  const expected = data.user!.email?.trim().toLowerCase() || "delete";
  const typed = (str(formData, "confirm") ?? "").toLowerCase();
  if (typed !== expected) {
    redirect(errorRedirectUrl(path, "Confirmation didn't match — the account was not deleted."));
  }

  const summary = await getUserDependencySummary(userId);
  if (!summary) redirect(errorRedirectUrl(path, "Server isn't configured."));
  if (summary!.blockers.length > 0) {
    redirect(errorRedirectUrl(path, `Not deleted: ${summary!.blockers[0]}`));
  }

  // Trust & Privacy Phase 2A — before the account row goes: collect the
  // private photo files of the Moments that will cascade away (their rows
  // disappear with the account, the files would otherwise stay behind).
  const { data: entryRows } = await supabase.from("journal_entries").select("id").eq("user_id", userId);
  const entryIds = ((entryRows ?? []) as { id: string }[]).map((r) => r.id);
  const { data: mediaRows } = entryIds.length
    ? await supabase.from("journal_entry_media").select("storage_path").in("journal_entry_id", entryIds)
    : { data: [] as { storage_path: string }[] };
  const mediaPaths = ((mediaRows ?? []) as { storage_path: string }[]).flatMap((m) => [m.storage_path, ...variantPathsFor(m.storage_path)]);

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    redirect(errorRedirectUrl(path, "Couldn't delete the account. Nothing was changed."));
  }

  // After the account is gone: remove those files, and de-identify
  // first-party analytics (rows keep their aggregate value; the link to
  // this person is removed). Best-effort; the deletion already happened.
  for (let i = 0; i < mediaPaths.length; i += 100) {
    await supabase.storage.from(JOURNAL_MEDIA_BUCKET).remove(mediaPaths.slice(i, i + 100)).then(() => undefined, () => undefined);
  }
  await supabase.from("analytics_events").update({ user_id: null }).eq("user_id", userId).then(() => undefined, () => undefined);
  await recordAdminAudit(supabase, {
    action: "account_deleted",
    actor: { kind: "admin" },
    targetType: "user",
    targetId: userId,
    detail: { moments_removed: entryIds.length, photo_files_removed: mediaPaths.length },
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?deleted=1");
}
