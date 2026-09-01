import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** account_followed_businesses — a signed-in account's own "I follow this
 * business" record. Entirely separate from the existing `followers` table
 * (marketing email-capture, no account required — see FollowButton.tsx
 * and /api/follow, both untouched by this route). Used only once a
 * visitor is confirmed authenticated, so following never needs the
 * email-capture step for them. */
async function resolveBusinessId(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.from("businesses").select("id").eq("slug", slug).maybeSingle();
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

  const businessId = await resolveBusinessId(supabase, slug);
  if (!businessId) return NextResponse.json({ following: false });

  const { data } = await supabase
    .from("account_followed_businesses")
    .select("id")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
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

  const businessId = await resolveBusinessId(supabase, slug);
  if (!businessId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: existing } = await supabase
    .from("account_followed_businesses")
    .select("id")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (existing) {
    await supabase.from("account_followed_businesses").delete().eq("id", (existing as { id: string }).id);
    return NextResponse.json({ following: false });
  }

  await supabase.from("account_followed_businesses").insert({ user_id: user.id, business_id: businessId });
  return NextResponse.json({ following: true });
}
