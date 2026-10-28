import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError, readFieldStatusMap, type PublicFieldStatusMap } from "./profile-visibility";

/** businesses.public_field_status for one Business (service-role only — the
 * column is never granted to anon). A database without the column yet, or
 * any read error, reads as {} = every field live: exactly the behavior
 * before profile visibility existed, never a broken page. */
export async function readBusinessFieldStatus(admin: SupabaseClient | null, businessId: string): Promise<PublicFieldStatusMap> {
  if (!admin) return {};
  const { data, error } = await admin.from("businesses").select("public_field_status").eq("id", businessId).maybeSingle();
  if (error) {
    if (!isMissingColumnError(error, "public_field_status")) console.error("readBusinessFieldStatus failed:", error.message);
    return {};
  }
  return readFieldStatusMap((data as { public_field_status?: unknown } | null)?.public_field_status);
}
