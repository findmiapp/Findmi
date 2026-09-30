"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // Auth Returning-User + Onboarding Shell Correction pass — defaults to
  // /account (getSafeRedirect's own default) exactly like before for any
  // reset that didn't arrive with a `next` (e.g. a plain forgot-password
  // request that didn't originate from the onboarding flow).
  const next = getSafeRedirect(String(formData.get("next") ?? ""));

  if (!password || password.length < 8) {
    redirect(
      `/reset-password?error=${encodeURIComponent("Password must be at least 8 characters.")}&next=${encodeURIComponent(next)}`
    );
  }
  if (password !== confirm) {
    redirect(`/reset-password?error=${encodeURIComponent("Passwords don't match.")}&next=${encodeURIComponent(next)}`);
  }

  const supabase = await getServerSupabase();
  // Requires the recovery session /auth/callback already established on
  // this request's cookies — the page itself re-checks that server-side
  // before rendering the form at all (see page.tsx).
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}
