// Business Home — MANAGEMENT CARDS (Findmi Consolidation pass). The Home's
// entry points are management destinations first, each with a separate
// creation action: "View All …" opens the place to manage existing records;
// "+ Add …" launches the canonical creation flow. Order is locked: Events,
// Locations, Products, QR Codes, Moments, Targets. Pure data — safe for
// server and client.
import { businessCreateActions, type BusinessCreateIcon } from "./createActions";
import { managerHref } from "@/lib/manager-links";

export type ManagementCardKey = "events" | "locations" | "products" | "qr" | "moments" | "targets";

export interface ManagementCard {
  key: ManagementCardKey;
  title: string;
  description: string;
  icon: BusinessCreateIcon | "target";
  /** Manage existing records (the card's primary destination). */
  viewHref: string;
  viewLabel: string;
  /** Launch the canonical creation flow. */
  addHref: string;
  addLabel: string;
}

export const MANAGEMENT_CARD_ORDER: ManagementCardKey[] = ["events", "locations", "products", "qr", "moments", "targets"];

export function managementCards(businessId: string): ManagementCard[] {
  const c = businessCreateActions(`/account/business/${businessId}`, businessId);
  const cards: Record<ManagementCardKey, ManagementCard> = {
    events: {
      key: "events",
      title: "Events",
      description: "Create, manage and promote your Events.",
      icon: "calendar",
      viewHref: managerHref(businessId, "findmi-here"),
      viewLabel: "View All Events",
      // "What Are You Adding?" — Hosting (quick create / import) or Appearing At.
      addHref: managerHref(businessId, "add-event"),
      addLabel: "Add Event",
    },
    locations: {
      key: "locations",
      title: "Locations",
      description: "Add and manage your locations and venues.",
      icon: "pin",
      viewHref: managerHref(businessId, "our-locations"),
      viewLabel: "View All Locations",
      // The ONE Add Location flow: search Findmi first, then create.
      addHref: `/account/location/new?business_id=${encodeURIComponent(businessId)}`,
      addLabel: "Add Location",
    },
    products: {
      key: "products",
      title: "Products",
      description: "Add products to your Findmi catalog.",
      icon: "tag",
      viewHref: managerHref(businessId, "products"),
      viewLabel: "View All Products",
      addHref: c.product.href,
      addLabel: "Add Product",
    },
    qr: {
      key: "qr",
      title: "QR Codes",
      description: "QR codes for Events, places, products and more.",
      icon: "qr",
      viewHref: managerHref(businessId, "qr"),
      viewLabel: "View All QR Codes",
      addHref: c.qr.href,
      addLabel: "Add QR Code",
    },
    moments: {
      key: "moments",
      title: "Moments",
      description: "Share what your Business is experiencing.",
      icon: "moment",
      viewHref: managerHref(businessId, "moments"),
      viewLabel: "View All Moments",
      addHref: c.moment.href,
      addLabel: "Add Moment",
    },
    targets: {
      key: "targets",
      title: "Targets",
      description: "Places and partners you’re aiming for.",
      icon: "target",
      viewHref: managerHref(businessId, "targets"),
      viewLabel: "View All Targets",
      addHref: managerHref(businessId, "add-target"),
      addLabel: "Add Target",
    },
  };
  return MANAGEMENT_CARD_ORDER.map((k) => cards[k]);
}
