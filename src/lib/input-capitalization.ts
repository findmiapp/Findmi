/** VCL C1 — keyboard capitalization HINTS for human-facing text inputs.
 *
 * `autoCapitalize` only tells a mobile keyboard how to start words; it never
 * changes what the user typed. Findmi never transforms a value's casing
 * (no title-casing, no toLowerCase/toUpperCase on input, submit or save):
 * "findmi", "illy", "eBay", "iPhone" and "LaCroix" are stored exactly as
 * entered.
 *
 *   words      names and titles (Business/Event/Product/Location/person
 *              names, headings, labels, venue, street, city, state)
 *   sentences  prose (descriptions, About, notes, messages)
 *   none       machine / case-sensitive values (email, URLs, handles,
 *              slugs, codes, passwords, IDs, search)
 *
 * Raw inputs declare their hint explicitly in JSX; this helper gives the
 * shared admin field primitives the same semantics from a field's `name`
 * and `type`. An unrecognised name gets NO hint (the browser default) —
 * never a guessed universal default. */
export type Capitalization = "words" | "sentences" | "none";

const NONE_TYPES = new Set(["email", "url", "password", "search", "tel"]);

const WORDS = new Set([
  "name",
  "title",
  "display_name",
  "public_name",
  "business_name",
  "intended_business_name",
  "venue_name",
  "host_name",
  "contact_name",
  "full_name",
  "label",
  "heading",
  "headline",
  "eyebrow",
  "cta_label",
  "internal_name",
  "concept_label",
  "highlight_heading",
  "contact_heading",
  "contact_cta_label",
  "meta_title",
  "price_label",
  "address",
  "city",
  "state",
  "region",
  "country",
  "place_text",
  "location",
  "areas_included",
  "aliases",
]);

const SENTENCES = new Set([
  "description",
  "short_description",
  "meta_description",
  "about",
  "summary",
  "subtitle",
  "tagline",
  "short_tagline",
  "short_bio",
  "bio",
  "body",
  "text",
  "notes",
  "note",
  "admin_notes",
  "internal_notes",
  "requirements",
  "whats_included",
  "supporting_text",
  "timing_note",
  "highlight_subheading",
  "highlight_body",
  "contact_body",
  "message",
]);

const NONE = new Set([
  "email",
  "website",
  "slug",
  "code",
  "phone",
  "postal_code",
  "timezone",
  "default_timezone",
  "latitude",
  "longitude",
  "price",
  "publish_at",
  "expires_at",
  "decision_deadline",
  "placement",
]);

/** The hint for a field, or undefined when the field isn't recognised. */
export function capitalizationFor(name: string, type: string = "text"): Capitalization | undefined {
  if (NONE_TYPES.has(type)) return "none";
  if (NONE.has(name)) return "none";
  if (WORDS.has(name)) return "words";
  if (SENTENCES.has(name)) return "sentences";
  if (/(_url|_email|_slug|_code|_id|_phone)$/.test(name)) return "none";
  if (/(_name|_title|_label|_heading|_city|_state|_address)$/.test(name)) return "words";
  if (/(_description|_note|_notes|_body|_text|_summary|_bio)$/.test(name)) return "sentences";
  return undefined;
}
