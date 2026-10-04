import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

// Multi-Entity Self-Service V1, Stage 2 — member-facing counterpart to
// /admin/api/search (components/admin/RelationPicker.tsx's own backing
// route). That route is gated by requireAdmin() and lives under
// src/middleware.ts's "/admin/:path*" matcher — deliberately NOT reused
// here, since Event Manager's organizer-facing pickers (search an
// existing FindMi business to invite; search an existing Location) need
// to work for a plain signed-in event member, not just a founder admin
// session. Gated by a real Supabase Auth session only (any signed-in
// user) rather than per-entity membership — the two entity types exposed
// here (business name/city, location name/city) are already public
// information (visible on /businesses, /locations), so this is a
// convenience search over already-public data, not a privileged read.
// Same bounded-to-20-rows, no-full-table-dump shape as the admin route.
export async function GET(request: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");
  const q = (searchParams.get("q") ?? "").trim();

  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ results: [] });

  // Event Manager Location UX pass — "locations" now also supports an
  // EMPTY q as an A-Z browse (first 20 by name), so the picker can offer
  // a browseable list the moment it's focused, not only once someone
  // types a real query. "businesses" is unchanged: still requires q, same
  // as always (no caller asked for a browse mode there).
  if (!q && entity !== "locations") return NextResponse.json({ results: [] });

  const term = `%${q}%`;

  if (entity === "businesses") {
    const { data } = await admin
      .from("businesses")
      .select("id, name, city, state, is_demo, logo_url")
      .eq("is_demo", false)
      .or(`name.ilike.${term},city.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        sublabel: [b.city, b.state].filter(Boolean).join(", ") || undefined,
        image_url: b.logo_url,
      })),
    });
  }

  if (entity === "locations") {
    // Selected Location Card — carries address/postal_code/category
    // alongside the plain name/city/state the dropdown itself renders, so
    // the picker can show a compact card (name, category, full address,
    // View Location) the instant a Location is picked, with no second
    // request. Reuses this same existing route rather than a parallel
    // Location-search API.
    //
    // Find-or-Create V1 — two distinct questions, never mixed:
    //   default      "which PUBLIC places match?" (published only) — used by
    //                Journal pickers etc., unchanged apart from the fix below.
    //   scope=place  "which places can I LINK to?" — the relationship picker
    //                for Events / dates / Presence. Also includes known but
    //                not-yet-public places (is_demo=true, e.g. one just added
    //                inline), flagged is_public:false.
    // Both now exclude archived/trashed rows explicitly: this route uses the
    // service-role client, which bypasses the RLS policy that hides them.
    // Consumer Discovery (lib/data.ts) is a separate query and is untouched.
    const linkableScope = searchParams.get("scope") === "place";
    let query = admin
      .from("locations")
      .select("id, name, slug, city, state, address, postal_code, is_demo, category:categories(name)")
      .is("archived_at", null)
      .is("trashed_at", null);
    if (!linkableScope) query = query.eq("is_demo", false);
    if (q) query = query.or(`name.ilike.${term},city.ilike.${term},address.ilike.${term}`);
    const { data } = await query.order("name").limit(20);
    return NextResponse.json({
      results: (data ?? []).map((l) => {
        const category = Array.isArray(l.category) ? (l.category[0] ?? null) : l.category;
        return {
          value: l.id,
          label: l.name,
          sublabel: [l.city, l.state].filter(Boolean).join(", ") || undefined,
          slug: l.slug,
          city: l.city,
          state: l.state,
          address: l.address,
          postal_code: l.postal_code,
          category: category?.name ?? null,
          is_public: !l.is_demo,
        };
      }),
    });
  }

  // Journal V1 — "products" and "events", same shape/safety conventions as
  // businesses/locations above (bounded to 20, is_demo/publication-gated to
  // only what's genuinely publicly visible, no full-table dump). Additive:
  // every existing entity branch above is untouched.
  if (entity === "products") {
    const { data } = await admin
      .from("products")
      .select("id, name, slug, image_url, is_active, business:businesses(name, slug, is_demo, publication_status)")
      .eq("is_active", true)
      .ilike("name", term)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? [])
        .map((p) => {
          const business = Array.isArray(p.business) ? (p.business[0] ?? null) : p.business;
          if (!business || business.is_demo || business.publication_status !== "live") return null;
          return {
            value: p.id,
            label: p.name,
            sublabel: business.name,
            image_url: p.image_url,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    });
  }

  if (entity === "events") {
    const { data } = await admin
      .from("events")
      .select("id, name, slug, cover_image_url, start_at, city, state, is_demo")
      .eq("is_demo", false)
      .ilike("name", term)
      .order("start_at", { ascending: false })
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((e) => ({
        value: e.id,
        label: e.name,
        sublabel: [e.city, e.state].filter(Boolean).join(", ") || undefined,
        image_url: e.cover_image_url,
      })),
    });
  }

  return NextResponse.json({ results: [] }, { status: 400 });
}
