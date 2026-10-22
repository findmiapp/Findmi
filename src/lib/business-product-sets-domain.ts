/** Findmi Here — Product Sets: a Business's saved, named groups of its OWN
 * Products ("Tabli Core Assortment"). A Set is a convenience/template layer
 * only: applying one to a place fills in the Products selection, and the
 * entry still saves the actual Products (business_location_availability_
 * products) — public queries never read a Set. Pure vocabulary/validation,
 * shared by the owner UI, the server actions and tests. */

export const PRODUCT_SET_NAME_MAX = 60;
export const PRODUCT_SET_PRODUCT_MAX = 200;
export const PRODUCT_SET_MAX_PER_BUSINESS = 50;

export interface ProductSet {
  id: string;
  name: string;
  productIds: string[];
}

export type ProductSetInput = { name: string; productIds: readonly string[] };
export type ProductSetValidation = { ok: true; value: { name: string; productIds: string[] } } | { ok: false; error: string };

export function validateProductSet(input: ProductSetInput): ProductSetValidation {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Name this Product Set." };
  if (name.length > PRODUCT_SET_NAME_MAX) return { ok: false, error: `Keep the name under ${PRODUCT_SET_NAME_MAX} characters.` };
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  if (productIds.length === 0) return { ok: false, error: "Choose at least one Product for this set." };
  if (productIds.length > PRODUCT_SET_PRODUCT_MAX) return { ok: false, error: `A set can hold up to ${PRODUCT_SET_PRODUCT_MAX} Products.` };
  return { ok: true, value: { name, productIds } };
}

/** Applying a set to a selection = union (the owner can then adjust it for
 * this one place). A set already fully selected toggles back off. */
export function applyProductSet(selected: readonly string[], set: Pick<ProductSet, "productIds">): string[] {
  const have = new Set(selected);
  const fully = set.productIds.length > 0 && set.productIds.every((id) => have.has(id));
  if (fully) {
    const drop = new Set(set.productIds);
    return selected.filter((id) => !drop.has(id));
  }
  return [...new Set([...selected, ...set.productIds])];
}

export const isProductSetFullySelected = (selected: readonly string[], set: Pick<ProductSet, "productIds">): boolean => {
  const have = new Set(selected);
  return set.productIds.length > 0 && set.productIds.every((id) => have.has(id));
};
