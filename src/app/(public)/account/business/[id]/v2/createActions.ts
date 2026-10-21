/** The ONE definition of every Business-scoped creation action: label,
 * descriptions, icon and destination (always carrying this Business).
 * Business Home's compact Quick Create and the Business "+" sheet
 * (AddToPresence) both read from here, so the same action can never drift
 * in wording, icon or route. Order is intentional — presence (Where I'll
 * Be, Host an Event), Business content (Location, Product), publishing /
 * tooling (Moment, QR):
 *
 *   Where I'll Be          → Findmi Here's request-to-join composer
 *                            (?tab=findmi-here&compose=1, manual fallback)
 *   Host an Event          → /account/event/new?business_id= (validated
 *                            server-side: Owner/Manager of this Business)
 *   At a Location          → Findmi Here's Locations add panel (?view=locations&add=1)
 *   Add To Product Catalog → Products' Add Product panel (?tab=products&compose=1)
 *   Add a Moment           → the existing Moment composer, posted as this
 *                            Business (/my-world/journal/new?business=&postAs=)
 *   Create A QR Code       → the Business QR creator (/qr/new)
 *
 * Owner-facing labels follow the product owner's Account revision: never
 * "Appearance" as a creation label (that stays the internal entity).
 *
 * Locked Business-facing distinction (UX vocabulary only — the internal
 * Event / Appearance domain is unchanged):
 *   Where I'll Be = something SOMEONE ELSE organizes that this Business is
 *                   PARTICIPATING in (festival, market, sampling, trade
 *                   show, demo, pop-up…).
 *   Host an Event = an Event this Business is ORGANIZING / hosting.
 * The upcoming Event Import keeps this contract: entering from Where I'll
 * Be starts as participation; from Host an Event, as hosting.
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
      description: "Add something your Business is participating in.",
      detail: "Add a festival, market, retailer sampling, trade show, pop-up or other event your Business is participating in.",
      href: `${basePath}?tab=findmi-here&compose=1`,
      icon: "compass",
    },
    event: {
      key: "event",
      label: "Host an Event",
      description: "Create something your Business is organizing.",
      detail: "Create an activation, pop-up, tasting, class, launch or other Event your Business is organizing.",
      href: `/account/event/new?business_id=${id}`,
      icon: "calendar",
    },
    location: {
      key: "location",
      label: "At a Location",
      description: "Add a place customers can regularly find your Business.",
      detail: "A store, café, showroom, venue or office where customers can regularly find your Business.",
      href: `${basePath}?tab=findmi-here&view=locations&add=1`,
      icon: "pin",
    },
    product: {
      key: "product",
      label: "Add To Product Catalog",
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
      href: `/my-world/journal/new?business=${id}&postAs=${id}`,
      icon: "moment",
    },
    qr: {
      key: "qr",
      label: "Create A QR Code",
      description: "Create a trackable QR code for your Business or campaign.",
      detail: "A trackable QR code for your Business, a product, an Event or a campaign.",
      href: `${basePath}/qr/new`,
      icon: "qr",
    },
  };
}

/** Every Business creation action SHOWN in the full "+" Create sheet, in the
 * intentional order. "Add a Moment" is one of them: Moments also have their
 * own Business Manager tab, but a tab is a place to browse and manage, not a
 * replacement for global creation — the sheet routes into the same existing
 * Moment composer (no second composer). Business Home's compact Quick Create
 * is a separate, smaller selection of these (see BusinessHome.tsx). */
export const BUSINESS_CREATE_ORDER: BusinessCreateKey[] = ["where", "event", "location", "product", "moment", "qr"];

export function orderedCreateActions(basePath: string, businessId: string): BusinessCreateAction[] {
  const a = businessCreateActions(basePath, businessId);
  return BUSINESS_CREATE_ORDER.map((k) => a[k]);
}
