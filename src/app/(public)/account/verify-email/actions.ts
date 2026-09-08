"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";

/**
 * Progressive Email Verification pass — the FindMi-owned verification
 * mechanism, built entirely on native Supabase OTP mechanics (no custom
 * token generation/expiry/rate-limiting of any kind). Deliberately does
 * NOT reuse the old signup-confirmation resend (`auth.resend({type:
 * "signup"})`) — that flow requires an UNconfirmed account and becomes
 * meaningless the moment Supabase's "Confirm email" setting is turned
 * off (every new account is auto-confirmed at signup — see the
 * accompanying read-only trace). This is a completely separate,
 * always-available "prove you still control this inbox" flow, usable by
 * any authenticated account regardless of that setting.
 *
 * Also deliberately does NOT touch the shared /auth/callback route (used
 * by signup confirmation AND password recovery) — this uses a same-page
 * 6-digit code entry (verifyOtp) instead of a clickable link, so there's
 * no new branch to thread through that already-multi-purpose route.
 */

function verifyEmailPath(next: string): string {
  return `/account/verify-email?next=${encodeURIComponent(next)}`;
}

/** Sends a Supabase-native OTP code to the CURRENTLY AUTHENTICATED user's
 * own email — never a client-submitted address (there is no email field
 * on this form at all; the target always comes from the session). Uses
 * shouldCreateUser:false so this can never create a new account or be
 * pointed at somebody else's address. */
export async function requestEmailVerification(formData: FormData) {
  const next = getSafeRedirect(String(formData.get("next") ?? ""));
  const target = verifyEmailPath(next);

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!user.email) redirect(errorRedirectUrl(target, "This account has no email on file."));

  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });

  if (error) {
    // Never echo Supabase's raw error message — same posture as every
    // other auth action in this app (signup/actions.ts, login/actions.ts).
    console.error("[verify-email] signInWithOtp failed", { error: error.message, status: error.status });
    redirect(errorRedirectUrl(target, "Couldn't send a verification code. Please try again."));
  }

  redirect(`${target}&sent=1`);
}

/** Completes verification — the user's typed 6-digit code, checked purely
 * via Supabase's own verifyOtp (never a FindMi-invented comparison). Only
 * on a real success, re-confirmed against THIS user's own id, does this
 * write profiles.email_verified_at — through the service-role client,
 * since the client itself has no UPDATE privilege on that column at all
 * (see the add_profile_email_verification / restrict_email_verified_at_
 * client_writes migrations) — this is the one trusted server-side path
 * allowed to set it. */
export async function confirmEmailVerification(formData: FormData) {
  const next = getSafeRedirect(String(formData.get("next") ?? ""));
  const target = verifyEmailPath(next);
  const code = String(formData.get("code") ?? "").trim();

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!user.email) redirect(errorRedirectUrl(target, "This account has no email on file."));
  if (!code) redirect(errorRedirectUrl(target, "Enter the code from your email."));

  const { data, error } = await supabase.auth.verifyOtp({
    email: user.email,
    token: code,
    type: "email",
  });
  // Defense in depth — verifyOtp for type "email" is Supabase's generic
  // OTP/magic-link verifier; re-confirming the returned user is still
  // THIS session's own user (never trusted from the response alone)
  // before writing anything.
  if (error || !data.user || data.user.id !== user.id) {
    redirect(errorRedirectUrl(target, "That code is invalid or expired. Request a new one and try again."));
  }

  const admin = getAdminSupabase();
  if (!admin) redirect(errorRedirectUrl(target, "Server isn't configured."));

  const { error: writeError } = await admin
    .from("profiles")
    .update({ email_verified_at: new Date().toISOString() })
    .eq("id", user.id);
  if (writeError) redirect(errorRedirectUrl(target, "Verified, but couldn't save. Please contact support."));

  revalidatePath("/account");
  revalidatePath("/account/profile");
  redirect(next);
}
