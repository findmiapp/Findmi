import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { accountFollowPost } from "@/lib/account-follow-server";

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

/** POST { slug, following?: boolean } — explicit desired state
 * (idempotent), or the legacy toggle when `following` is omitted. See
 * lib/account-follow-server.ts. */
export async function POST(request: NextRequest) {
  return accountFollowPost(request, { entityTable: "locations", followTable: "account_followed_locations", column: "location_id" });
}
