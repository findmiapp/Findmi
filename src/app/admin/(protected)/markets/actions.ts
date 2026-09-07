"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { isSlugTaken } from "@/lib/admin/queries";
import { isMarketAreaSlugTaken } from "@/lib/admin/market-areas";
import { bool, errorRedirectUrl, num, str } from "@/lib/admin/form-helpers";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";

/** "Areas Included" is a lightweight, line-per-area textarea (see
 * MarketForm) — never a picker, never validated against any taxonomy.
 * Blank lines are dropped; an entirely blank field saves as null (not an
 * empty array) so "nothing set" reads the same as it did before this
 * pass existed. Purely informational — never touched by any discovery/
 * entitlement/matching query. */
function parseAreasIncluded(raw: string | null): string[] | null {
  if (!raw) return null;
  const areas = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return areas.length > 0 ? areas : null;
}

export async function saveMarket(id: string | null, formData: FormData) {
  const editPath = id ? `/admin/markets/${id}` : "/admin/markets/new";
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  if (!name) {
    redirect(errorRedirectUrl(editPath, "Name is required."));
  }

  // Same slug-safety discipline as every other admin entity (locations,
  // events, businesses): normalize/derive/dedupe server-side so a broken
  // or blank slug can never reach the database.
  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isSlugTaken("markets", candidate, id ?? undefined));

  const sortOrder = num(formData, "sort_order");

  const payload = {
    name,
    slug,
    display_name: str(formData, "display_name"),
    description: str(formData, "description"),
    areas_included: parseAreasIncluded(str(formData, "areas_included")),
    active: bool(formData, "active"),
    consumer_visible: bool(formData, "consumer_visible"),
    sort_order: sortOrder ?? 0,
  };

  const wasNew = !id;
  let marketId = id;
  if (marketId) {
    const { error } = await supabase.from("markets").update(payload).eq("id", marketId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase.from("markets").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create market."));
    marketId = data.id;
  }

  // Every consumer/admin surface that reads Markets (homepage, /businesses,
  // /events, admin Location/Event/Business Market pickers) reads live from
  // the database on each request — revalidating these paths just clears
  // Next's own response cache for them, it doesn't change any FK/data.
  revalidatePath("/admin/markets");
  revalidatePath(editPath);
  revalidatePath("/");
  revalidatePath("/businesses");
  revalidatePath("/events");

  // Rapid Market entry — "Save & Add Another" (SubmitBar's second submit
  // button) only ever appears on the NEW-market form, so `wasNew` is the
  // only case this can fire for. Redirecting back to the same /new route
  // (rather than the just-created Market's edit page) gives a fresh, blank
  // form via a normal GET — no stale defaultValues, no extra state to
  // reset by hand — while the PRG redirect itself already prevents a
  // refresh from resubmitting the create.
  if (wasNew && str(formData, "intent") === "save_add_another") {
    redirect("/admin/markets/new?created=1");
  }
  redirect(`/admin/markets/${marketId}?saved=1`);
}

// ── Market -> Area Admin Management Completion pass ─────────────────────
// Areas live under the Market they belong to (market_id is never chosen
// by the admin — it's fixed to the Market being managed), same "existing
// market_areas table, same AreaPicker semantics" architecture — no new
// geography system. Same slug-safety discipline as saveMarket above, just
// scoped to (market_id, slug) via isMarketAreaSlugTaken instead of the
// table-wide isSlugTaken. No delete action: businesses.market_area_id,
// events.market_area_id, and market_requests.mapped_area_id all
// reference market_areas.id (verified live) — Active/Show in consumer
// Area picker are the only archival controls, same posture Markets
// themselves already use.

function parseAliases(raw: string | null): string[] | null {
  if (!raw) return null;
  const aliases = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return aliases.length > 0 ? aliases : null;
}

function revalidateAreaConsumers(marketDetailPath: string) {
  revalidatePath("/admin/markets");
  revalidatePath(marketDetailPath);
  revalidatePath("/");
  revalidatePath("/businesses");
  revalidatePath("/events");
  revalidatePath("/find");
  revalidatePath("/discover");
}

export async function saveMarketArea(marketId: string, id: string | null, formData: FormData) {
  const marketDetailPath = `/admin/markets/${marketId}`;
  const editPath = id ? `${marketDetailPath}/areas/${id}` : `${marketDetailPath}/areas/new`;
  const supabase = await requireAdminSupabase();

  const name = str(formData, "name");
  if (!name) {
    redirect(errorRedirectUrl(editPath, "Area Name is required."));
  }

  const baseSlug = resolveSlugInput(str(formData, "slug"), name);
  if (!baseSlug) {
    redirect(errorRedirectUrl(editPath, "Area Name is required to generate a slug."));
  }
  const slug = await ensureUniqueSlug(baseSlug, (candidate) => isMarketAreaSlugTaken(marketId, candidate, id ?? undefined));

  const sortOrder = num(formData, "sort_order");

  const payload = {
    market_id: marketId,
    name,
    slug,
    display_name: str(formData, "display_name"),
    aliases: parseAliases(str(formData, "aliases")),
    active: bool(formData, "active"),
    consumer_visible: bool(formData, "consumer_visible"),
    sort_order: sortOrder ?? 0,
  };

  const wasNew = !id;
  let areaId = id;
  if (areaId) {
    const { error } = await supabase.from("market_areas").update(payload).eq("id", areaId);
    if (error) redirect(errorRedirectUrl(editPath, error.message));
  } else {
    const { data, error } = await supabase.from("market_areas").insert(payload).select("id").single();
    if (error || !data) redirect(errorRedirectUrl(editPath, error?.message ?? "Could not create area."));
    areaId = data.id;
  }

  revalidateAreaConsumers(marketDetailPath);

  // Rapid Area entry — redirect back to this same Market's /areas/new route
  // (never a different Market) so the parent-Market context stays fixed
  // exactly as it was, with a fresh blank form via a normal GET and no
  // re-submit-on-refresh risk (see saveMarket's identical comment above).
  if (wasNew && str(formData, "intent") === "save_add_another") {
    redirect(`${marketDetailPath}/areas/new?created=1`);
  }
  redirect(`${marketDetailPath}/areas/${areaId}?saved=1`);
}
