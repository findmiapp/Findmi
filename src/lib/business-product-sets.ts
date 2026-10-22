import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_SET_MAX_PER_BUSINESS, validateProductSet, type ProductSet, type ProductSetInput } from "./business-product-sets-domain";

/** Owner-side Product Sets (see business-product-sets-domain.ts and migration
 * 20261101000000). Service-role client only; the caller authorizes the
 * Business first. Fails safe before the migration exists: reads return
 * { available: false }, writes return a friendly error — nothing throws. */

export type ProductSetResult = { ok: true; id?: string } | { ok: false; error: string };

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/.test(e.message ?? "")));
const UNAVAILABLE = "Product Sets aren’t available yet. Please try again soon.";

export async function getProductSets(admin: SupabaseClient, businessId: string): Promise<{ available: boolean; sets: ProductSet[] }> {
  const { data, error } = await admin
    .from("business_product_sets")
    .select("id, name, business_product_set_items(product_id)")
    .eq("business_id", businessId)
    .order("name");
  if (error) {
    if (!missingTable(error)) console.error("getProductSets failed:", error.message);
    return { available: false, sets: [] };
  }
  type Row = { id: string; name: string; business_product_set_items: { product_id: string }[] | null };
  return {
    available: true,
    sets: ((data ?? []) as unknown as Row[]).map((r) => ({ id: r.id, name: r.name, productIds: (r.business_product_set_items ?? []).map((i) => i.product_id) })),
  };
}

async function ownedProducts(admin: SupabaseClient, businessId: string, productIds: string[]): Promise<boolean> {
  const { data } = await admin.from("products").select("id").eq("business_id", businessId).in("id", productIds);
  return ((data ?? []) as unknown[]).length === productIds.length;
}

export async function createProductSet(admin: SupabaseClient, businessId: string, input: ProductSetInput): Promise<ProductSetResult> {
  const checked = validateProductSet(input);
  if (!checked.ok) return checked;
  const { name, productIds } = checked.value;
  if (!(await ownedProducts(admin, businessId, productIds))) return { ok: false, error: "One of those products isn't part of your catalog." };
  const { count } = await admin.from("business_product_sets").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  if ((count ?? 0) >= PRODUCT_SET_MAX_PER_BUSINESS) return { ok: false, error: `You can keep up to ${PRODUCT_SET_MAX_PER_BUSINESS} Product Sets.` };
  const { data, error } = await admin.from("business_product_sets").insert({ business_id: businessId, name }).select("id").single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "You already have a set with that name." };
    if (missingTable(error)) return { ok: false, error: UNAVAILABLE };
    console.error("createProductSet failed:", error?.message);
    return { ok: false, error: "Couldn't save that set. Please try again." };
  }
  const { error: itemError } = await admin.from("business_product_set_items").insert(productIds.map((product_id) => ({ set_id: data.id, product_id })));
  if (itemError) {
    await admin.from("business_product_sets").delete().eq("id", data.id);
    return { ok: false, error: "Couldn't save that set. Please try again." };
  }
  return { ok: true, id: data.id };
}

/** Rename and/or replace the Products of one set (scoped by business_id). */
export async function updateProductSet(admin: SupabaseClient, businessId: string, setId: string, input: ProductSetInput): Promise<ProductSetResult> {
  const checked = validateProductSet(input);
  if (!checked.ok) return checked;
  const { name, productIds } = checked.value;
  if (!(await ownedProducts(admin, businessId, productIds))) return { ok: false, error: "One of those products isn't part of your catalog." };
  const { data: existing, error: readError } = await admin.from("business_product_sets").select("id").eq("id", setId).eq("business_id", businessId).maybeSingle();
  if (readError) return { ok: false, error: missingTable(readError) ? UNAVAILABLE : "Couldn't load that set." };
  if (!existing) return { ok: false, error: "That set wasn't found." };
  const { error } = await admin.from("business_product_sets").update({ name }).eq("id", setId).eq("business_id", businessId);
  if (error) return { ok: false, error: error.code === "23505" ? "You already have a set with that name." : "Couldn't save that set. Please try again." };
  const { data: before } = await admin.from("business_product_set_items").select("product_id").eq("set_id", setId);
  const { error: clearError } = await admin.from("business_product_set_items").delete().eq("set_id", setId);
  if (clearError) return { ok: false, error: "Couldn't save that set. Please try again." };
  const { error: itemError } = await admin.from("business_product_set_items").insert(productIds.map((product_id) => ({ set_id: setId, product_id })));
  if (itemError) {
    const old = ((before ?? []) as { product_id: string }[]).map((r) => ({ set_id: setId, product_id: r.product_id }));
    if (old.length > 0) await admin.from("business_product_set_items").insert(old);
    return { ok: false, error: "Couldn't save that set. Please try again." };
  }
  return { ok: true, id: setId };
}

export async function deleteProductSet(admin: SupabaseClient, businessId: string, setId: string): Promise<ProductSetResult> {
  const { data, error } = await admin.from("business_product_sets").delete().eq("id", setId).eq("business_id", businessId).select("id");
  if (error) return { ok: false, error: missingTable(error) ? UNAVAILABLE : "Couldn't delete that set." };
  if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "That set wasn't found." };
  return { ok: true };
}
