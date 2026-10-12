import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { accountFollowPost } from "@/lib/account-follow-server";

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

/** POST { slug, following?: boolean } — explicit desired state
 * (idempotent), or the legacy toggle when `following` is omitted. See
 * lib/account-follow-server.ts. */
export async function POST(request: NextRequest) {
  return accountFollowPost(request, { entityTable: "events", followTable: "account_followed_events", column: "event_id" });
}
