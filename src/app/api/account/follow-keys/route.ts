import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The signed-in viewer's follows as plain ids — what Moments' "Following"
 * filter matches against (MomentFollowKeys). Same account_followed_*
 * tables /api/account/world reads, RLS-scoped to this user; no entity rows
 * are loaded. 401 for a signed-out caller (guests keep their device lists). */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [biz, events, locations] = await Promise.all([
    supabase.from("account_followed_businesses").select("business_id").eq("user_id", user.id),
    supabase.from("account_followed_events").select("event_id").eq("user_id", user.id),
    supabase.from("account_followed_locations").select("location_id").eq("user_id", user.id),
  ]);
  return NextResponse.json({
    businessSlugs: [],
    businessIds: ((biz.data ?? []) as { business_id: string }[]).map((r) => r.business_id),
    eventIds: ((events.data ?? []) as { event_id: string }[]).map((r) => r.event_id),
    locationIds: ((locations.data ?? []) as { location_id: string }[]).map((r) => r.location_id),
  });
}
