import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS, used ONLY by admin Server
 * Actions and admin Server Components. SUPABASE_SERVICE_ROLE_KEY has no
 * NEXT_PUBLIC_ prefix, so Next.js never inlines it into a client bundle;
 * this file must still only ever be imported from server-side code
 * ("use server" actions, Server Components, route handlers) — never from
 * a "use client" component.
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
