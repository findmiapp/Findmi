import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const locationId = typeof body?.locationId === "string" ? body.locationId : null;
  const email = typeof body?.email === "string" ? body.email.trim() : null;

  if (!locationId || !email) {
    return NextResponse.json({ error: "Missing locationId or email" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Findmi isn't configured yet" }, { status: 503 });
  }

  // Location Public Profile UX pass — routed through follow_location()
  // rather than a direct .from("location_followers").upsert(...), same
  // reason /api/follow-event uses follow_event(): Postgres needs SELECT
  // visibility under RLS to evaluate an INSERT ... ON CONFLICT target, and
  // location_followers intentionally has no SELECT policy.
  const { error } = await supabase.rpc("follow_location", {
    p_location_id: locationId,
    p_email: email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
