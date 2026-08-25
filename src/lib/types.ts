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

// Founder Form Manager — see lib/forms.ts. Tally remains the form engine;
// this just lets the founder repoint which Tally URL each FindMi action
// uses, without a code change. FormPurpose enumerates every action that
// can be form-driven; FormEntityType is what a specific assignment can
// override the global default for.
export type FormPurpose =
  | "vendor_onboarding"
  | "business_inquiry"
  | "product_inquiry"
  | "booking"
  | "rsvp"
  | "vendor_application"
  | "contact_organizer";
export type FormProvider = "tally";
export type FormDisplayMode = "embed" | "external";
export type FormEntityType = "business" | "event" | "product";

export interface FindmiForm {
  id: string;
  name: string;
  slug: string;
  purpose: FormPurpose;
  provider: FormProvider;
  form_url: string;
  display_mode: FormDisplayMode;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormAssignment {
  id: string;
  form_id: string;
  entity_type: FormEntityType;
  entity_id: string;
  purpose: FormPurpose;
  created_at: string;
}

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
  // Editorial "Featured Brands" flag — separate from founding_member (a
  // billing/historical concept). Backfilled from founding_member so
  // today's featured-brand set is unchanged; founder curates from here on.
  is_featured: boolean;
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
  // Business Profile + Event Detail V2 polish pass, item 4 — an optional
  // direct external URL for the primary Inquire action, with its own
  // label. Checked ahead of the existing Form Manager/Tally resolution
  // (lib/forms.ts's resolveBusinessInquiryForm) — null/empty falls through
  // to that unchanged existing behavior.
  inquiry_cta_label: string | null;
  inquiry_cta_url: string | null;
  // Item 5 — up to three additional, independently toggleable CTA buttons
  // below the profile description. Flat per-slot columns, same convention
  // as events' own fixed action slots (tickets_url/rsvp_url/etc).
  cta_1_label: string | null;
  cta_1_url: string | null;
  cta_1_enabled: boolean;
  cta_2_label: string | null;
  cta_2_url: string | null;
  cta_2_enabled: boolean;
  cta_3_label: string | null;
  cta_3_url: string | null;
  cta_3_enabled: boolean;
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
  // Founder-controlled homepage/marketplace placement order among
  // is_featured products — null sorts last, then by name.
  home_sort_order: number | null;
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
  // Founder-controlled ordering among is_featured events — null sorts
  // last (still featured, just after explicitly ordered ones).
  featured_sort_order: number | null;
  // Event Detail V2 polish pass, item 15 — optional override for the
  // "Featured at This Event" product carousel's heading. Null falls back
  // to the hardcoded default, same pattern as site_sections overrides.
  featured_products_heading: string | null;
}

export interface EventWithCategories extends FindmiEvent {
  categories: Category[];
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
  // Brand bulletin (Part 3F) — a founder-written "here's what's happening"
  // line for this appearance. show_on_home gates homepage placement
  // explicitly; not every appearance should flood the homepage.
  bulletin_text: string | null;
  show_on_home: boolean;
  home_sort_order: number | null;
}

export interface BusinessWithCategories extends Business {
  categories: Category[];
}

// Founder Site Editor (additive) — presentation overrides for existing
// public page sections. Never controls WHICH entity records appear (see
// products.is_featured, events.is_featured, appearances.show_on_home,
// businesses.is_featured) — only a section's own heading/CTA/visibility/
// order. Any field left null falls back to the section's hardcoded
// default; a missing row falls back entirely.
export interface SiteSection {
  id: string;
  page_key: string;
  section_key: string;
  eyebrow: string | null;
  heading: string | null;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  is_visible: boolean;
  sort_order: number;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

// People — founders, owners, makers, chefs, creators, operators. An
// independent entity, many-to-many with businesses via business_people
// (see lib/admin/people-queries.ts). "Public Figure" and similar are
// editorial framing around a Person, never a separate table.
export interface Person {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  short_bio: string | null;
  location: string | null;
  instagram_url: string | null;
  website_url: string | null;
  is_public: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessPersonLink {
  business_id: string;
  person_id: string;
  role: string | null;
  display_order: number | null;
  featured: boolean;
  show_on_business: boolean;
}

export interface PersonWithRole extends Person {
  role: string | null;
  featured: boolean;
}

export interface BusinessSummary {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
}
