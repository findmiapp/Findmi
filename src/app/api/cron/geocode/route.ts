import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { drainGeocodeQueue } from "@/lib/geo/geocode";
import { MAX_GEOCODE_BATCH } from "@/lib/geo/geocode-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled safety net for automatic Location placement (vercel.json
 * cron). Most Locations are placed right after they're saved
 * (lib/geo/geocode-auto.ts); this catches everything else — Locations
 * written by any other path, transient-failure retries whose backoff has
 * passed, work cut off mid-request. One bounded batch per run.
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. Without
 * CRON_SECRET configured it refuses every call (fails closed). Returns
 * counts only — never addresses, keys or provider responses.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok = Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  try {
    const s = await drainGeocodeQueue(admin, { limit: MAX_GEOCODE_BATCH });
    return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.warn("[geocode cron]", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "Placement run failed" }, { status: 500 });
  }
}
