import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : null;
  const email = typeof body?.email === "string" ? body.email.trim() : null;

  if (!eventId || !email) {
    return NextResponse.json({ error: "Missing eventId or email" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "FindMi isn't configured yet" }, { status: 503 });
  }

  // Restore Event Follow pass — routed through follow_event() rather than
  // a direct .from("event_followers").upsert(...): Postgres needs SELECT
  // visibility under RLS to evaluate an INSERT ... ON CONFLICT target,
  // and event_followers intentionally has no SELECT policy (same fix
  // /api/follow already applies for the business-side `followers` table
  // via follow_business()). See migration follow_event_rpc.
  const { error } = await supabase.rpc("follow_event", {
    p_event_id: eventId,
    p_email: email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
