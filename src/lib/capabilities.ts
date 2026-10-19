// Identity capabilities — what each acting identity may CREATE, reconciled
// with what the current schema can truthfully express. One User account;
// Personal is the consumer identity; Businesses and Locations are managed
// Pages (business_members / location_members). Events, Products, Where I'll
// Be and Moments are content published THROUGH an identity — never Pages.
// Pure (client + server). Server actions enforce the same rules.
//
// Not representable yet (each needs an additive migration — not done):
//   - a Location as an Event's managing Page (only events.host_business_id
//     exists): a Location-context Event is created by a verified Location
//     manager and managed through event_members;
//   - Location-owned Products (products.business_id is required);
//   - Location-authored Moments (journal_entries has author_business_id only).

export type ActingIdentity = "personal" | "business" | "location";

export type Creatable = "moment" | "business" | "location" | "child_location" | "event" | "product" | "where_ill_be" | "qr";

export const CAPABILITIES: Record<ActingIdentity, readonly Creatable[]> = {
  // Personal submits/claims Pages and writes Personal Moments — it never
  // publishes Page-owned commercial content as itself.
  personal: ["moment", "business", "location"],
  business: ["event", "product", "where_ill_be", "location", "moment", "qr"],
  location: ["event", "child_location"],
};

export function can(identity: ActingIdentity, what: Creatable): boolean {
  return CAPABILITIES[identity].includes(what);
}

/** Owner / Manager act for a Page; Staff don't create on its behalf. */
export function isPageManagerRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Where an Event may be created from: a Business the user hosts as
 * (owner/manager) or a Location they manage (owner/manager). Personal
 * alone never qualifies. */
export function eventCreationContext(input: {
  businessId: string | null;
  businessEligible: boolean;
  locationId: string | null;
  locationRole: string | null;
}): { ok: true; identity: "business" | "location" } | { ok: false; reason: "personal" | "business_role" | "location_role" } {
  if (input.businessId) return input.businessEligible ? { ok: true, identity: "business" } : { ok: false, reason: "business_role" };
  if (input.locationId) return isPageManagerRole(input.locationRole) ? { ok: true, identity: "location" } : { ok: false, reason: "location_role" };
  return { ok: false, reason: "personal" };
}

/** A non-Admin Location submission: whether the submitter asks to manage
 * it. Asking never grants management — it files a pending request. */
export type LocationIntent = "manage" | "adding";

export function parseLocationIntent(v: unknown): LocationIntent | null {
  return v === "manage" || v === "adding" ? v : null;
}
