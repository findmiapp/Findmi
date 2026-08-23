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

  const { error } = await supabase
    .from("followers")
    .upsert({ business_id: businessId, email }, { onConflict: "business_id,email" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
