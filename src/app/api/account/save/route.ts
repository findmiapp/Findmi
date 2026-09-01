import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ENTITY = {
  business: { table: "account_saved_businesses", entityTable: "businesses", column: "business_id" },
  event: { table: "account_saved_events", entityTable: "events", column: "event_id" },
  product: { table: "account_saved_products", entityTable: "products", column: "product_id" },
} as const;
type EntityType = keyof typeof ENTITY;

function isEntityType(value: string | null): value is EntityType {
  return value === "business" || value === "event" || value === "product";
}

async function resolveEntityId(supabase: SupabaseClient, entityTable: string, slug: string): Promise<string | null> {
  const { data } = await supabase.from(entityTable).select("id").eq("slug", slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Per-item saved status for a signed-in visitor — used by
 * useAccountSaved's mount effect once the shared session check resolves
 * true. Never called for a guest (the hook only reaches here after
 * confirming authentication), and always requires its own auth.getUser()
 * check anyway rather than trusting that. */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const slug = request.nextUrl.searchParams.get("slug");
  if (!isEntityType(type) || !slug) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ saved: false });

  const { table, entityTable, column } = ENTITY[type];
  const entityId = await resolveEntityId(supabase, entityTable, slug);
  if (!entityId) return NextResponse.json({ saved: false });

  const { data } = await supabase.from(table).select("id").eq("user_id", user.id).eq(column, entityId).maybeSingle();
  return NextResponse.json({ saved: Boolean(data) });
}

/** Toggles one save (insert if absent, delete if present) against the
 * signed-in visitor's account-backed table. Body: { type, slug }. RLS on
 * each account_saved_* table already restricts every row to
 * auth.uid() = user_id, but user.id is still passed explicitly on every
 * query here — same defense-in-depth discipline the rest of the app's
 * authenticated queries already follow, not a substitute for RLS. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : null;
  const slug = typeof body?.slug === "string" ? body.slug : null;
  if (!isEntityType(type) || !slug) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { table, entityTable, column } = ENTITY[type];
  const entityId = await resolveEntityId(supabase, entityTable, slug);
  if (!entityId) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: existing } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", user.id)
    .eq(column, entityId)
    .maybeSingle();

  if (existing) {
    await supabase.from(table).delete().eq("id", (existing as { id: string }).id);
    return NextResponse.json({ saved: false });
  }

  await supabase.from(table).insert({ user_id: user.id, [column]: entityId });
  return NextResponse.json({ saved: true });
}
