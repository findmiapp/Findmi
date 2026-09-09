"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { getPublicOrigin } from "@/lib/site-url";
import { errorRedirectUrl } from "@/lib/admin/form-helpers";

/**
 * Progressive Email Verification — Callback/Link Fix. Root cause of the
 * production bug this replaces: requestEmailVerification called
 * signInWithOtp() with no emailRedirectTo, so Supabase sent its default
 * Magic Link email (confirmed live: auth_logs shows mail_type
 * "magic_link" for every /otp call this app made, never a bare code) —
 * while this page's UI told the visitor to expect and type a 6-digit
 * code. The two mechanisms never agreed, and the link's default
 * redirect target (no emailRedirectTo => GoTrue's configured Site URL)
 * was never this app's own /auth/callback, so clicking it never
 * established a session here — auth_logs also shows a resulting 403
 * "Email link is invalid or has expired" the one time a real visitor's
 * click reached GoTrue's /verify endpoint.
 *
 * Fix: use the mechanism Supabase is actually sending — a clickable
 * link — end to end. signInWithOtp() now passes emailRedirectTo pointed
 * straight at this app's own /auth/callback (the exact same PKCE
 * code-exchange endpoint signup confirmation and password recovery
 * already use — see that route's own doc comment), carrying `next` and
 * a `type=email_verification` marker so a failed/expired click comes
 * back to THIS page with a resend option instead of the signup-specific
 * failure page. shouldCreateUser:false is unchanged from before — this
 * can still never create a new account or target anyone else's address;
 * the email always comes from the authenticated session, never a form
 * field.
 */

function verifyEmailPath(next: string): string {
  return `/account/verify-email?next=${encodeURIComponent(next)}`;
}

function verifyEmailCallbackUrl(next: string): string {
  return `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(next)}&type=email_verification`;
}

/** Sends a Supabase-native verification link to the CURRENTLY
 * AUTHENTICATED user's own email — never a client-submitted address
 * (there is no email field on this form at all; the target always comes
 * from the session). Uses shouldCreateUser:false so this can never
 * create a new account or be pointed at somebody else's address. */
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
    options: { shouldCreateUser: false, emailRedirectTo: verifyEmailCallbackUrl(next) },
  });

  if (error) {
    // Never echo Supabase's raw error message — same posture as every
    // other auth action in this app (signup/actions.ts, login/actions.ts).
    console.error("[verify-email] signInWithOtp failed", { error: error.message, status: error.status });
    redirect(errorRedirectUrl(target, "Couldn't send a verification link. Please try again."));
  }

  redirect(`${target}&sent=1`);
}
