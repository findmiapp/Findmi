import "server-only";
import { requireAdminSupabase } from "../requireAdminSupabase";

/**
 * Business Development — the ONE door to the private `bd` schema.
 *
 * Admin request → requireAdmin() (inside requireAdminSupabase) → the
 * existing service-role client → `.schema("bd")`. The bd schema grants
 * USAGE to service_role only (anon/authenticated have none, every table is
 * RLS-on with zero policies), so private BD data is reachable only from
 * server code that passes this check. "server-only" makes importing this
 * file from a Client Component a build error; nothing else in src may call
 * `.schema("bd")` (enforced by tests/bd-admin.test.mjs).
 */
export async function getBdAdminClient() {
  const supabase = await requireAdminSupabase();
  return supabase.schema("bd");
}
