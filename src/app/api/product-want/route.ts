import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { getServerSupabase } from "@/lib/supabase/server";
import { getSupabase } from "@/lib/supabase";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { applyCatalogProductFilter } from "@/lib/product-catalog";
import { isProductId, normalizeWantEmail, recordWantEmailAttempt, sanitizeWantChannel, sanitizeWantSource } from "@/lib/product-wants-domain";
import { getAccountWantedProductIds, recordEmailWant, setAccountWant } from "@/lib/product-wants";

export const dynamic = "force-dynamic";

// Product Want — the one write/read path for the canonical product_wants
// relationship (Product page, Product cards, the Save sheet's Want option,
// Things I Want). Save is a different relationship (/api/account/save);
// nothing here touches it.

/** Batched status for the signed-in viewer: ?ids=a,b,c (≤ 60). Guests get
 * signedIn:false and no ids (their state is device-local). */
export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(isProductId).slice(0, 60);
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false, wanted: [] });
  return NextResponse.json({ signedIn: true, wanted: await getAccountWantedProductIds(supabase, user.id, ids) });
}

/** A Want can only be expressed for a publicly visible catalog Product. */
async function isWantableProduct(productId: string): Promise<boolean> {
  const anon = getSupabase();
  if (!anon) return false;
  const { data } = await applyCatalogProductFilter(anon.from("products").select("id").eq("id", productId)).maybeSingle();
  return Boolean(data);
}

/** Body: { productId, on, source?, sourceChannel?, email?, website? }.
 * Signed in → the account's Want (on/off). Signed out → email interest
 * (on only; `website` is a honeypot). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const productId = body?.productId;
  if (!isProductId(productId)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const on = body?.on !== false;
  const ctx = { source: sanitizeWantSource(body?.source), sourceChannel: sanitizeWantChannel(body?.sourceChannel) };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Un-Want never needs the Product to still be public.
    if (on && !(await isWantableProduct(productId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const result = await setAccountWant(supabase, user.id, productId, on, ctx);
    if (!result.ok) return NextResponse.json({ error: "Couldn't update that. Please try again." }, { status: 500 });
    return NextResponse.json({ signedIn: true, wanted: result.wanted });
  }

  if (!on) return NextResponse.json({ error: "Sign in to manage this." }, { status: 401 });
  // Honeypot: pretend success, store nothing.
  if (typeof body?.website === "string" && body.website.trim() !== "") return NextResponse.json({ signedIn: false, wanted: true });
  const email = normalizeWantEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const h = await headers();
  const key = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (recordWantEmailAttempt(key)) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  if (!(await isWantableProduct(productId))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const admin = getAdminSupabase();
  if (!admin || !(await recordEmailWant(admin, productId, email, ctx))) {
    return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 500 });
  }
  // Same response whether or not this email had already expressed interest.
  return NextResponse.json({ signedIn: false, wanted: true });
}
