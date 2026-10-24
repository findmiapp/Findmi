"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { classifyBrandInput, defaultBrandLookupDeps, lookupBrand } from "@/lib/brand-lookup";
import { isBrandLookupRateLimited } from "@/lib/brand-lookup-rate-limit";
import { businessManagementState } from "@/lib/moment-author";
import { businessMatchAction, businessMatchHref, isMeaningfulBusinessQuery, placeLabel, type BusinessLookupResult, type BusinessSearchCard } from "@/lib/business-name-search-domain";

/** Add Business — search existing first, as a Server Action (no JSON API
 * route: the settled Find Your Brand rule keeps the lookup out of
 * src/app/api and the matcher out of client code). It runs the SAME public
 * lookup /join/brand renders (lib/brand-lookup: deterministic matcher →
 * public matches only → anon re-read of approved display fields) and
 * returns only that narrow public card — logo, name, category, city/state
 * — plus the existing path for each card's management state
 * (lib/business-name-search-domain). Bounded (the lookup's own 5-card
 * cap), debounced by the caller, throttled per client with the lookup's
 * own rate limit. A non-public conflict is never described: a signed-in
 * viewer only learns one may exist (`possiblePrivateMatch`), exactly like
 * /join/brand's "assistance" state. */
export async function lookupExistingBusinesses(raw: unknown): Promise<BusinessLookupResult> {
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 200);
  if (!isMeaningfulBusinessQuery(q)) return { results: [], possiblePrivateMatch: false };
  const classified = classifyBrandInput(q, "name");
  if (!classified.ok) return { results: [], possiblePrivateMatch: false };
  if (await isBrandLookupRateLimited()) return { results: [], possiblePrivateMatch: false, rateLimited: true };

  const deps = defaultBrandLookupDeps();
  const admin = getAdminSupabase();
  if (!deps || !admin) return { results: [], possiblePrivateMatch: false };

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authenticated = Boolean(user);

  let result;
  try {
    result = await lookupBrand(classified, authenticated, deps);
  } catch {
    return { results: [], possiblePrivateMatch: false };
  }
  if (result.state === "none" || result.state === "assistance") {
    return { results: [], possiblePrivateMatch: result.state === "assistance" };
  }

  // Management state for the (already public) matches: id by slug, then
  // member / pending-claim counts — read-only, service-role, the same
  // existence checks /api/account/claim makes.
  const slugs = result.candidates.map((c) => c.slug);
  const { data: rows } = await admin.from("businesses").select("id, slug").in("slug", slugs);
  const idBySlug = new Map(((rows ?? []) as { id: string; slug: string }[]).map((r) => [r.slug, r.id]));
  const ids = [...idBySlug.values()];
  const [{ data: members }, { data: claims }] = await Promise.all([
    ids.length ? admin.from("business_members").select("business_id, user_id").in("business_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("business_claim_requests").select("business_id").in("business_id", ids).eq("status", "pending") : Promise.resolve({ data: [] }),
  ]);
  const memberRows = (members ?? []) as { business_id: string; user_id: string }[];
  const pendingIds = new Set(((claims ?? []) as { business_id: string }[]).map((c) => c.business_id));

  const results: BusinessSearchCard[] = result.candidates.flatMap((c) => {
    const id = idBySlug.get(c.slug);
    if (!id) return [];
    const forBiz = memberRows.filter((m) => m.business_id === id);
    const state = businessManagementState({ memberCount: forBiz.length, pendingClaimCount: pendingIds.has(id) ? 1 : 0 });
    const action = businessMatchAction(state, Boolean(user && forBiz.some((m) => m.user_id === user.id)));
    return [{ slug: c.slug, name: c.name, logoUrl: c.logoUrl, category: c.category, place: placeLabel(c.city, c.state), action, href: businessMatchHref(action, { id, slug: c.slug }, authenticated) }];
  });
  return { results, possiblePrivateMatch: false };
}
