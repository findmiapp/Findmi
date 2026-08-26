import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const businessId = typeof body?.businessId === "string" ? body.businessId : null;
  const email = typeof body?.email === "string" ? body.email.trim() : null;

  if (!businessId || !email) {
    return NextResponse.json({ error: "Missing businessId or email" }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "FindMi isn't configured yet" }, { status: 503 });
  }

  // Was a direct .from("followers").upsert(...) — Postgres requires SELECT
  // visibility under RLS to evaluate an INSERT ... ON CONFLICT target
  // (confirmed by reproducing the write as the anon role), and followers
  // intentionally has no SELECT policy (an anon-writable table holding
  // follower emails should never be bulk-readable via the public anon
  // key). Routed through this SECURITY DEFINER function instead — same
  // upsert, same (business_id, email) duplicate prevention, but the
  // client never gets direct table access. See migration
  // fix_follow_business_rpc.
  const { error } = await supabase.rpc("follow_business", {
    p_business_id: businessId,
    p_email: email,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
