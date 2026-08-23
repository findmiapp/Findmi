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

  const { error } = await supabase
    .from("event_followers")
    .upsert({ event_id: eventId, email }, { onConflict: "event_id,email" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
