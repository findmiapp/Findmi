"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";
import { getPublicOrigin } from "@/lib/site-url";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  // Auth Returning-User + Onboarding Shell Correction pass — the eventual
  // destination (e.g. /join/start?intent=passbook) is embedded, unchanged
  // as a string, as /reset-password's OWN `next` query param — the exact
  // same "encode the destination as the next value itself" pattern the
  // /join cards already use for signup (see that pass's own doc comment
  // on why this needs no new redirect-parsing: getSafeRedirect()
  // reconstructs a value's full pathname+search verbatim). This makes
  // /reset-password's post-update redirect (see its own actions.ts) land
  // wherever the visitor was actually headed, instead of always /account.
  const next = getSafeRedirect(String(formData.get("next") ?? ""));

  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("Enter your email.")}&next=${encodeURIComponent(next)}`);
  }

  const supabase = await getServerSupabase();
  const resetPasswordDestination = `/reset-password?next=${encodeURIComponent(next)}`;
  // resetPasswordForEmail() is what sets the PKCE code-verifier cookie
  // this request's browser needs to later complete the exchange at
  // /auth/callback — see that route and the account foundation pass's
  // report for the same-browser/device dependency this creates.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getPublicOrigin()}/auth/callback?next=${encodeURIComponent(resetPasswordDestination)}&type=recovery`,
  });

  // Always the same generic confirmation regardless of whether the
  // address has an account — never reveals account existence.
  redirect(`/forgot-password?sent=1&next=${encodeURIComponent(next)}`);
}
