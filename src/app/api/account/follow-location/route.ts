import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** account_followed_locations — exact location-side mirror of
 * /api/account/follow-event's account_followed_events handling. Entirely
 * separate from location_followers (marketing email-capture, no account
 * required — see /api/follow-location, untouched by this route). */
async function resolveLocationId(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.from("locations").select("id").eq("slug", slug).maybeSingle();
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

  const locationId = await resolveLocationId(supabase, slug);
  if (!locationId) return NextResponse.json({ following: false });

  const { data } = await supabase
    .from("account_followed_locations")
    .select("id")
    .eq("user_id", user.id)
    .eq("location_id", locationId)
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

  const locationId = await resolveLocationId(supabase, slug);
  if (!locationId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: existing } = await supabase
    .from("account_followed_locations")
    .select("id")
    .eq("user_id", user.id)
    .eq("location_id", locationId)
    .maybeSingle();

  if (existing) {
    await supabase.from("account_followed_locations").delete().eq("id", (existing as { id: string }).id);
    return NextResponse.json({ following: false });
  }

  await supabase.from("account_followed_locations").insert({ user_id: user.id, location_id: locationId });
  return NextResponse.json({ following: true });
}
