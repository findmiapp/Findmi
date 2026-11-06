import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isCollectionEntityType, normalizeCollectionName, type CollectionEntityType } from "@/lib/collections-domain";
import { ALLOWED_RELATIONSHIPS, RELATIONSHIPS, type Relationship } from "@/lib/discovery/relationships";
import { GUEST_LIBRARY_VERSION, GUEST_LIMITS } from "@/lib/guest-library";

export const dynamic = "force-dynamic";

// Guest Library → account (lib/guest-library.ts). Signed-in only; runs as
// the person (RLS: their own Collections / relationships only).
//
// Idempotent, so an interrupted sync can simply run again:
//   • a guest Collection merges into the account's Collection of the same
//     name (names are unique per person, ignoring case) — else it's created;
//   • items and list saves already in the account are skipped (unique
//     keys), never duplicated;
//   • only real, visible entities are imported (re-checked here);
//   • nothing already in the account is changed or removed.
// The client clears the guest copy only after { ok: true }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE: Record<CollectionEntityType, string> = { product: "products", event: "events", location: "locations", business: "businesses" };
type Ref = { type: CollectionEntityType; id: string };

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { v?: unknown; collections?: unknown; relations?: unknown } | null;
  if (!body || body.v !== GUEST_LIBRARY_VERSION) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const ref = (raw: unknown): Ref | null => {
    const r = raw as { type?: unknown; id?: unknown } | null;
    return r && isCollectionEntityType(r.type) && typeof r.id === "string" && UUID.test(r.id) ? { type: r.type, id: r.id.toLowerCase() } : null;
  };
  const collections = (Array.isArray(body.collections) ? body.collections.slice(0, GUEST_LIMITS.collections) : [])
    .map((c) => ({ name: normalizeCollectionName((c as { name?: unknown })?.name), items: (Array.isArray((c as { items?: unknown })?.items) ? ((c as { items: unknown[] }).items.slice(0, GUEST_LIMITS.itemsPerCollection)) : []).map(ref).filter((x): x is Ref => x !== null) }))
    .filter((c): c is { name: string; items: Ref[] } => c.name !== null);
  const relations = (Array.isArray(body.relations) ? body.relations.slice(0, GUEST_LIMITS.relations) : [])
    .map((r) => {
      const e = ref(r);
      const relation = (r as { relation?: unknown })?.relation;
      if (!e || typeof relation !== "string" || !(RELATIONSHIPS as readonly string[]).includes(relation)) return null;
      // Allowed for that type; Product Want stays with its own control.
      if (!ALLOWED_RELATIONSHIPS[e.type].includes(relation as Relationship) || (e.type === "product" && relation === "want")) return null;
      return { ...e, relation: relation as Relationship };
    })
    .filter((x): x is Ref & { relation: Relationship } => x !== null);

  // Only entities that exist and this person can see.
  const wanted = new Map<CollectionEntityType, Set<string>>();
  for (const e of [...collections.flatMap((c) => c.items), ...relations]) wanted.set(e.type, (wanted.get(e.type) ?? new Set()).add(e.id));
  const visible = new Set<string>();
  for (const [type, ids] of wanted) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += 150) {
      const { data } = await supabase.from(TABLE[type]).select("id").in("id", list.slice(i, i + 150));
      for (const row of (data ?? []) as { id: string }[]) visible.add(`${type}:${row.id.toLowerCase()}`);
    }
  }
  const ok = (e: Ref) => visible.has(`${e.type}:${e.id}`);

  let addedItems = 0;
  let addedRelations = 0;
  let skipped = 0;
  let createdCollections = 0;
  let failed = false;

  // Collections: merge by name, else create.
  const { data: existing, error: listError } = await supabase.from("user_collections").select("id, name").eq("user_id", user.id);
  if (listError) return NextResponse.json({ error: "Collections aren't available right now." }, { status: 503 });
  const byName = new Map(((existing ?? []) as { id: string; name: string }[]).map((c) => [c.name.trim().toLowerCase(), c.id]));
  for (const c of collections) {
    let id = byName.get(c.name.toLowerCase()) ?? null;
    if (!id) {
      const { data, error } = await supabase.from("user_collections").insert({ user_id: user.id, name: c.name }).select("id").single();
      if (error && error.code === "23505") {
        // Created meanwhile (another tab's sync) — use it.
        const { data: again } = await supabase.from("user_collections").select("id, name").eq("user_id", user.id);
        id = ((again ?? []) as { id: string; name: string }[]).find((x) => x.name.trim().toLowerCase() === c.name.toLowerCase())?.id ?? null;
      } else if (error) {
        failed = true;
        continue;
      } else {
        id = (data as { id: string }).id;
        createdCollections++;
      }
      if (id) byName.set(c.name.toLowerCase(), id);
    }
    if (!id) {
      failed = true;
      continue;
    }
    for (const e of c.items) {
      if (!ok(e)) {
        skipped++;
        continue;
      }
      const { error } = await supabase.from("user_collection_items").insert({ collection_id: id, entity_type: e.type, entity_id: e.id });
      if (!error) addedItems++;
      else if (error.code !== "23505") failed = true;
    }
  }

  // Lists (relationships): add what the account doesn't have yet.
  for (const r of relations) {
    if (!ok(r)) {
      skipped++;
      continue;
    }
    const { error } = await supabase.from("user_entity_relationships").insert({ user_id: user.id, entity_type: r.type, entity_id: r.id, relation: r.relation });
    if (!error) addedRelations++;
    else if (error.code !== "23505") failed = true;
  }

  // Anything that failed for a reason other than "already there" keeps the
  // guest copy on the device; the next visit tries again (idempotent).
  if (failed) return NextResponse.json({ ok: false, error: "Some saves couldn't be added yet — they're still on this device." }, { status: 500 });
  return NextResponse.json({ ok: true, createdCollections, addedItems, addedRelations, skipped });
}
