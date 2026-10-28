import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isCollectionEntityType, normalizeCollectionName } from "@/lib/collections-domain";
import { createCollection, deleteCollection, listCollections, renameCollection, setCollectionItem } from "@/lib/collections";

export const dynamic = "force-dynamic";

// Personal Library — Collections. Signed-in only; runs as the person (RLS:
// own Collections only). Organizing never changes a Want, a relationship
// or a Save.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?entityType=&entityId= (optional) → { signedIn, available, collections } */
export async function GET(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false, available: false, collections: [] });
  const type = request.nextUrl.searchParams.get("entityType");
  const id = request.nextUrl.searchParams.get("entityId");
  const entity = isCollectionEntityType(type) && id && UUID.test(id) ? { type, id } : undefined;
  return NextResponse.json({ signedIn: true, ...(await listCollections(supabase, user.id, entity)) });
}

/** Body: { action: "create", name, entityType?, entityId? }
 *      | { action: "add" | "remove", collectionId, entityType, entityId }
 *      | { action: "rename", collectionId, name } | { action: "delete", collectionId } */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use Collections." }, { status: 401 });
  const action = body?.action;
  const entity =
    isCollectionEntityType(body?.entityType) && typeof body?.entityId === "string" && UUID.test(body.entityId)
      ? { type: body.entityType, id: body.entityId }
      : null;
  const collectionId = typeof body?.collectionId === "string" && UUID.test(body.collectionId) ? body.collectionId : null;

  if (action === "create" || action === "rename") {
    const name = normalizeCollectionName(body?.name);
    if (!name) return NextResponse.json({ error: "Give your Collection a name (up to 60 characters)." }, { status: 400 });
    if (action === "rename") {
      if (!collectionId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
      const r = await renameCollection(supabase, user.id, collectionId, name);
      if (r === "duplicate") return NextResponse.json({ error: "You already have a Collection with that name." }, { status: 409 });
      return r === "ok" ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't rename that." }, { status: 500 });
    }
    const created = await createCollection(supabase, user.id, name);
    if ("error" in created) {
      const status = created.error === "duplicate" ? 409 : created.error === "unavailable" ? 503 : 500;
      const message = created.error === "duplicate" ? "You already have a Collection with that name." : "Couldn't create that Collection.";
      return NextResponse.json({ error: message }, { status });
    }
    if (entity && !(await setCollectionItem(supabase, created.id, entity, true))) {
      return NextResponse.json({ error: "Created, but couldn't add this item." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: created.id });
  }

  if (action === "add" || action === "remove") {
    if (!collectionId || !entity) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const ok = await setCollectionItem(supabase, collectionId, entity, action === "add");
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't update that Collection." }, { status: 500 });
  }

  if (action === "delete") {
    if (!collectionId) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    return (await deleteCollection(supabase, user.id, collectionId)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Couldn't delete that." }, { status: 500 });
  }

  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
