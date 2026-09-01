import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "./auth";
import { getAdminSupabase } from "./supabase-admin";

/**
 * Security Pass 4 — for admin/founder-PRIVILEGED Server Actions, API route
 * handlers, and the upload helper ONLY. Verifies an admin session
 * (requireAdmin() — the same check middleware performs) BEFORE returning
 * the service-role client, so privileged work never runs without an
 * independently-verified session even if middleware is accidentally
 * bypassed or the calling function is later reachable from somewhere
 * unexpected. Fails closed: throws before any read/write happens.
 *
 * Do NOT use this for trusted non-admin backend workflows that have no
 * admin session by design (Stripe/Tally webhooks, commerce checkout/
 * order/settlement processing, membership-status polling) — those keep
 * calling getAdminSupabase() (./supabase-admin) directly and authenticate
 * themselves through their own trust boundary (webhook signature
 * verification, or being server-only code with no admin concept at all).
 * See this pass's report for the full A/B/C classification of every
 * getAdminSupabase() call site.
 *
 * Deliberately its OWN file, separate from ./supabase-admin — requireAdmin()
 * imports next/headers (via ./auth), and ./supabase-admin is imported by
 * lib/navigation.ts and lib/homepage-rows.ts, both of which are in turn
 * imported by Client Components for unrelated (non-admin) exports. Adding
 * a next/headers dependency directly to ./supabase-admin taints that whole
 * shared module graph and breaks the build — confirmed by hitting exactly
 * that failure while building this pass. Keeping the admin-session check in
 * its own file means only files that actually need it (every file this
 * pass edited) pull in next/headers.
 */
export async function requireAdminSupabase(): Promise<SupabaseClient> {
  await requireAdmin();
  const client = getAdminSupabase();
  if (!client) throw new Error("Server isn't configured.");
  return client;
}
