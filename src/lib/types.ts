export type MembershipStatus = "lead" | "active" | "past_due" | "canceled";
export type LeadStatus =
  | "new"
  | "contacted"
  | "onboarding"
  | "qualified"
  | "not_a_fit";
export type ProductType = "product" | "service";
export type AppearanceStatus = "confirmed" | "tentative" | "canceled";
export type InquiryStatus = "new" | "contacted" | "booked" | "closed";

export type ProcessingFeePayer = "vendor" | "customer";
export type PayoutMethod = "manual" | "stripe_connect_future";
export type FulfillmentMethod = "shipping" | "local_delivery" | "pickup" | "event_pickup";

// Membership / onboarding — see lib/admin/membership-queries.ts. Kept as
// three separate statuses on purpose: a paid membership can be
// onboarding-incomplete and still non-public (publication_status stays
// draft/pending_review until founder approval).
export type BillingStatus = "comped" | "pending_payment" | "paid" | "past_due" | "cancelled";
export type OnboardingStatus = "not_started" | "incomplete" | "submitted" | "approved";
export type PublicationStatus = "draft" | "pending_review" | "live" | "paused" | "rejected";

export interface Business {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  service_radius_miles: number | null;
  verified: boolean;
  founding_member: boolean;
  membership_status: MembershipStatus;
  lead_status: LeadStatus;
  created_at: string;
  updated_at: string;
  // Commerce defaults — see lib/commerce/fees.ts for how these combine
  // with product-level overrides. Off by default so no existing business
  // suddenly presents purchase UI (see commerce_enabled).
  commerce_enabled: boolean;
  marketplace_fee_percent: number;
  processing_fee_payer: ProcessingFeePayer;
  payout_method: PayoutMethod;
  stripe_account_id: string | null;
  stripe_connect_status: string | null;
  // Publication gate — separate from is_demo (which hides seed/test
  // content). A real business created via membership onboarding stays
  // non-public until a founder approves it, regardless of payment status.
  publication_status: PublicationStatus;
}

export interface Market {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  sort_order: number;
}

export interface MembershipPlan {
  id: string;
  name: string;
  slug: string;
  annual_price: number;
  active: boolean;
  publicly_available: boolean;
  market_limit: number | null; // null = unlimited
  description: string | null;
  sort_order: number;
  featured_placement_eligible: boolean;
  enhanced_profile: boolean;
  campaign_eligible: boolean;
}

export interface Membership {
  id: string;
  business_id: string | null;
  plan_id: string | null;
  billing_status: BillingStatus;
  onboarding_status: OnboardingStatus;
  publication_status: PublicationStatus;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  intended_business_name: string | null;
  existing_business_id: string | null;
  started_at: string | null;
  renews_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  founding_price_locked: boolean;
  admin_notes: string | null;
  invite_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  show_on_home?: boolean;
  home_sort_order?: number | null;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  price: number | null;
  price_label: string | null;
  product_type: ProductType;
  external_purchase_url: string | null;
  is_featured: boolean;
  is_active: boolean;
  // Commerce — off by default (see purchasable). When false, the product
  // keeps its existing inquiry/external-link behavior unchanged.
  purchasable: boolean;
  inventory_status: "in_stock" | "out_of_stock" | null;
  marketplace_fee_override_percent: number | null;
  processing_fee_payer_override: ProcessingFeePayer | null;
}

export interface ProductFulfillmentOption {
  id: string;
  product_id: string;
  method: FulfillmentMethod;
  price: number;
  enabled: boolean;
  appearance_id: string | null;
}

export interface FindmiEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  organizer_name: string | null;
  external_url: string | null;
  is_featured: boolean;
  // Configurable consumer actions — each _enabled flag gates whether its
  // button/link appears at all; the public event page never renders a
  // disabled or destination-less action.
  follow_enabled: boolean;
  rsvp_enabled: boolean;
  rsvp_url: string | null;
  tickets_enabled: boolean;
  tickets_url: string | null;
  vendor_applications_enabled: boolean;
  vendor_application_url: string | null;
  vendor_application_deadline: string | null;
  contact_enabled: boolean;
  organizer_email: string | null;
  contact_url: string | null;
  directions_enabled: boolean;
}

export type EventParticipationStatus =
  | "invited"
  | "applied"
  | "pending"
  | "approved"
  | "declined";

export interface Appearance {
  id: string;
  business_id: string;
  event_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  status: AppearanceStatus;
  is_featured: boolean;
}

export interface BusinessWithCategories extends Business {
  categories: Category[];
}

export interface FindmiLocation {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}
