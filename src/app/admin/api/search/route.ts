import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";

// Server-side search for admin relationship pickers (see
// components/admin/RelationPicker.tsx). Lives under /admin/api/... so
// src/middleware.ts's existing "/admin/:path*" matcher gates it with the
// same founder-session cookie check as every other admin route — no new
// auth code needed. Bounded to 20 rows per query; never returns the full
// table.
export async function GET(request: NextRequest) {
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

  return NextResponse.json({ results: [] }, { status: 400 });
}
