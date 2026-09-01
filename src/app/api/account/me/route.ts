import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The single shared "is this visitor signed in?" check every Save/Follow
 * control uses (via lib/accountSession.ts's memoized fetch) before it
 * decides whether to touch localStorage (guest) or the account-backed
 * tables (signed in). Never exposes anything about the user beyond that
 * one boolean. */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json({ authenticated: Boolean(user) });
}
