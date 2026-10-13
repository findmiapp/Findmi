/** The ONE definition of every Business-scoped creation action: label,
 * descriptions, icon and destination (always carrying this Business).
 * Business Home's Create on Findmi rail and the Business "+" sheet
 * (AddToPresence) both read from here, so the same action can never drift
 * in wording, icon or route. Order is intentional — presence (Where I'll
 * Be, Host an Event), Business content (Location, Product), publishing /
 * tooling (Moment, QR):
 *
 *   Where I'll Be    → Findmi Here's request-to-join composer
 *                      (?tab=findmi-here&compose=1, manual fallback)
 *   Host an Event    → /account/event/new?business_id= (validated
 *                      server-side: Owner/Manager of this Business)
 *   Add a Location   → Findmi Here's Locations add panel (?view=locations&add=1)
 *   Add a Product    → Products' Add Product panel (?tab=products&compose=1)
 *   Add a Moment     → the canonical Moment composer, prefilled with this Business
 *   Create a QR Code → the Business QR creator (/qr/new)
 *
 * `description` is the one short line on Home; `detail` is the richer
 * line the "+" sheet shows. Both describe the owner's outcome, never
 * Findmi's internal records. Plain data, no imports: safe for server and
 * client components. */

export type BusinessCreateIcon = "compass" | "calendar" | "pin" | "tag" | "moment" | "qr";

export type BusinessCreateKey = "where" | "event" | "location" | "product" | "moment" | "qr";

export interface BusinessCreateAction {
  key: BusinessCreateKey;
  label: string;
  description: string;
  detail: string;
  href: string;
  icon: BusinessCreateIcon;
}

export function businessCreateActions(basePath: string, businessId: string): Record<BusinessCreateKey, BusinessCreateAction> {
  const id = encodeURIComponent(businessId);
  return {
    where: {
      key: "where",
      label: "Where I’ll Be",
      description: "Tell people where they can find you in person.",
      detail: "Markets, pop-ups, sampling, festivals, trade shows, retailers — wherever people can find you in person.",
      href: `${basePath}?tab=findmi-here&compose=1`,
      icon: "compass",
    },
    event: {
      key: "event",
      label: "Host an Event",
      description: "Create something your Business is organizing.",
      detail: "An activation, pop-up, tasting, class, launch or Event your Business is organizing.",
      href: `/account/event/new?business_id=${id}`,
      icon: "calendar",
    },
    location: {
      key: "location",
      label: "Add a Location",
      description: "Add a place customers can regularly find your Business.",
      detail: "A store, café, showroom, venue or office where customers can regularly find your Business.",
      href: `${basePath}?tab=findmi-here&view=locations&add=1`,
      icon: "pin",
    },
    product: {
      key: "product",
      label: "Add a Product",
      description: "Add something people can discover from your Business.",
      detail: "Something you make, sell or offer, so people can discover it from your Business.",
      href: `${basePath}?tab=products&compose=1`,
      icon: "tag",
    },
    moment: {
      key: "moment",
      label: "Add a Moment",
      description: "Document something your Business experienced.",
      detail: "Document something your Business experienced.",
      href: `/my-world/journal/new?business=${id}`,
      icon: "moment",
    },
    qr: {
      key: "qr",
      label: "Create a QR Code",
      description: "Create a trackable QR code for your Business or campaign.",
      detail: "A trackable QR code for your Business, a product, an Event or a campaign.",
      href: `${basePath}/qr/new`,
      icon: "qr",
    },
  };
}

/** Every Business creation action, in the intentional order. */
export const BUSINESS_CREATE_ORDER: BusinessCreateKey[] = ["where", "event", "location", "product", "moment", "qr"];

export function orderedCreateActions(basePath: string, businessId: string): BusinessCreateAction[] {
  const a = businessCreateActions(basePath, businessId);
  return BUSINESS_CREATE_ORDER.map((k) => a[k]);
}
