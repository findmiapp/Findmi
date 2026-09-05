export type MembershipStatus = "lead" | "active" | "past_due" | "canceled";
export type LeadStatus =
  | "new"
  | "contacted"
  | "onboarding"
  | "qualified"
  | "not_a_fit";
export type ProductType = "product" | "service";
export type AppearanceStatus = "confirmed" | "tentative" | "canceled";
// Native Inquiries + Private Conversation Threads V1 — "replied" added
// between "new" and "contacted" (auto-set the first time a business
// sends a message; see set_inquiry_status()/inquiries_status_check).
export type InquiryStatus = "new" | "replied" | "contacted" | "booked" | "closed";

export type ProcessingFeePayer = "vendor" | "customer";
export type PayoutMethod = "manual" | "stripe_connect_future";
export type FulfillmentMethod = "shipping" | "local_delivery" | "pickup" | "event_pickup";

// Business Plan Entitlement — BUSINESS-level feature tier, deliberately
// separate from membership_status/founding_member (the /join Founding
// Membership billing concept) and from business_members.role (owner/
// manager/staff — who can act, not what the business is entitled to).
// See lib/entitlements.ts for the central isBusinessPro()/
// isBusinessProSeller() resolvers every gated feature should call instead
// of comparing plan_tier directly.
//
// pro_seller (Native Business Onboarding, Pass 1) is FUTURE-ONLY — no
// seller checkout/Stripe Connect/commissions/payouts/UI exists yet. It's
// in the type now so the entitlement model doesn't need another schema/
// type change when that work starts; a pro_seller business inherits every
// Pro entitlement (see isBusinessPro below) plus, eventually, seller-only
// ones gated separately via isBusinessProSeller().
export type PlanTier = "free" | "pro" | "pro_seller";

// Records WHY/WHEN/HOW a business's plan_tier became what it is — added
// alongside plan_tier itself only in the Pass 1 provenance migration, so
// every column here is nullable/optional: an existing business can (and
// most do) have plan_tier set with no provenance recorded at all.
export type PlanSource = "paid" | "complimentary" | "promotional" | "admin";

