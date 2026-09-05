import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** account_followed_events — exact event-side mirror of
 * /api/account/follow's account_followed_businesses handling. Entirely
 * separate from the existing `event_followers` table (marketing email-
 * capture, no account required — see /api/follow-event, both untouched
 * by this route). */
async function resolveEventId(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.from("events").select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ following: false });

  const eventId = await resolveEventId(supabase, slug);
  if (!eventId) return NextResponse.json({ following: false });

  const { data } = await supabase
    .from("account_followed_events")
    .select("id")
    .eq("user_id", user.id)
    .eq("event_id", eventId)
    .maybeSingle();
  return NextResponse.json({ following: Boolean(data) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : null;
  if (!slug) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const eventId = await resolveEventId(supabase, slug);
  if (!eventId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: existing } = await supabase
    .from("account_followed_events")
    .select("id")
    .eq("user_id", user.id)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    await supabase.from("account_followed_events").delete().eq("id", (existing as { id: string }).id);
    return NextResponse.json({ following: false });
  }

  await supabase.from("account_followed_events").insert({ user_id: user.id, event_id: eventId });
  return NextResponse.json({ following: true });
}
