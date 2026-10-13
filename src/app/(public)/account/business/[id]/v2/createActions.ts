/** B1/B2 — the ONE definition of every Business-scoped creation action:
 * label, icon and destination (always carrying this Business). Business
 * Home's Create on Findmi and the "+ Add" sheet (AddToPresence) both read
 * from here, so the same action can never drift in label, icon or route.
 *
 *   Where I'll Be          → Findmi Here's request-to-join composer
 *                            (?tab=findmi-here&compose=1, manual fallback)
 *   Host an Event          → /account/event/new?business_id= (validated
 *                            server-side: Owner/Manager of this Business)
 *   Add To Product Catalog → Products' Add Product panel (?tab=products&compose=1)
 *   At a Location          → Findmi Here's Locations add panel (?view=locations&add=1)
 *   Create A QR Code       → the Business QR creator (/qr/new)
 *   Add A Moment           → the canonical Moment composer, prefilled with
 *                            this Business (secondary — never a primary tile)
 *
 * Plain data, no imports: safe for both server and client components. */

export type BusinessCreateIcon = "compass" | "calendar" | "tag" | "pin" | "qr" | "moment";

export interface BusinessCreateAction {
  key: "where" | "event" | "product" | "location" | "qr" | "moment";
  label: string;
  href: string;
  icon: BusinessCreateIcon;
}

export function businessCreateActions(basePath: string, businessId: string) {
  const id = encodeURIComponent(businessId);
  return {
    where: { key: "where", label: "Where I’ll Be", href: `${basePath}?tab=findmi-here&compose=1`, icon: "compass" },
    event: { key: "event", label: "Host an Event", href: `/account/event/new?business_id=${id}`, icon: "calendar" },
    product: { key: "product", label: "Add To Product Catalog", href: `${basePath}?tab=products&compose=1`, icon: "tag" },
    location: { key: "location", label: "At a Location", href: `${basePath}?tab=findmi-here&view=locations&add=1`, icon: "pin" },
    qr: { key: "qr", label: "Create A QR Code", href: `${basePath}/qr/new`, icon: "qr" },
    moment: { key: "moment", label: "Add A Moment", href: `/my-world/journal/new?business=${id}`, icon: "moment" },
  } satisfies Record<BusinessCreateAction["key"], BusinessCreateAction>;
}

/** The five primary Create on Findmi actions, in order. */
export function createOnFindmiActions(basePath: string, businessId: string): BusinessCreateAction[] {
  const a = businessCreateActions(basePath, businessId);
  return [a.where, a.event, a.product, a.location, a.qr];
}
