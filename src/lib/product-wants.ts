import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WantSource } from "./product-wants-domain";

// Product Want / Demand — server data access. Every function degrades to
// "nothing wanted / zero demand" on a database error (e.g. before the
// product_wants migration is applied) rather than breaking a page.
//
// Identity: a signed-in person's Wants go through THEIR request-scoped
// client (RLS: own rows only). Signed-out email interest and aggregate
// counts go through the service-role client, called only from server code
// that has already validated the request. Businesses never receive rows —
// only getProductWantCounts' numbers.

export interface WantWriteContext {
  source: WantSource | null;
  sourceChannel: string | null;
}

/** Want / un-Want for a signed-in account. Idempotent: one row per
 * (product, user); un-Want sets removed_at, re-Want clears it. */
export async function setAccountWant(client: SupabaseClient, userId: string, productId: string, on: boolean, ctx: WantWriteContext): Promise<{ ok: boolean; wanted: boolean }> {
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await client
    .from("product_wants")
    .select("id, removed_at")
    .eq("product_id", productId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return { ok: false, wanted: false };
  if (existing) {
    const row = existing as { id: string; removed_at: string | null };
    const currentlyOn = row.removed_at == null;
    if (currentlyOn === on) return { ok: true, wanted: on };
    const { error } = await client.from("product_wants").update({ removed_at: on ? null : now, updated_at: now }).eq("id", row.id).eq("user_id", userId);
    return error ? { ok: false, wanted: currentlyOn } : { ok: true, wanted: on };
  }
  if (!on) return { ok: true, wanted: false };
  const { error } = await client.from("product_wants").insert({
    product_id: productId,
    user_id: userId,
    source: ctx.source,
    source_channel: ctx.sourceChannel,
  });
  // 23505: a concurrent tap already created it — still exactly one Want.
  if (error && error.code !== "23505") return { ok: false, wanted: false };
  return { ok: true, wanted: true };
}

/** Signed-out interest by (already normalized) email. Idempotent; a
 * previously removed row is reactivated. Never reports whether the email
 * was already known. */
export async function recordEmailWant(admin: SupabaseClient, productId: string, email: string, ctx: WantWriteContext): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await admin.from("product_wants").select("id, removed_at").eq("product_id", productId).eq("email", email).maybeSingle();
  if (readError) return false;
  if (existing) {
    const row = existing as { id: string; removed_at: string | null };
    if (row.removed_at == null) return true;
    const { error } = await admin.from("product_wants").update({ removed_at: null, updated_at: now }).eq("id", row.id);
    return !error;
  }
  const { error } = await admin.from("product_wants").insert({ product_id: productId, email, source: ctx.source, source_channel: ctx.sourceChannel });
  return !error || error.code === "23505";
}

/** The signed-in person's currently Wanted Product ids (optionally only
 * among `productIds`). Things I Want and every Want control read this. */
export async function getAccountWantedProductIds(client: SupabaseClient, userId: string, productIds?: readonly string[]): Promise<string[]> {
  let query = client.from("product_wants").select("product_id").eq("user_id", userId).is("removed_at", null);
  if (productIds) {
    if (productIds.length === 0) return [];
    query = query.in("product_id", [...productIds]);
  }
  const { data, error } = await query;
  if (error) return [];
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id);
}

export interface ProductDemand {
  wantCount: number;
  recentCount: number;
}

/** Aggregate demand per Product — counts only, never identities
 * (product_want_counts, service role only). Missing = zero. */
export async function getProductWantCounts(admin: SupabaseClient, productIds: readonly string[]): Promise<Map<string, ProductDemand>> {
  const out = new Map<string, ProductDemand>();
  if (productIds.length === 0) return out;
  const { data, error } = await admin.rpc("product_want_counts", { p_product_ids: [...new Set(productIds)] });
  if (error || !Array.isArray(data)) return out;
  for (const r of data as { product_id: string; want_count: number | string; recent_count: number | string }[]) {
    out.set(r.product_id, { wantCount: Number(r.want_count) || 0, recentCount: Number(r.recent_count) || 0 });
  }
  return out;
}
