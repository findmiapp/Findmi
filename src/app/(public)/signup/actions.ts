"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { getPublicOrigin } from "@/lib/site-url";

function confirmationRedirectUrl(next: string): string {
  // `type=signup` lets /auth/callback distinguish a failed signup
  // confirmation from a failed password-recovery exchange, so each gets
  // its own specific failure state instead of one falling through to the
  // other's handling.
  return `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(next)}&type=signup`;
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const next = getSafeRedirect(String(formData.get("next") ?? ""));

  if (!email || !password) {
    redirect(
      `/signup?error=${encodeURIComponent("Email and password are required.")}&next=${encodeURIComponent(next)}`
    );
  }
  // Matches reset-password's existing minimum — enforced here rather
  // than left to Supabase's own project-level setting, so the two flows
  // can never disagree about what a valid password is.
  if (password.length < 8) {
    redirect(
      `/signup?error=${encodeURIComponent("Password must be at least 8 characters.")}&next=${encodeURIComponent(next)}`
    );
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read server-side by the account_foundation migration's
      // handle_new_auth_user() trigger to seed profiles.display_name —
      // never trusted directly for anything else.
      data: displayName ? { display_name: displayName } : undefined,
      emailRedirectTo: confirmationRedirectUrl(next),
    },
  });

  if (error) {
    // Never echo Supabase's raw error.message to the browser here — for
    // signUp specifically that can include an account-existence signal
    // (e.g. "User already registered"), unlike login/forgot-password,
    // which are already generic. Real detail stays server-side only, in
    // the same console.error({...}) shape lib/commerce/membershipCheckout.ts
    // already uses for this kind of failure — no new logging system.
    console.error("[signup] auth.signUp failed", { error: error.message });
    redirect(
      `/signup?error=${encodeURIComponent("Could not create your account. Please try again.")}&next=${encodeURIComponent(next)}`
    );
  }

  redirect(`/signup/check-email?next=${encodeURIComponent(next)}`);
}

/** Resend a signup confirmation email — reachable from both the initial
 * "check your email" screen and the confirm-failed screen (expired/
 * wrong-device/already-used code). Always redirects to the same generic
 * "check your email" confirmation regardless of whether the address is
 * real or already confirmed, same as password reset — never reveals
 * account existence through this path either. */
export async function resendConfirmation(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = getSafeRedirect(String(formData.get("next") ?? ""));

  if (!email) {
    redirect(
      `/signup/check-email?error=${encodeURIComponent("Enter your email to resend the link.")}&next=${encodeURIComponent(next)}`
    );
  }

  const supabase = await getServerSupabase();
  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmationRedirectUrl(next) },
  });

  redirect(`/signup/check-email?resent=1&next=${encodeURIComponent(next)}`);
}