// Pro Invite / Complimentary Access Codes V1 — grants FindMi Pro to ONE
// business without Stripe. Admin-only data (never anon/authenticated-
// readable — see the pro_invites migration); read via getAdminSupabase()
// and via the SECURITY DEFINER redeem_pro_invite() RPC only. plan_tier is
// always "pro" for V1 (Pro Seller invites are out of scope), kept as a
// literal here rather than PlanTier so a future widen is a deliberate
// type change, not an accidental one.
export interface ProInvite {
  id: string;
  code: string;
  name: string | null;
  plan_tier: "pro";
  duration_days: number;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_by_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProInviteRedemption {
  id: string;
  invite_id: string;
  business_id: string;
  redeemed_by: string;
  redeemed_at: string;
  previous_plan_tier: string | null;
  granted_plan_tier: string;
  granted_until: string;
}

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
  // Final refinement pass, item 4 — optional Bulletin/Announcement module.
  // Shared pattern with events (see the Bulletin component) — enabled +
  // body must both be truthy for it to render publicly; heading is
  // optional even when enabled.
  bulletin_enabled: boolean;
  bulletin_heading: string | null;
  bulletin_body: string | null;
  // Business Profile polish pass — founder-editable label (defaults to
  // "Announcement" when blank, computed at the call site rather than
  // stored as the default itself) and an optional destination that makes
  // the whole announcement block clickable. Businesses-only — events'
  // own bulletin fields above are untouched.
  bulletin_label: string | null;
  bulletin_url: string | null;
  // Native Inquiries + Private Conversation Threads V1 — off by default;
  // when true, business/product pages offer a native "Message on FindMi"
  // path (signed-in only) alongside the existing Tally/mailto Inquire
  // CTA, which is completely unaffected either way.
  native_inquiries_enabled: boolean;
  // Business Plan Entitlement — not publicly readable (see the PlanTier
  // type above; plan_tier is deliberately off the anon/authenticated
  // column-level grant). Optional here because most existing SELECTs
  // (e.g. PUBLIC_BUSINESS_COLUMNS) don't request this column and won't
  // start returning it just because the column exists in the database.
  plan_tier?: PlanTier;
  // Provenance for the plan_tier above (Pass 1) — all optional/nullable;
  // most businesses have plan_tier set with none of these recorded.
  plan_source?: PlanSource | null;
  plan_started_at?: string | null;
  plan_expires_at?: string | null;
  plan_payment_reference?: string | null;
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

/** Taxonomy foundation pass: categories are split into three explicit,
 * non-overlapping domains sharing one physical table (kept for the
 * existing business_categories/event_categories join patterns rather than
 * splitting into three tables). Every read path scopes by kind — see
 * lib/data.ts and lib/admin/queries.ts — so a business category can never
 * leak into an event picker or vice versa. */
export type CategoryKind = "business" | "event" | "product";

export interface Category {
  id: string;
  name: string;
  slug: string;
  kind: CategoryKind;
  /** One level of subcategory only — a parent's own parent_id is always
   * null, enforced server-side (see the taxonomy migration's trigger). A
   * child always shares its parent's kind. Live in the admin Product
   * Categories screen (Product Taxonomy V1 pass) as Parent → Subcategory;
   * still unused for business/event kinds. */
  parent_id?: string | null;
  /** Business-kind homepage category strip visibility/order. Product
   * Taxonomy V1 reuses the same two columns for top-level (parent_id null)
   * product-kind categories — membership/order in the marketplace's
   * primary browse row. Still meaningless/unused for event-kind rows and
   * for product-kind subcategories (children are always shown under their
   * parent, never independently ordered by this). */
  show_on_home?: boolean;
  home_sort_order?: number | null;
}

// Product Moderation pass — owner-submitted content (new products, and
// edits to already-live products) needs admin approval before it's
// public. moderation_status gates a NEW product's first publication;
// pending_changes holds a proposed edit to an already-live product so the
// live/public columns are never overwritten until approved (null = no
// pending edit). Both are optional on the shared Product interface
// because public-facing reads (PUBLIC_PRODUCT_COLUMNS, an explicit column
// list) never select either — only admin/owner reads do.
export type ProductModerationStatus = "pending_review" | "live" | "rejected";

// Product Marketplace Distribution pass — a SECOND, independent axis from
// moderation_status above. moderation_status gates whether the Product's
// content is approved at all; marketplace_status gates whether an already-
// approved Product may ALSO appear in broader FindMi Marketplace/discovery
// surfaces, separate from its own business profile/storefront (which a
// live+active Product remains visible on regardless of marketplace_status).
// Optional on the shared Product interface for the same reason
// moderation_status is: PUBLIC_PRODUCT_COLUMNS never selects the timestamps,
// and marketplace_status itself is only ever populated by owner/admin
// service-role reads even though it's separately anon/authenticated-
// grantable for query-level filtering (see the migration).
export type ProductMarketplaceStatus = "catalog_only" | "submitted" | "approved" | "rejected" | "paused";

export interface ProductPendingChanges {
  name?: string;
  description?: string | null;
  image_url?: string | null;
  price?: number | null;
  price_label?: string | null;
  product_type?: ProductType;
  external_purchase_url?: string | null;
  category_id?: string | null;
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
  moderation_status?: ProductModerationStatus;
  pending_changes?: ProductPendingChanges | null;
  marketplace_status?: ProductMarketplaceStatus;
  marketplace_submitted_at?: string | null;
  marketplace_approved_at?: string | null;
  // Commerce — off by default (see purchasable). When false, the product
  // keeps its existing inquiry/external-link behavior unchanged.
  purchasable: boolean;
  inventory_status: "in_stock" | "out_of_stock" | null;
  marketplace_fee_override_percent: number | null;
  processing_fee_payer_override: ProcessingFeePayer | null;
  // Founder-controlled homepage/marketplace placement order among
  // is_featured products — null sorts last, then by name.
  home_sort_order: number | null;
  // Final refinement pass, item 5 — separate, business-profile-specific
  // ordering (see getProductsForBusiness). Deliberately independent of
  // home_sort_order, which is documented/used only for the homepage/
  // marketplace featured rows — a different placement, not this one.
  profile_sort_order: number | null;
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
  // Final refinement pass, item 8 — same shared Bulletin pattern as
  // businesses (see the Bulletin component).
  bulletin_enabled: boolean;
  bulletin_heading: string | null;
  bulletin_body: string | null;
}

export interface EventImage {
  id: string;
  event_id: string;
  kind: "event" | "venue";
  url: string;
  display_order: number | null;
}

export type EventOccurrenceStatus = "scheduled" | "cancelled";

/** Event Occurrences foundation — one concrete scheduled instance of a
 * parent event. events stays identity/content; this is the actual
 * date/time/location. Concrete rows only, never a recurrence rule — a
 * weekly market with 12 upcoming dates is 12 real rows. */
export interface EventOccurrence {
  id: string;
  event_id: string;
  start_at: string;
  end_at: string;
  location_id: string | null;
  featured: boolean;
  status: EventOccurrenceStatus;
  ticket_url_override: string | null;
  vendor_apply_url_override: string | null;
  /** RSVP override — Recurring Events V2. Null means "use the parent
   * event's own rsvp_url", same shape as the two overrides above. */
  rsvp_url_override: string | null;
  /** IANA timezone identifier (e.g. "America/Chicago") — Recurring
   * Events V2. This occurrence's own intended local timezone; never
   * derived from city/state text or the viewer's/server's timezone. See
   * lib/format.ts's *InZone formatters, which this field is meant to be
   * passed into for every public occurrence date/time render. */
  timezone: string;
  created_at: string;
  updated_at: string;
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
  // Appearances — Click Behavior pass. Both optional; the public card's
  // click priority is Related Event > external_url > flyer_image_url >
  // GPS directions (from venue/address/city/state above) > non-clickable.
  // See AppearanceCard.tsx.
  external_url: string | null;
  flyer_image_url: string | null;
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

/** The private FindMi account profile (see the account foundation pass) —
 * one row per auth.users row, id shared with it. Distinct from `Person`
 * above: this is private account data, never publicly readable, and
 * carries no bio/editorial fields. No email/password here — those live
 * only in Supabase Auth (auth.users), reachable via the session. */
export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  // User Identity + Follow Foundation pass — opt-in PUBLIC identity
  // fields. A profile only becomes publicly readable (see profiles_
  // select_public RLS) once username is set; until then these three stay
  // exactly as private as display_name/avatar_url already were. Never
  // add an email/phone/auth-metadata field to this interface — see the
  // migration's own privacy note.
  username: string | null;
  bio: string | null;
  location_label: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset of Profile ever shown to anyone other than the account
 * owner — used by /user/[username], business/event follower lists, and
 * anywhere else a "who is this" chip renders for someone else's account.
 * Deliberately its own type (not just "reuse Profile") so a future field
 * added to Profile for account-owner-only use (should one ever exist)
 * doesn't silently leak into a public rendering path just by being on the
 * same interface. */
export interface PublicProfile {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location_label: string | null;
}

// Native Inquiries + Private Conversation Threads V1
export interface Inquiry {
  id: string;
  business_id: string | null;
  product_id: string | null;
  // null for a legacy/anonymous inquiry (pre-dating this pass, or a
  // future deliberate anonymous path) — never inferred from
  // customer_email, only ever set at creation from an authenticated
  // session's own auth.uid().
  user_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  event_date: string | null;
  event_type: string | null;
  event_location: string | null;
  guest_count: number | null;
  budget_range: string | null;
  message: string | null;
  allow_findmi_matching: boolean;
  status: InquiryStatus;
  source: string | null;
  customer_last_read_at: string | null;
  business_last_read_at: string | null;
  created_at: string;
}

export interface InquiryMessage {
  id: string;
  inquiry_id: string;
  sender_type: "customer" | "business";
  sender_user_id: string | null;
  body: string;
  created_at: string;
}
