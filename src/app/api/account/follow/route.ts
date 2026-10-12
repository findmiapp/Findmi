import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { accountFollowPost } from "@/lib/account-follow-server";

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

/** POST { slug, following?: boolean } — explicit desired state
 * (idempotent), or the legacy toggle when `following` is omitted. See
 * lib/account-follow-server.ts. */
export async function POST(request: NextRequest) {
  return accountFollowPost(request, { entityTable: "businesses", followTable: "account_followed_businesses", column: "business_id" });
}
