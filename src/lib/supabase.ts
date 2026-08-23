import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * A single, read-only Supabase client shared across server components.
 * Findmi has no end-user auth in V1 — every table is either publicly
 * readable (discovery data) or insert-only for anonymous visitors
 * (inquiries, followers), enforced entirely by Postgres row level
 * security policies. See supabase/schema.sql.
 */
export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  if (cached) return cached;

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
