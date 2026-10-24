// Business Home — Quick Actions: the highest-frequency things a Business owner
// starts from Home, one tap each. Every entry is an EXISTING creation flow
// (the same destinations the "+" sheet uses — ./createActions — plus Add
// Target), always carrying this Business, so no Business picker is ever
// needed. Pure data: safe for server and client.
import { businessCreateActions, type BusinessCreateIcon } from "./createActions";
import { managerHref } from "@/lib/manager-links";

export type QuickActionIcon = BusinessCreateIcon | "target";

export interface QuickAction {
  key: string;
  /** The short rail label. */
  label: string;
  /** What the action does, for screen readers. */
  ariaLabel: string;
  href: string;
  icon: QuickActionIcon;
}

/** In order: Events, catalog, tools, places, growth, publishing. ONE Event
 * action (Where I'll Be and Host an Event are no longer separate): it opens
 * Findmi Here → Events with "What Are You Adding?" — Hosting An Event or
 * Appearing At An Event — which routes into the existing workflow. */
export function businessQuickActions(businessId: string): QuickAction[] {
  const c = businessCreateActions(`/account/business/${businessId}`, businessId);
  return [
    { key: "event", label: "Event", ariaLabel: "Add an Event — hosting or appearing at", href: managerHref(businessId, "add-event"), icon: "calendar" },
    { key: "product", label: "Product", ariaLabel: "Add a Product", href: c.product.href, icon: "tag" },
    { key: "qr", label: "QR Code", ariaLabel: "Create a QR Code", href: c.qr.href, icon: "qr" },
    { key: "location", label: "Location", ariaLabel: "Add a Location", href: c.location.href, icon: "pin" },
    { key: "target", label: "Target", ariaLabel: "Add a Target", href: managerHref(businessId, "add-target"), icon: "target" },
    { key: "moment", label: "Moment", ariaLabel: "Add a Moment", href: c.moment.href, icon: "moment" },
  ];
}
