"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { bool, errorRedirectUrl, localDateTimeToIso, num, str } from "@/lib/admin/form-helpers";

const LIST_PATH = "/admin/pro-invites";

const GRANT_PURPOSES = ["business_pro", "event_management"] as const;
type GrantPurpose = (typeof GRANT_PURPOSES)[number];

/** Creates a new Pro Invite. Useful defaults (Plan=Pro, Duration=365,
 * Max Redemptions=1, Active=yes, Purpose=Business Pro) live in the form
 * itself (page.tsx) — this action just persists whatever the form
 * actually submitted. Uniqueness is enforced by the DB's case-insensitive
 * unique index on upper(code) (see the pro_invites migration), not
 * re-checked here — a collision surfaces as a Postgres error, reported
 * back below.
 *
 * Multi-Entity Self-Service V1, Stage 2B — grant_purpose is validated
 * against the exact same two values the DB CHECK constraint allows,
 * defaulting to "business_pro" for any missing/unrecognized submission
 * (never silently granting the more powerful Event-Management purpose
 * from a malformed request). This is the ONLY place grant_purpose is
 * ever set — the redemption flow (redeem/actions.ts) only ever READS it
 * back off the stored invite row, never accepts it from a redeeming
 * visitor. */
export async function createProInvite(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const code = str(formData, "code");
  if (!code) redirect(errorRedirectUrl(LIST_PATH, "A code is required."));

  const durationDays = num(formData, "duration_days") ?? 365;
  if (durationDays <= 0) redirect(errorRedirectUrl(LIST_PATH, "Duration must be a positive number of days."));

  const maxRedemptions = num(formData, "max_redemptions"); // blank -> null -> unlimited
  if (maxRedemptions !== null && maxRedemptions <= 0) {
    redirect(errorRedirectUrl(LIST_PATH, "Maximum redemptions must be a positive number, or left blank for unlimited."));
  }

  const submittedPurpose = str(formData, "grant_purpose");
  const grantPurpose: GrantPurpose = GRANT_PURPOSES.includes(submittedPurpose as GrantPurpose)
    ? (submittedPurpose as GrantPurpose)
    : "business_pro";

  const { error } = await supabase.from("pro_invites").insert({
    code,
    name: str(formData, "name"),
    grant_purpose: grantPurpose,
    duration_days: durationDays,
    max_redemptions: maxRedemptions,
    expires_at: localDateTimeToIso(str(formData, "expires_at")),
    is_active: bool(formData, "is_active"),
    created_by_note: str(formData, "created_by_note"),
  });

  if (error) {
    const message = error.code === "23505" ? `Code "${code}" is already in use — choose a different code.` : error.message;
    redirect(errorRedirectUrl(LIST_PATH, message));
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?saved=1`);
}

/** Activate/deactivate — the only other mutation this V1 admin screen
 * needs. No redirect on success, matching moveBusinessCategory/
 * deleteBusinessCategory's own pattern (admin/categories/actions.ts):
 * a small in-place toggle shouldn't reset the page the admin is on. */
export async function setProInviteActive(id: string, isActive: boolean) {
  const supabase = await requireAdminSupabase();
  const { error } = await supabase.from("pro_invites").update({ is_active: isActive }).eq("id", id);
  if (error) redirect(errorRedirectUrl(LIST_PATH, error.message));
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
}
