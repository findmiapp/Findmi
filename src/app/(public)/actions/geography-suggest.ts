"use server";

import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { findExistingGeographyMatch, type GeographyMatch } from "@/lib/market-requests";

/**
 * Geography Foundation Pass 2 — the one small read-only bridge that lets
 * an owner-facing CLIENT creation form ask "given this city/state, what
 * existing Findmi Market/Area matches?" without ever holding a
 * service-role credential itself (same "public entry point calling an
 * admin-client helper" shape requestMissingArea in ./area-requests.ts
 * already uses — called directly from a client component, never a
 * `<form action>`).
 *
 * Reuses findExistingGeographyMatch(...) completely unchanged — the same
 * fuzzy/alias matching standalone Appearance geography already relies on
 * (see resolveStandaloneAppearanceGeography in account/business/
 * actions.ts). This is a thin transport wrapper only, never a second
 * matching implementation, and it never writes anything: no
 * market_requests row, no business/location/event mutation. It's purely
 * a PREVIEW — the real creation action (createMemberBusiness/
 * createMemberLocation/createMemberEvent) always independently re-runs
 * its own match/request resolution server-side on submit regardless of
 * what this returned, exactly as it already did before this pass.
 */
export async function suggestGeographyMatch(city: string, state: string): Promise<GeographyMatch | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const text = [city, state]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(", ");
  if (!text) return null;
  return findExistingGeographyMatch(admin, text);
}
