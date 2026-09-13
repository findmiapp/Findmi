// Business-Controlled Inquiry Settings pass — the one shared definition
// of Business Inquiry's stable topic values, imported by the member
// editor (checkboxes), the public InquireButton (topic picker), and
// submitEntityInquiry's server-side validation. Never store a UI label
// as authorization logic — businesses.inquiry_topics holds these stable
// values only; BUSINESS_INQUIRY_TOPIC_LABELS is presentation-only.
export const BUSINESS_INQUIRY_TOPIC_VALUES = [
  "general",
  "product_order",
  "wholesale",
  "catering_booking",
  "event_popup",
  "collaboration",
  "other",
] as const;

export type BusinessInquiryTopic = (typeof BUSINESS_INQUIRY_TOPIC_VALUES)[number];

export const BUSINESS_INQUIRY_TOPIC_LABELS: Record<BusinessInquiryTopic, string> = {
  general: "General Inquiry",
  product_order: "Product / Order",
  wholesale: "Wholesale",
  catering_booking: "Catering / Booking",
  event_popup: "Event / Pop-Up",
  collaboration: "Collaboration",
  other: "Other",
};

export function isBusinessInquiryTopic(value: string): value is BusinessInquiryTopic {
  return (BUSINESS_INQUIRY_TOPIC_VALUES as readonly string[]).includes(value);
}

/** Filters an arbitrary string list (e.g. straight off a businesses row)
 * down to only genuinely valid, deduplicated topic values — used
 * wherever stored data is read back, so a stray/legacy value can never
 * silently become a trusted topic. */
export function sanitizeBusinessInquiryTopics(values: readonly string[] | null | undefined): BusinessInquiryTopic[] {
  if (!values) return [];
  const seen = new Set<BusinessInquiryTopic>();
  for (const v of values) {
    if (isBusinessInquiryTopic(v)) seen.add(v);
  }
  // Stable, canonical order (matches BUSINESS_INQUIRY_TOPIC_VALUES) rather
  // than whatever order the database happened to store them in.
  return BUSINESS_INQUIRY_TOPIC_VALUES.filter((v) => seen.has(v));
}
