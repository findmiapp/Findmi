"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { getPublicOrigin } from "@/lib/site-url";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("Enter your email.")}`);
  }

  const supabase = await getServerSupabase();
  // resetPasswordForEmail() is what sets the PKCE code-verifier cookie
  // this request's browser needs to later complete the exchange at
  // /auth/callback — see that route and the account foundation pass's
  // report for the same-browser/device dependency this creates.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(getSafeRedirect("/reset-password"))}&type=recovery`,
  });

  // Always the same generic confirmation regardless of whether the
  // address has an account — never reveals account existence.
  redirect("/forgot-password?sent=1");
}
