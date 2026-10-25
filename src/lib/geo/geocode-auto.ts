import "server-only";
// Explicit file path: resolves identically under Next and under plain Node
// ESM (the test harnesses that load lib/places/inline-place.ts).
import { after } from "next/server.js";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { drainGeocodeQueue } from "./geocode";

/** Automatic placement after a Location write. Call it from a Server
 * Action / route right after a Location is created or its address may have
 * changed: the save itself returns immediately, and once the response is
 * sent the same drain the cron uses places these Locations (only if
 * they're actually queued — a Location that's already placed, or whose
 * address didn't change, costs one cheap read and no provider call).
 *
 * Never throws and never blocks the caller. Outside a request scope
 * (scripts, tests) it does nothing; the cron safety net
 * (/api/cron/geocode) still places those. */
export function queueLocationGeocode(ids: (string | null | undefined)[]): void {
  const list = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 5);
  if (list.length === 0) return;
  try {
    after(async () => {
      const admin = getAdminSupabase();
      if (!admin) return;
      try {
        await drainGeocodeQueue(admin, { ids: list, limit: list.length });
      } catch (e) {
        console.warn("[geocode] automatic placement deferred to the scheduled run:", e instanceof Error ? e.message : "unknown error");
      }
    });
  } catch {
    // Not in a request scope — the scheduled run will place it.
  }
}
