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
  if (!admin || !q) return NextResponse.json({ results: [] });

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
    const { data } = await admin
      .from("locations")
      .select("id, name, city, state, is_demo")
      .eq("is_demo", false)
      .or(`name.ilike.${term},city.ilike.${term},address.ilike.${term}`)
      .order("name")
      .limit(20);
    return NextResponse.json({
      results: (data ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        sublabel: [l.city, l.state].filter(Boolean).join(", ") || undefined,
      })),
    });
  }

  return NextResponse.json({ results: [] }, { status: 400 });
}
