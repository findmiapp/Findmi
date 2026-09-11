import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

// Server-side search for admin relationship pickers (see
// components/admin/RelationPicker.tsx). Lives under /admin/api/... so
// src/middleware.ts's existing "/admin/:path*" matcher gates it with the
// same founder-session cookie check as every other admin route — that
// remains the first perimeter. requireAdmin() below is Security Pass 4's
// second, independent layer: this route has its own directly-fetchable
// URL, so it must not rely solely on "middleware already gated the page
// that renders my caller." Bounded to 20 rows per query; never returns the
// full table.
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");
  const q = (searchParams.get("q") ?? "").trim();

  const supabase = getAdminSupabase();
  if (!supabase || !q) return NextResponse.json({ results: [] });

  const term = `%${q}%`;

  if (entity === "businesses") {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, city, state, is_demo, logo_url")
      .or(`name.ilike.${term},slug.ilike.${term},city.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        sublabel:
          [b.is_demo ? "Demo" : null, [b.city, b.state].filter(Boolean).join(", ") || null]
            .filter(Boolean)
            .join(" · ") || undefined,
        image_url: b.logo_url,
      })),
    });
  }

  if (entity === "events") {
    const { data } = await supabase
      .from("events")
      .select("id, name, venue_name, is_demo")
      .or(`name.ilike.${term},slug.ilike.${term},venue_name.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((e) => ({
        value: e.id,
        label: e.name,
        sublabel: [e.is_demo ? "Demo" : null, e.venue_name].filter(Boolean).join(" · ") || undefined,
      })),
    });
  }

  if (entity === "products") {
    const { data } = await supabase
      .from("products")
      .select("id, name, slug, image_url, business:businesses(name)")
      .or(`name.ilike.${term},slug.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((p) => {
        const business = Array.isArray(p.business) ? p.business[0] : p.business;
        return {
          value: p.id,
          label: p.name,
          sublabel: business?.name,
          image_url: p.image_url,
        };
      }),
    });
  }

  // Event <-> Venue/Location Relational Workflow pass — admin counterpart
  // of /api/account/search's own "locations" branch (same select shape,
  // same 20-row bound); this one just isn't gated behind requireAdmin()
  // twice — the middleware + requireAdmin() above already cover it. No
  // is_demo filter (unlike the member route) — admin intentionally sees
  // demo Locations too, same convention as this route's own businesses/
  // events branches above (flagged via sublabel, never hidden).
  if (entity === "locations") {
    const { data } = await supabase
      .from("locations")
      .select("id, name, slug, city, state, address, postal_code, is_demo, category:categories(name)")
      .or(`name.ilike.${term},slug.ilike.${term},city.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((l) => {
        const category = Array.isArray(l.category) ? (l.category[0] ?? null) : l.category;
        return {
          value: l.id,
          label: l.name,
          sublabel:
            [l.is_demo ? "Demo" : null, [l.city, l.state].filter(Boolean).join(", ") || null]
              .filter(Boolean)
              .join(" · ") || undefined,
          slug: l.slug,
          city: l.city,
          state: l.state,
          address: l.address,
          postal_code: l.postal_code,
          category: category?.name ?? null,
        };
      }),
    });
  }

  if (entity === "people") {
    const { data } = await supabase
      .from("people")
      .select("id, name, slug, image_url, location, is_public")
      .or(`name.ilike.${term},slug.ilike.${term},location.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: [p.is_public ? null : "Hidden", p.location].filter(Boolean).join(" · ") || undefined,
        image_url: p.image_url,
      })),
    });
  }

  return NextResponse.json({ results: [] }, { status: 400 });
}
