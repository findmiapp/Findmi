// Opportunities V1 — the canonical, dependency-free domain rules for
// Findmi-authored commercial Opportunities (opportunity_listings) and their
// per-Business recipients (opportunity_recipients).
//
// NOT to be confused with src/lib/opportunities.ts, which is the EVENT
// PARTICIPATION workflow (Event invitations/applications, table
// public.opportunities). The two systems share no statuses or tables.
//
// This module has no imports on purpose: it is safe for server and client
// code alike, and testable directly (tests/opportunity-listings.test.mjs).
// Every value list here mirrors a CHECK constraint in
// supabase/migrations/20261006044707_opportunity_listings_v1.sql — change
// both together.

// ---------------------------------------------------------------- types

export const OPPORTUNITY_TYPES = [
  "activation",
  "sampling_demo",
  "vending",
  "sponsorship",
  "content",
  "partnership",
  "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  activation: "Activation",
  sampling_demo: "Sampling & Demo",
  vending: "Vending",
  sponsorship: "Sponsorship",
  content: "Content",
  partnership: "Partnership",
  other: "Opportunity",
};

export const LISTING_STATUSES = ["draft", "open", "closed", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const RECIPIENT_STATUSES = [
  "offered",
  "interested",
  "not_interested",
  "confirmed",
  "completed",
  "cancelled",
  "withdrawn",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const PRICING_MODES = ["fixed", "starting_at", "complimentary", "custom"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

const isOneOf =
  <T extends string>(list: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (list as readonly string[]).includes(value);

export const isOpportunityType = isOneOf(OPPORTUNITY_TYPES);
export const isListingStatus = isOneOf(LISTING_STATUSES);
export const isRecipientStatus = isOneOf(RECIPIENT_STATUSES);
export const isPricingMode = isOneOf(PRICING_MODES);

// ---------------------------------------------------------------- pricing

export interface PricingInput {
  pricing_mode: PricingMode;
  price_cents: number | null;
  credits_eligible: boolean;
}

/** Same rules as the database CHECKs, as a friendly message for forms.
 * Returns null when valid. */
export function validatePricing(input: PricingInput): string | null {
  const { pricing_mode, price_cents, credits_eligible } = input;
  if (!isPricingMode(pricing_mode)) return "Choose a pricing mode.";
  const needsAmount = pricing_mode === "fixed" || pricing_mode === "starting_at";
  if (needsAmount) {
    if (price_cents == null || !Number.isInteger(price_cents) || price_cents <= 0) return "Enter a price greater than $0.";
  } else if (price_cents != null) {
    return pricing_mode === "complimentary" ? "A complimentary Opportunity has no price." : "A custom-priced Opportunity has no fixed amount.";
  }
  if (credits_eligible && pricing_mode === "complimentary") return "A complimentary Opportunity can't be Opportunity Credit eligible.";
  return null;
}

/** "$750" / "Starting at $1,500" / "Complimentary" / "Contact Findmi".
 * Whole-dollar amounts drop the cents. */
export function formatOpportunityPrice(listing: { pricing_mode: PricingMode; price_cents: number | null; currency: string }): string {
  if (listing.pricing_mode === "complimentary") return "Complimentary";
  if (listing.pricing_mode === "custom" || listing.price_cents == null) return "Contact Findmi";
  const amount = listing.price_cents / 100;
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: listing.currency || "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return listing.pricing_mode === "starting_at" ? `Starting at ${money}` : money;
}

// ---------------------------------------------------------------- business responses

/** The only statuses a Business can choose, through Findmi. */
export const BUSINESS_RESPONSE_STATUSES = ["interested", "not_interested"] as const;
export type BusinessResponseStatus = (typeof BUSINESS_RESPONSE_STATUSES)[number];

/** Statuses from which a Business may still (re)answer — i.e. the
 * relationship hasn't moved into a Findmi-controlled outcome. */
const BUSINESS_ANSWERABLE: readonly RecipientStatus[] = ["offered", "interested", "not_interested"];

export type BusinessResponseRole = "owner" | "manager" | "staff";

export type ResponseCheck = { ok: true } | { ok: false; reason: string };

/** Canonical rule for a Business-originated response (the library and any
 * future server action both go through this):
 *   - owner/manager only (staff may view, never respond);
 *   - not via an admin Manage-As session (Findmi uses Admin status
 *     controls instead, so a Business response is never fabricated);
 *   - the listing is open;
 *   - the relationship is still offered/interested/not_interested;
 *   - the new status is interested/not_interested and actually changes.
 * offered->interested, offered->not_interested, not_interested->interested
 * and interested->not_interested are therefore the allowed moves. */
export function checkBusinessResponse(args: {
  role: BusinessResponseRole;
  viaAdmin?: boolean;
  listingStatus: ListingStatus;
  currentStatus: RecipientStatus;
  nextStatus: string;
}): ResponseCheck {
  if (args.viaAdmin) return { ok: false, reason: "Findmi admins update Opportunities from Admin, not by responding as the Business." };
  if (args.role !== "owner" && args.role !== "manager") return { ok: false, reason: "Only an owner or manager can respond to this Opportunity." };
  if (args.listingStatus !== "open") return { ok: false, reason: "This Opportunity is no longer taking responses." };
  if (!BUSINESS_ANSWERABLE.includes(args.currentStatus)) return { ok: false, reason: "Findmi is already handling this Opportunity with you." };
  if (args.nextStatus !== "interested" && args.nextStatus !== "not_interested") return { ok: false, reason: "That response isn't available." };
  if (args.nextStatus === args.currentStatus) return { ok: false, reason: "That's already your response." };
  return { ok: true };
}

// ---------------------------------------------------------------- admin transitions

/** Findmi-controlled moves (Admin). These never set responded_at /
 * responded_by_user_id — those only ever record a real Business response.
 * Reverts are included so an operator can correct a mistake. */
export const ADMIN_TRANSITIONS: Record<RecipientStatus, readonly RecipientStatus[]> = {
  offered: ["confirmed", "withdrawn"],
  interested: ["confirmed", "cancelled"],
  not_interested: ["withdrawn"],
  confirmed: ["completed", "cancelled", "interested"],
  completed: ["confirmed"],
  cancelled: ["confirmed"],
  withdrawn: ["offered"],
};

export function canAdminTransition(from: RecipientStatus, to: RecipientStatus): boolean {
  return ADMIN_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------- visibility

export type BusinessVisibility = "active" | "past" | "hidden";

const HISTORICAL_OUTCOMES: readonly RecipientStatus[] = ["not_interested", "confirmed", "completed", "cancelled"];

/** THE canonical rule for what a Business sees, given ITS OWN recipient
 * row (a row only exists once Findmi sent the Opportunity — offered_at is
 * always set). The caller must already have scoped to the Business.
 *
 *   hidden  — draft listing (never, regardless of recipient rows);
 *             withdrawn recipient;
 *             archived listing whose relationship never reached an outcome
 *             (offered/interested) — archiving is housekeeping, not a leak.
 *   active  — listing open and offered/interested/confirmed;
 *             a confirmed relationship stays active on a closed listing
 *             (it's still a live commitment).
 *   past    — not_interested/completed/cancelled on an open or closed
 *             listing; offered/interested on a closed listing (no longer
 *             answerable); and on an ARCHIVED listing, any real outcome
 *             (not_interested/confirmed/completed/cancelled) — archiving
 *             never erases a Business's legitimate history. */
export function getBusinessVisibility(listingStatus: ListingStatus, recipientStatus: RecipientStatus): BusinessVisibility {
  if (listingStatus === "draft" || recipientStatus === "withdrawn") return "hidden";
  if (listingStatus === "archived") return HISTORICAL_OUTCOMES.includes(recipientStatus) ? "past" : "hidden";
  if (recipientStatus === "confirmed") return "active";
  if (listingStatus === "open" && (recipientStatus === "offered" || recipientStatus === "interested")) return "active";
  return "past";
}
