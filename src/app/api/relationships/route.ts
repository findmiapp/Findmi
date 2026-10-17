import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { EXCLUSIVE, validateRelationship } from "@/lib/discovery/relationships";

export const dynamic = "force-dynamic";

// Discovery Intelligence V1 — the signed-in viewer's own relationships.
// Runs as the user (request-scoped client) so RLS limits every read and
// write to their own rows; no service role, no client-supplied user id.

export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false, relations: [] });
  const type = req.nextUrl.searchParams.get("type");
  const id = req.nextUrl.searchParams.get("id");
  const v = validateRelationship({ entityType: type, entityId: id, relation: type === "product" ? "want" : "like" });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const { data, error } = await supabase.from("user_entity_relationships").select("relation").eq("user_id", user.id).eq("entity_type", v.entityType).eq("entity_id", v.entityId);
  if (error) return NextResponse.json({ signedIn: true, relations: [] });
  return NextResponse.json({ signedIn: true, relations: (data ?? []).map((r) => r.relation) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { entityType?: unknown; entityId?: unknown; relation?: unknown; on?: unknown } | null;
  const v = validateRelationship(body ?? {});
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to save this." }, { status: 401 });
  if (body?.on === false) {
    const { error } = await supabase.from("user_entity_relationships").delete().eq("user_id", user.id).eq("entity_type", v.entityType).eq("entity_id", v.entityId).eq("relation", v.relation);
    if (error) return NextResponse.json({ error: "Couldn't update that." }, { status: 500 });
    return NextResponse.json({ ok: true, on: false });
  }
  const opposite = EXCLUSIVE[v.relation];
  if (opposite) await supabase.from("user_entity_relationships").delete().eq("user_id", user.id).eq("entity_type", v.entityType).eq("entity_id", v.entityId).eq("relation", opposite);
  const { error } = await supabase.from("user_entity_relationships").insert({ user_id: user.id, entity_type: v.entityType, entity_id: v.entityId, relation: v.relation });
  // 23505 = already set: idempotent.
  if (error && error.code !== "23505") return NextResponse.json({ error: "Couldn't update that." }, { status: 500 });
  return NextResponse.json({ ok: true, on: true });
}
