// Business Product Catalog — the ONE rule for whether a Product is publicly
// visible as discovery content: its Business profile, its own page, Event /
// Appearance context, a person's Saved / Things I Want. Pure (server, client,
// tests).
//
// Catalog visibility is deliberately independent of commerce: it NEVER looks
// at purchasable, marketplace_status or checkout configuration. A Product
// that can't be bought through Findmi (catalog only, Marketplace pending,
// rejected, approved-but-not-purchasable) is still a public catalog Product
// when it is active, content-approved ("live") and not archived / trashed,
// and its Business is live and real. The Marketplace rule
// (lib/commerce/marketplace-eligibility.ts) is this rule PLUS approval PLUS
// commerce readiness — never a different notion of "public".
//
// The products RLS policy ("Public read active products") enforces the same
// Product half for anon/authenticated readers; queries also apply it
// explicitly (applyCatalogProductFilter) so service-role reads and limit()
// counts agree with it.

export interface CatalogProductFields {
  is_active?: boolean | null;
  moderation_status?: string | null;
  archived_at?: string | null;
  trashed_at?: string | null;
}

export interface CatalogBusinessFields {
  is_demo?: boolean | null;
  publication_status?: string | null;
}

/** The Product half: active, content-approved, not archived / trashed. */
export function isCatalogProductPublic(product: CatalogProductFields): boolean {
  return product.is_active === true && (product.moderation_status ?? "live") === "live" && !product.archived_at && !product.trashed_at;
}

/** The Business half: a live, non-demo Business. */
export function isCatalogBusinessPublic(business: CatalogBusinessFields | null | undefined): boolean {
  return Boolean(business) && business!.is_demo !== true && (business!.publication_status ?? "live") === "live";
}

export function isCatalogVisible(product: CatalogProductFields, business: CatalogBusinessFields | null | undefined): boolean {
  return isCatalogProductPublic(product) && isCatalogBusinessPublic(business);
}

/** The database form of the Product half. `query` is any PostgREST filter
 * builder on `products`. */
export function applyCatalogProductFilter(query: any): any {
  return query.eq("is_active", true).eq("moderation_status", "live").is("archived_at", null).is("trashed_at", null);
}
