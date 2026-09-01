import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS. Used by admin Server
 * Actions/Server Components AND by trusted, non-admin backend workflows
 * that legitimately have no admin session of their own (Stripe/Tally
 * webhooks, commerce order processing, membership-status reads — see
 * Security Pass 4's report for the full classification). Because of that
 * second, non-admin category, this factory intentionally does NOT enforce
 * admin authorization itself — see requireAdminSupabase() in
 * ./requireAdminSupabase for the admin-privileged wrapper.
 *
 * Deliberately kept free of any next/headers-importing dependency (see
 * requireAdminSupabase()'s own file for why) — this file is imported by
 * lib/navigation.ts and lib/homepage-rows.ts, which are in turn imported
 * by Client Components for unrelated exports; pulling next/headers in
 * here would taint that whole shared module graph and break the build.
 *
 * SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next.js never
 * inlines it into a client bundle; this file must still only ever be
 * imported from server-side code ("use server" actions, Server Components,
 * route handlers) — never from a "use client" component.
 */
let cached: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (cached) return cached;

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
