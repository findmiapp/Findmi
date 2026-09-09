"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { getPublicOrigin } from "@/lib/site-url";
import { errorRedirectUrlWithFields } from "@/lib/admin/form-helpers";
import { normalizeUsPhone } from "@/lib/phone";

function confirmationRedirectUrl(next: string): string {
  // `type=signup` lets /auth/callback distinguish a failed signup
  // confirmation from a failed password-recovery exchange, so each gets
  // its own specific failure state instead of one falling through to the
  // other's handling.
  return `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(next)}&type=signup`;
}

/**
 * Signup + Email Confirmation UX Correction pass — every error redirect
 * below now preserves display_name/email (never password/confirm_password
 * — see this pass's own report on why those must never ride in a URL),
 * via the same errorRedirectUrlWithFields() helper already used by the
 * native Business/Event/Location creation forms for exactly this
 * "don't wipe the form on error" fix. signup/page.tsx reads these back as
 * defaultValue on Name/Email only.
 */
export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const confirmEmail = String(formData.get("confirm_email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const next = getSafeRedirect(String(formData.get("next") ?? ""));
  const preserved = { next, display_name: displayName, email, phone: phoneRaw };

  if (!displayName || !email || !phoneRaw || !password) {
    redirect(errorRedirectUrlWithFields("/signup", "Full name, email, cell number, and password are required.", preserved));
  }
  // Confirm Email — Section 2. Same trim-only normalization already used
  // everywhere else in the app (login/actions.ts), no new normalization
  // invented. Checked before ever touching Supabase — SignupForm.tsx
  // already blocks this client-side (Case A); this is the authoritative
  // server-side re-check for a JS-disabled or scripted submission.
  if (email !== confirmEmail) {
    redirect(errorRedirectUrlWithFields("/signup", "Email addresses don't match.", preserved));
  }
  // Require Cell Number at Signup pass — normalized to E.164 (NANP only,
  // see lib/phone.ts's own doc comment on why this app doesn't attempt
  // general international support). Rejects unmistakably-invalid input
  // (too few/many digits, an area/exchange code that can't be real)
  // without being picky about how the visitor formatted it.
  const phone = normalizeUsPhone(phoneRaw);
  if (!phone) {
    redirect(errorRedirectUrlWithFields("/signup", "Enter a valid U.S. or Canada cell number.", preserved));
  }
  // Matches reset-password's existing minimum — enforced here rather
  // than left to Supabase's own project-level setting, so the two flows
  // can never disagree about what a valid password is.
  if (password.length < 8) {
    redirect(errorRedirectUrlWithFields("/signup", "Password must be at least 8 characters.", preserved));
  }
  // Confirm Password — Section 3. Same authoritative-server-check
  // relationship to SignupForm.tsx's client check (Case B) as email above.
  if (password !== confirmPassword) {
    redirect(errorRedirectUrlWithFields("/signup", "Passwords don't match.", preserved));
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read server-side by the account_foundation migration's
      // handle_new_auth_user() trigger to seed profiles.display_name/
      // profiles.phone — a convenience mirror only; profiles remains the
      // canonical copy the rest of the app reads (see Profile's own
      // doc comment in lib/types.ts).
      data: { display_name: displayName, phone },
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
    // GoTrue's own rate limit (status 429 — e.g. a near-duplicate submit
    // for the same email) is a real, non-enumerating distinction: it
    // reveals nothing about whether the account exists, only that the
    // request was too soon. Telling the user to wait instead of implying
    // the account wasn't created avoids the exact confusion a duplicate
    // submit produces — everything else still falls through to the
    // generic message.
    const message =
      error.status === 429
        ? "Too many attempts. Please wait a moment and try again."
        : "Could not create your account. Please try again.";
    redirect(errorRedirectUrlWithFields("/signup", message, preserved));
  }

  // Session-aware post-signup routing — Signup + Email Confirmation UX
  // Correction pass, Section 5. supabase.auth.signUp() issues a real
  // session immediately IFF this Supabase project's "Confirm email"
  // requirement is OFF; getServerSupabase()'s cookie adapter (lib/
  // supabase/server.ts) already persisted it via setAll() as a side
  // effect of the call above — there is nothing else to set up, just
  // route to where a signed-in visitor actually belongs (their intended
  // `next`, e.g. /account or /redeem/[code] — never hardcoded, never
  // faked when data.session is null). Confirmed against THIS project's
  // live data before writing this (see this pass's own report):
  // "Confirm email" is currently ON, so data.session is null today and
  // this branch is inert — the very next line (unchanged Check Email
  // redirect) is what actually runs. This activates automatically, with
  // no further code change, the moment that project setting changes.
  if (data.session) {
    redirect(next);
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
