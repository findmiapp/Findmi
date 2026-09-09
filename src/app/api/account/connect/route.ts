import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { isEmailVerified } from "@/lib/permissions";
import { getUserManagedEntities } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

/** The public Connect flow's one viewer-state lookup — same shared shape
 * every MessageButton (Event/Business/Location page) reads regardless of
 * which entity it's attached to, mirroring /api/account/claim's own
 * "one small GET the client component polls on mount" convention. Signed
 * out or unverified visitors get `businesses`/`events`/`locations` back
 * as [] (never a fabricated identity), so the client can render the right
 * "sign in" / "verify your email" prompt without a second round trip. */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, emailVerified: false, businesses: [], events: [], locations: [] });
  }

  const admin = getAdminSupabase();
  if (!admin) {
    return NextResponse.json({ authenticated: true, emailVerified: false, businesses: [], events: [], locations: [] });
  }

  const [emailVerified, managed] = await Promise.all([isEmailVerified(admin, user.id), getUserManagedEntities(admin, user.id)]);

  return NextResponse.json({
    authenticated: true,
    emailVerified,
    businesses: managed.businesses,
    events: managed.events,
    locations: managed.locations,
  });
}
