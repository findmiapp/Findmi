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

/** In order: presence, hosting, catalog, tools, places, growth, publishing. */
export function businessQuickActions(businessId: string): QuickAction[] {
  const c = businessCreateActions(`/account/business/${businessId}`, businessId);
  return [
    { key: "where", label: "Where I’ll Be", ariaLabel: "Add Where I’ll Be", href: c.where.href, icon: "compass" },
    { key: "event", label: "Event", ariaLabel: "Host an Event", href: c.event.href, icon: "calendar" },
    { key: "product", label: "Product", ariaLabel: "Add a Product", href: c.product.href, icon: "tag" },
    { key: "qr", label: "QR Code", ariaLabel: "Create a QR Code", href: c.qr.href, icon: "qr" },
    { key: "location", label: "Location", ariaLabel: "Add a Location", href: c.location.href, icon: "pin" },
    { key: "target", label: "Target", ariaLabel: "Add a Target", href: managerHref(businessId, "add-target"), icon: "target" },
    { key: "moment", label: "Moment", ariaLabel: "Add a Moment", href: c.moment.href, icon: "moment" },
  ];
}
