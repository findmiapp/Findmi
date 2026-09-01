"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/auth/safe-redirect";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = getSafeRedirect(String(formData.get("next") ?? ""));

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password are required.")}&next=${encodeURIComponent(next)}`);
  }

  // getServerSupabase() is created fresh here, request-scoped — never a
  // shared/module-level client. See lib/supabase/server.ts's own note.
  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic — never distinguish "no such account" from
    // "wrong password" in the message shown to the client.
    redirect(`/login?error=${encodeURIComponent("Invalid email or password.")}&next=${encodeURIComponent(next)}`);
  }

  redirect(next);
}
