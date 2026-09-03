"use server";

import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { errorRedirectUrl, str } from "@/lib/admin/form-helpers";
import { getPublicOrigin } from "@/lib/site-url";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

const NEW_PATH = "/admin/users/new";

/** Admin Users Pass 2 — Create User. Two setup methods, both reusing
 * existing Supabase Auth infrastructure (no new email/callback plumbing):
 *
 * - "email" (default): auth.admin.inviteUserByEmail() — Supabase sends its
 *   own invite email; the link lands on the SAME /auth/callback route
 *   signup/reset-password already use, which exchanges the code and
 *   redirects to `next` (here, /reset-password) — so the invited user
 *   lands on the existing "set your password" screen. Supabase treats an
 *   accepted invite as confirming the email itself; this action never
 *   sets email_confirm.
 * - "password": auth.admin.createUser() with an admin-entered temporary
 *   password and email_confirm: true (admin-vouched immediate login —
 *   there's no invite email in this path, so leaving it unconfirmed would
 *   just lock the account out with no way to confirm it).
 *
 * public.profiles is populated for both paths by the existing
 * on_auth_user_created trigger (handle_new_auth_user(), see
 * supabase/migrations/20260901010000_account_foundation.sql) — it fires
 * on ANY auth.users insert and reads raw_user_meta_data->>'display_name',
 * so passing display_name via user_metadata/data below is the only thing
 * needed to keep it populated for admin-created accounts too. */
export async function createAdminUser(formData: FormData) {
  const supabase = await requireAdminSupabase();

  const email = str(formData, "email");
  const displayName = str(formData, "display_name");
  const method = str(formData, "setup_method") ?? "email";
  // Raw, not trimmed — matches the existing convention in
  // signup/actions.ts and reset-password/actions.ts for password values.
  const password = String(formData.get("password") ?? "");

  if (!email) {
    redirect(errorRedirectUrl(NEW_PATH, "Enter an email address."));
  }

  // Never create a duplicate account — same lookup_auth_user_id_by_email
  // RPC the business-assignment action already uses.
  const { data: existingId } = await supabase.rpc("lookup_auth_user_id_by_email", { p_email: email });
  if (existingId) {
    const params = new URLSearchParams({
      error: "An account with that email already exists.",
      existing_user_id: String(existingId),
    });
    redirect(`${NEW_PATH}?${params.toString()}`);
  }

  if (method === "password") {
    if (!password || password.length < 8) {
      redirect(errorRedirectUrl(NEW_PATH, "Temporary password must be at least 8 characters."));
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: displayName ? { display_name: displayName } : undefined,
    });
    if (error || !data.user) {
      redirect(errorRedirectUrl(NEW_PATH, error?.message ?? "Couldn't create that account. Please try again."));
    }
    redirect(`/admin/users/${data.user!.id}?created=password`);
  }

  // Default: send setup email (invite).
  const next = getSafeRedirect("/reset-password");
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: displayName ? { display_name: displayName } : undefined,
    redirectTo: `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(next)}&type=invite`,
  });
  if (error || !data.user) {
    redirect(errorRedirectUrl(NEW_PATH, error?.message ?? "Couldn't send the setup email. Please try again."));
  }
  redirect(`/admin/users/${data.user!.id}?created=invite`);
}
