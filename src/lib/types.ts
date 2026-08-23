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
