import type { User } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

/**
 * Progressive Email Verification — Callback/Link Fix. The one trusted
 * source of truth for profiles.email_verified_at is Supabase Auth's own
 * user.email_confirmed_at — never a client-submitted boolean, never
 * derived any other way. This is intentionally idempotent and safe to
 * call after ANY successful auth-callback session establishment
 * (signup confirmation, password recovery, or this app's own email
 * verification link) — it only ever fills in a null/stale
 * profiles.email_verified_at, never overwrites an existing timestamp,
 * and no-ops entirely when Supabase Auth doesn't consider the email
 * confirmed yet. Written through the service-role client, since the
 * client itself has no UPDATE privilege on this column (see the
 * add_profile_email_verification / restrict_email_verified_at_client_
 * writes migrations) — this is one of the few trusted server-side paths
 * allowed to set it.
 */
export async function syncEmailVerifiedAt(user: User): Promise<void> {
  if (!user.email_confirmed_at) return;

  const admin = getAdminSupabase();
  if (!admin) return;

  const { data } = await admin.from("profiles").select("email_verified_at").eq("id", user.id).maybeSingle();
  if (data?.email_verified_at) return;

  await admin.from("profiles").update({ email_verified_at: user.email_confirmed_at }).eq("id", user.id);
}
