// Taxonomy V2 — Pass 1 foundation (pure; client + server).
//
// The controlled vocabularies, launch seeds and structural rules of the
// V2 discovery model:
//
//   WHAT        entity-specific Category trees (public.categories) · Event
//               Type · Experience Mechanic · Appearance Type · Topic
//   WHO         Audience (+ min/max age)
//   ACCESS      Price Kind (+ range) · Entry Mode
//   ATTRIBUTES  Setting · Benefits · controlled factual attributes
//   WHEN        timestamps + Location hours — query logic, not taxonomy
//
// Mirrors supabase/migrations/20261116000000_taxonomy_v2_foundation.sql —
// change both together (tests/taxonomy-v2-foundation.test.mjs checks they
// agree). NOTHING reads V2 at runtime yet: no public filter, parser, Map or
// page consumes these structures until a later pass switches reads
// deliberately. Unknown is never false — an empty value means "not set".

export const TAXONOMY_ENTITY_TYPES = ["business", "location", "event", "product", "appearance"] as const;
export type TaxonomyEntityType = (typeof TAXONOMY_ENTITY_TYPES)[number];

// ------------------------------------------------------------ code-controlled dimensions
// Small, stable sets whose semantics drive application logic (21+ is a
// legal restriction, Free is the admission price, Audience implication).
// Stored as text / text[] columns with CHECK constraints.

/** Superset of the V1 values (src/lib/discovery/attributes.ts): codes are
 * never renamed — "professional" keeps its code, labelled Professionals. */
export const AUDIENCES = ["all_ages", "family", "kids", "teens", "adults", "18_plus", "21_plus", "professional", "creators"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = {
  all_ages: "All Ages",
  family: "Family",
  kids: "Kids",
  teens: "Teens",
  adults: "Adults",
  "18_plus": "18+",
  "21_plus": "21+",
  professional: "Professionals",
  creators: "Creators",
};

/** RSVP and Registration stay distinct. "invite" keeps its V1 code. */
export const ENTRY_MODES = ["walk_in", "rsvp", "registration", "ticket", "reservation", "invite"] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];
export const ENTRY_MODE_LABELS: Record<EntryMode, string> = {
  walk_in: "Walk-In",
  rsvp: "RSVP",
  registration: "Registration",
  ticket: "Ticket",
  reservation: "Reservation",
  invite: "Invite Only",
};

/** The ONE canonical admission price fact. Unknown is NULL — never a value. */
export const PRICE_KINDS = ["free", "paid", "donation"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];
export const PRICE_KIND_LABELS: Record<PriceKind, string> = { free: "Free", paid: "Paid", donation: "Donation" };

/** indoor_outdoor = both physical settings; hybrid = in person AND online. */
export const SETTINGS = ["indoor", "outdoor", "indoor_outdoor", "online", "hybrid"] as const;
export type Setting = (typeof SETTINGS)[number];
export const SETTING_LABELS: Record<Setting, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  indoor_outdoor: "Indoor + Outdoor",
  online: "Online",
  hybrid: "Hybrid",
};

/** What an attendee gets. Free admission is NOT a benefit (that's
 * price_kind = free) — "free_admission" stays allowed in storage only for
 * V1 compatibility (LEGACY_BENEFITS) and is never offered in V2. */
export const BENEFITS = ["free_food", "free_drinks", "free_samples", "free_products", "giveaways", "swag", "discounts", "prizes", "complimentary_services"] as const;
export type Benefit = (typeof BENEFITS)[number];
export const LEGACY_BENEFITS = ["free_admission"] as const;
export const BENEFIT_LABELS: Record<Benefit, string> = {
  free_food: "Free Food",
  free_drinks: "Free Drinks",
  free_samples: "Free Samples",
  free_products: "Free Products",
  giveaways: "Giveaways",
  swag: "Swag",
  discounts: "Discounts",
  prizes: "Prizes",
  complimentary_services: "Complimentary Services",
};

/** Optional, multi-select. Never required; a service business is a
 * Business Category + service_provider — not a Product. */
export const BUSINESS_MODELS = ["product_brand", "retailer", "food_service", "service_provider", "maker_artist", "organizer", "venue_operator", "agency"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];
export const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  product_brand: "Product Brand",
  retailer: "Retailer",
  food_service: "Food Service",
  service_provider: "Service Provider",
  maker_artist: "Maker / Artist",
  organizer: "Organizer",
  venue_operator: "Venue Operator",
  agency: "Agency",
};

// ------------------------------------------------------------ provenance

/** Where a classification came from. Assignment rows are always CONFIRMED
 * (only confirmed classifications may ever power discovery); unconfirmed
 * ideas live in classification_suggestions until reviewed. */
export const PROVENANCE_SOURCES = ["migration", "importer", "admin", "owner", "suggestion"] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];
export const SUGGESTION_SOURCES = ["migration", "importer", "suggestion"] as const;
export const SUGGESTION_STATUSES = ["suggested", "confirmed", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Every structured dimension a suggestion, alias or field source can name. */
export const CLASSIFICATION_DIMENSIONS = [
  "category", "topic", "event_type", "experience_mechanic", "appearance_type", "opportunity_category",
  "audience", "age_range", "entry_mode", "price_kind", "price_range", "setting", "benefit", "business_model",
  "attribute", "all_day", "hours",
] as const;
export type ClassificationDimension = (typeof CLASSIFICATION_DIMENSIONS)[number];

// ------------------------------------------------------------ DB-managed term vocabularies
// Controlled vocabularies an editor will realistically extend (labels,
// aliases, future SEO pages) — rows in public.taxonomy_terms, typed by
// vocabulary. They are NOT Categories: Sampling is an Experience Mechanic.

export const TERM_VOCABULARIES = ["event_type", "experience_mechanic", "appearance_type", "opportunity_category"] as const;
export type TermVocabulary = (typeof TERM_VOCABULARIES)[number];

export interface TermSeed {
  slug: string;
  name: string;
  /** experience_mechanic only: Benefits it may SUGGEST. A hint for review
   * queues — never a confirmed Benefit. */
  suggestsBenefits?: Benefit[];
}

export const EVENT_TYPE_SEEDS: TermSeed[] = [
  { slug: "festival", name: "Festival" },
  { slug: "market", name: "Market" },
  { slug: "shopping-event", name: "Shopping Event" },
  { slug: "tasting", name: "Tasting" },
  { slug: "dining-experience", name: "Dining Experience" },
  { slug: "class", name: "Class" },
  { slug: "workshop", name: "Workshop" },
  { slug: "talk-panel", name: "Talk & Panel" },
  { slug: "conference", name: "Conference" },
  { slug: "meetup-social", name: "Meetup & Social" },
  { slug: "networking", name: "Networking" },
  { slug: "party", name: "Party" },
  { slug: "performance", name: "Performance" },
  { slug: "screening", name: "Screening" },
  { slug: "exhibition", name: "Exhibition" },
  { slug: "immersive-experience", name: "Immersive Experience" },
  { slug: "tour-walk", name: "Tour & Walk" },
  { slug: "race-competition", name: "Race & Competition" },
  { slug: "fitness-session", name: "Fitness Session" },
  { slug: "watch-party", name: "Watch Party" },
  { slug: "fundraiser", name: "Fundraiser" },
  { slug: "volunteer-event", name: "Volunteer Event" },
  { slug: "open-house", name: "Open House" },
];

export const EXPERIENCE_MECHANIC_SEEDS: TermSeed[] = [
  { slug: "pop-up", name: "Pop-Up" },
  { slug: "sampling", name: "Sampling", suggestsBenefits: ["free_samples"] },
  { slug: "demo", name: "Demo" },
  { slug: "brand-activation", name: "Brand Activation" },
  { slug: "product-launch", name: "Product Launch" },
  { slug: "retail-experience", name: "Retail Experience" },
  { slug: "sample-sale", name: "Sample Sale" },
  { slug: "meet-greet", name: "Meet & Greet" },
  { slug: "giveaway", name: "Giveaway", suggestsBenefits: ["giveaways"] },
];

export const APPEARANCE_TYPE_SEEDS: TermSeed[] = [
  { slug: "pop-up", name: "Pop-Up" },
  { slug: "sampling-demo", name: "Sampling & Demo" },
  { slug: "vendor-booth", name: "Vendor Booth" },
  { slug: "in-store", name: "In-Store Appearance" },
  { slug: "activation", name: "Activation" },
  { slug: "guest-appearance", name: "Guest Appearance" },
  { slug: "mobile-stop", name: "Mobile Stop" },
  { slug: "pickup-point", name: "Pickup Point" },
  { slug: "other", name: "Other" },
];

/** Commercial Opportunity Listings only (never public.opportunities). */
export const OPPORTUNITY_CATEGORY_SEEDS: TermSeed[] = [
  { slug: "activation-sampling", name: "Activation & Sampling" },
  { slug: "retail-vending", name: "Retail & Vending" },
  { slug: "sponsorship", name: "Sponsorship" },
  { slug: "content-media", name: "Content & Media" },
  { slug: "partnerships", name: "Partnerships" },
  { slug: "space-placement", name: "Space & Placement" },
];

export const TERM_SEEDS: Record<TermVocabulary, TermSeed[]> = {
  event_type: EVENT_TYPE_SEEDS,
  experience_mechanic: EXPERIENCE_MECHANIC_SEEDS,
  appearance_type: APPEARANCE_TYPE_SEEDS,
  opportunity_category: OPPORTUNITY_CATEGORY_SEEDS,
};

// ------------------------------------------------------------ Topics
// Admin-controlled, shared across entity types. NOT public.discovery_topics
// (saved-query lenses) — that table is untouched.

export const TOPIC_KINDS = ["subject", "occasion"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
export const TOPIC_STATUSES = ["draft", "active", "retired"] as const;

export interface TopicSeed {
  slug: string;
  name: string;
  kind: TopicKind;
  broader?: string;
}

const subject = (slug: string, name: string, broader?: string): TopicSeed => ({ slug, name, kind: "subject", ...(broader ? { broader } : {}) });
const occasion = (slug: string, name: string, broader?: string): TopicSeed => ({ slug, name, kind: "occasion", ...(broader ? { broader } : {}) });

/** Parent Topics only where the relationship is obvious. */
export const TOPIC_SEEDS: TopicSeed[] = [
  subject("coffee", "Coffee"),
  subject("tea", "Tea"),
  subject("matcha", "Matcha", "tea"),
  subject("bakery-pastry", "Bakery & Pastry"),
  subject("chocolate-sweets", "Chocolate & Sweets"),
  subject("wine", "Wine"),
  subject("beer", "Beer"),
  subject("cocktails", "Cocktails"),
  subject("plant-based", "Plant-Based"),
  subject("local-food", "Local Food"),
  subject("fashion", "Fashion"),
  subject("streetwear", "Streetwear", "fashion"),
  subject("sneakers", "Sneakers", "streetwear"),
  subject("vintage", "Vintage"),
  subject("jewelry", "Jewelry"),
  subject("beauty", "Beauty"),
  subject("skincare", "Skincare", "beauty"),
  subject("fragrance", "Fragrance", "beauty"),
  subject("wellness", "Wellness"),
  subject("fitness", "Fitness"),
  subject("running", "Running", "fitness"),
  subject("yoga", "Yoga", "fitness"),
  subject("art", "Art"),
  subject("design", "Design"),
  subject("photography", "Photography"),
  subject("books", "Books"),
  subject("film", "Film"),
  subject("live-music", "Live Music"),
  subject("djs-dance", "DJs & Dance"),
  subject("comedy", "Comedy"),
  subject("theater", "Theater"),
  subject("home-interiors", "Home & Interiors"),
  subject("plants", "Plants"),
  subject("crafts-diy", "Crafts & DIY"),
  subject("tech", "Tech"),
  subject("ai", "AI", "tech"),
  subject("startups", "Startups"),
  subject("careers", "Careers"),
  subject("parenting", "Parenting"),
  subject("pets", "Pets"),
  subject("sustainability", "Sustainability"),
  subject("local-makers", "Local Makers"),
  subject("gifts", "Gifts"),
  occasion("halloween", "Halloween"),
  occasion("thanksgiving", "Thanksgiving"),
  occasion("winter-holidays", "Winter Holidays"),
  occasion("valentines-day", "Valentine's Day"),
  occasion("lunar-new-year", "Lunar New Year"),
  occasion("pride", "Pride"),
  occasion("summer", "Summer"),
  occasion("back-to-school", "Back to School"),
  occasion("fashion-week", "Fashion Week", "fashion"),
  occasion("nyc-marathon", "NYC Marathon", "running"),
];

/** Every seeded Topic applies to every taxonomy entity type at launch;
 * editors narrow applies_to per Topic later. */
export const DEFAULT_TOPIC_APPLIES_TO: readonly TaxonomyEntityType[] = TAXONOMY_ENTITY_TYPES;

// ------------------------------------------------------------ attributes
// Validated definitions + one JSON object per entity (locations.attributes,
// products.attributes). Not an EAV table and not hundreds of columns.

export const ATTRIBUTE_ENTITY_TYPES = ["location", "product"] as const;
export type AttributeEntityType = (typeof ATTRIBUTE_ENTITY_TYPES)[number];
export const ATTRIBUTE_VALUE_TYPES = ["boolean", "enum", "multi_enum", "number"] as const;
export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number];

export interface AttributeSeed {
  key: string;
  label: string;
  entityTypes: AttributeEntityType[];
  valueType: AttributeValueType;
  allowedValues?: string[];
  group: string;
  /** true = offered only for categories explicitly linked to it
   * (attribute_definition_categories). Dietary facts make no sense for
   * apparel, so they stay unavailable until Pass 2 links Food & Beverage
   * product categories. */
  requiresCategoryScope: boolean;
}

const locationFact = (key: string, label: string, group: string): AttributeSeed => ({ key, label, entityTypes: ["location"], valueType: "boolean", group, requiresCategoryScope: false });
const dietaryFact = (key: string, label: string): AttributeSeed => ({ key, label, entityTypes: ["product"], valueType: "boolean", group: "Dietary", requiresCategoryScope: true });

export const ATTRIBUTE_SEEDS: AttributeSeed[] = [
  locationFact("wifi", "Wi-Fi", "Amenities"),
  locationFact("outdoor_seating", "Outdoor Seating", "Amenities"),
  locationFact("restrooms", "Restrooms", "Amenities"),
  locationFact("parking", "Parking", "Amenities"),
  locationFact("pet_friendly", "Pet Friendly", "Amenities"),
  locationFact("reservations_accepted", "Reservations Accepted", "Amenities"),
  locationFact("wheelchair_accessible", "Wheelchair Accessible", "Accessibility"),
  locationFact("accessible_restroom", "Accessible Restroom", "Accessibility"),
  dietaryFact("vegan", "Vegan"),
  dietaryFact("vegetarian", "Vegetarian"),
  dietaryFact("gluten_free", "Gluten-Free"),
  dietaryFact("caffeine_free", "Caffeine-Free"),
  dietaryFact("non_alcoholic", "Non-Alcoholic"),
];

export interface AttributeDefinition {
  key: string;
  entityTypes: readonly string[];
  valueType: AttributeValueType;
  allowedValues?: readonly string[] | null;
  status?: string;
}

/** Validates an entity's attributes object against the definitions —
 * the same rules as the public.validate_entity_attributes() trigger.
 * Returns the problems (empty = valid). */
export function validateAttributes(entityType: AttributeEntityType, value: unknown, defs: readonly AttributeDefinition[]): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["attributes must be an object"];
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const problems: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const d = byKey.get(key);
    if (!d || (d.status ?? "active") !== "active") problems.push(`${key}: unknown attribute`);
    else if (!d.entityTypes.includes(entityType)) problems.push(`${key}: not a ${entityType} attribute`);
    else if (d.valueType === "boolean" && typeof v !== "boolean") problems.push(`${key}: expected true/false`);
    else if (d.valueType === "number" && typeof v !== "number") problems.push(`${key}: expected a number`);
    else if (d.valueType === "enum" && !(typeof v === "string" && (d.allowedValues ?? []).includes(v))) problems.push(`${key}: not an allowed value`);
    else if (d.valueType === "multi_enum" && !(Array.isArray(v) && v.every((x) => typeof x === "string" && (d.allowedValues ?? []).includes(x)))) problems.push(`${key}: not allowed values`);
  }
  return problems;
}

// ------------------------------------------------------------ aliases

/** Dimensions an alias may target. DB-backed targets carry target_id;
 * code-controlled ones carry target_code. */
export const ALIAS_ID_DIMENSIONS = ["category", "topic", "event_type", "experience_mechanic", "appearance_type", "opportunity_category", "area", "region"] as const;
export const ALIAS_CODE_DIMENSIONS = ["audience", "entry_mode", "price_kind", "setting", "benefit", "business_model", "attribute", "entity_type"] as const;
export type AliasDimension = (typeof ALIAS_ID_DIMENSIONS)[number] | (typeof ALIAS_CODE_DIMENSIONS)[number];

export interface AliasSeed {
  phrase: string;
  dimension: AliasDimension;
  /** Slug (DB-backed dimensions) or code (code-controlled dimensions). */
  target: string;
  entityTypes?: TaxonomyEntityType[];
}

/** Lowercase, trimmed, single-spaced — the stored form of every phrase. */
export const normalizeAliasPhrase = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const a = (phrase: string, dimension: AliasDimension, target: string, entityTypes?: TaxonomyEntityType[]): AliasSeed => ({ phrase, dimension, target, ...(entityTypes ? { entityTypes } : {}) });

/** Vocabulary only — grammar (time words, "open until", "near me") stays in
 * the parser. One phrase may map to several concepts ("pop up" is both an
 * Experience Mechanic and an Appearance Type); the parser resolves them by
 * entity scope later. Nothing reads these yet. */
export const ALIAS_SEEDS: AliasSeed[] = [
  a("kids", "audience", "kids"), a("children", "audience", "kids"), a("for kids", "audience", "kids"),
  a("family", "audience", "family"), a("families", "audience", "family"), a("family friendly", "audience", "family"), a("family-friendly", "audience", "family"),
  a("all ages", "audience", "all_ages"), a("teens", "audience", "teens"), a("teenagers", "audience", "teens"),
  a("adults", "audience", "adults"), a("18+", "audience", "18_plus"), a("21+", "audience", "21_plus"), a("21 and over", "audience", "21_plus"),
  a("professionals", "audience", "professional"), a("creators", "audience", "creators"),
  a("walk in", "entry_mode", "walk_in"), a("walk-in", "entry_mode", "walk_in"), a("walk ins", "entry_mode", "walk_in"),
  a("rsvp", "entry_mode", "rsvp"), a("registration", "entry_mode", "registration"), a("register", "entry_mode", "registration"),
  a("tickets", "entry_mode", "ticket"), a("ticketed", "entry_mode", "ticket"), a("reservations", "entry_mode", "reservation"), a("invite only", "entry_mode", "invite"),
  a("free", "price_kind", "free"), a("free admission", "price_kind", "free"), a("free entry", "price_kind", "free"), a("no cover", "price_kind", "free"),
  a("paid", "price_kind", "paid"), a("donation", "price_kind", "donation"), a("pay what you wish", "price_kind", "donation"),
  a("indoor", "setting", "indoor"), a("indoors", "setting", "indoor"), a("outdoor", "setting", "outdoor"), a("outdoors", "setting", "outdoor"),
  a("online", "setting", "online"), a("virtual", "setting", "online"), a("hybrid", "setting", "hybrid"),
  a("free samples", "benefit", "free_samples"), a("samples", "benefit", "free_samples"), a("free food", "benefit", "free_food"), a("free drinks", "benefit", "free_drinks"),
  a("giveaways", "benefit", "giveaways"), a("swag", "benefit", "swag"), a("discounts", "benefit", "discounts"),
  a("pop up", "experience_mechanic", "pop-up", ["event"]), a("pop-up", "experience_mechanic", "pop-up", ["event"]), a("popup", "experience_mechanic", "pop-up", ["event"]),
  a("pop up", "appearance_type", "pop-up", ["appearance"]), a("pop-up", "appearance_type", "pop-up", ["appearance"]), a("popup", "appearance_type", "pop-up", ["appearance"]),
  a("sampling", "experience_mechanic", "sampling", ["event"]), a("product launch", "experience_mechanic", "product-launch", ["event"]), a("launch", "experience_mechanic", "product-launch", ["event"]),
  a("activation", "experience_mechanic", "brand-activation", ["event"]), a("sample sale", "experience_mechanic", "sample-sale", ["event"]), a("meet and greet", "experience_mechanic", "meet-greet", ["event"]),
  a("market", "event_type", "market", ["event"]), a("markets", "event_type", "market", ["event"]), a("fair", "event_type", "market", ["event"]), a("flea market", "event_type", "market", ["event"]),
  a("festival", "event_type", "festival", ["event"]), a("tasting", "event_type", "tasting", ["event"]), a("tastings", "event_type", "tasting", ["event"]),
  a("class", "event_type", "class", ["event"]), a("classes", "event_type", "class", ["event"]), a("workshop", "event_type", "workshop", ["event"]), a("workshops", "event_type", "workshop", ["event"]),
  a("panel", "event_type", "talk-panel", ["event"]), a("talk", "event_type", "talk-panel", ["event"]), a("meetup", "event_type", "meetup-social", ["event"]), a("party", "event_type", "party", ["event"]),
  a("exhibit", "event_type", "exhibition", ["event"]), a("exhibition", "event_type", "exhibition", ["event"]), a("screening", "event_type", "screening", ["event"]), a("watch party", "event_type", "watch-party", ["event"]),
  a("coffee", "topic", "coffee"), a("espresso", "topic", "coffee"), a("tea", "topic", "tea"), a("matcha", "topic", "matcha"),
  a("pastry", "topic", "bakery-pastry"), a("bakery", "topic", "bakery-pastry"), a("wine", "topic", "wine"), a("beer", "topic", "beer"), a("cocktails", "topic", "cocktails"),
  a("plant based", "topic", "plant-based"), a("vegan", "topic", "plant-based"), a("vegan", "attribute", "vegan", ["product"]),
  a("streetwear", "topic", "streetwear"), a("sneakers", "topic", "sneakers"), a("vintage", "topic", "vintage"), a("thrift", "topic", "vintage"),
  a("skincare", "topic", "skincare"), a("makeup", "topic", "beauty"), a("perfume", "topic", "fragrance"),
  a("running", "topic", "running"), a("run club", "topic", "running"), a("yoga", "topic", "yoga"), a("live music", "topic", "live-music"), a("dj", "topic", "djs-dance"),
  a("parenting", "topic", "parenting"), a("pets", "topic", "pets"), a("dogs", "topic", "pets"),
  a("halloween", "topic", "halloween"), a("thanksgiving", "topic", "thanksgiving"), a("holidays", "topic", "winter-holidays"), a("christmas", "topic", "winter-holidays"),
  a("valentines", "topic", "valentines-day"), a("valentine's day", "topic", "valentines-day"), a("lunar new year", "topic", "lunar-new-year"), a("pride", "topic", "pride"),
  a("fashion week", "topic", "fashion-week"), a("nyfw", "topic", "fashion-week"), a("marathon", "topic", "nyc-marathon"), a("nyc marathon", "topic", "nyc-marathon"),
  a("wifi", "attribute", "wifi", ["location"]), a("wi-fi", "attribute", "wifi", ["location"]), a("outdoor seating", "attribute", "outdoor_seating", ["location"]), a("patio", "attribute", "outdoor_seating", ["location"]),
  a("wheelchair accessible", "attribute", "wheelchair_accessible", ["location"]), a("accessible", "attribute", "wheelchair_accessible", ["location"]),
  a("pet friendly", "attribute", "pet_friendly", ["location"]), a("dog friendly", "attribute", "pet_friendly", ["location"]), a("gluten free", "attribute", "gluten_free", ["product"]),
  a("events", "entity_type", "event"), a("brands", "entity_type", "business"), a("shops", "entity_type", "business"), a("places", "entity_type", "location"), a("products", "entity_type", "product"),
];

// ------------------------------------------------------------ legacy compatibility

/** One legacy classification slug → the V2 concept(s) it becomes. Stored
 * as status 'draft' — INACTIVE: nothing redirects, rewrites URLs or
 * rewrites discovery_topics.query until a later pass activates rows. */
export interface LegacyMappingSeed {
  legacyKind: "event_format";
  legacySlug: string;
  targets: { dimension: "event_type" | "experience_mechanic"; slug: string }[];
  note?: string;
}

export const LEGACY_EVENT_FORMAT_MAPPINGS: LegacyMappingSeed[] = [
  { legacyKind: "event_format", legacySlug: "brand-activation", targets: [{ dimension: "experience_mechanic", slug: "brand-activation" }] },
  { legacyKind: "event_format", legacySlug: "pop-up", targets: [{ dimension: "experience_mechanic", slug: "pop-up" }] },
  { legacyKind: "event_format", legacySlug: "sampling", targets: [{ dimension: "experience_mechanic", slug: "sampling" }] },
  { legacyKind: "event_format", legacySlug: "product-launch", targets: [{ dimension: "experience_mechanic", slug: "product-launch" }] },
  { legacyKind: "event_format", legacySlug: "retail-experience", targets: [{ dimension: "experience_mechanic", slug: "retail-experience" }] },
  { legacyKind: "event_format", legacySlug: "sample-sale", targets: [{ dimension: "experience_mechanic", slug: "sample-sale" }] },
  { legacyKind: "event_format", legacySlug: "market", targets: [{ dimension: "event_type", slug: "market" }] },
  { legacyKind: "event_format", legacySlug: "festival", targets: [{ dimension: "event_type", slug: "festival" }] },
  { legacyKind: "event_format", legacySlug: "networking", targets: [{ dimension: "event_type", slug: "networking" }] },
  { legacyKind: "event_format", legacySlug: "talk-panel", targets: [{ dimension: "event_type", slug: "talk-panel" }] },
  { legacyKind: "event_format", legacySlug: "workshop", targets: [{ dimension: "event_type", slug: "workshop" }] },
  { legacyKind: "event_format", legacySlug: "conference", targets: [{ dimension: "event_type", slug: "conference" }] },
  { legacyKind: "event_format", legacySlug: "exhibition", targets: [{ dimension: "event_type", slug: "exhibition" }] },
  { legacyKind: "event_format", legacySlug: "immersive-experience", targets: [{ dimension: "event_type", slug: "immersive-experience" }] },
  { legacyKind: "event_format", legacySlug: "performance", targets: [{ dimension: "event_type", slug: "performance" }] },
  { legacyKind: "event_format", legacySlug: "party-social", targets: [{ dimension: "event_type", slug: "party" }], note: "Review: some rows may be Meetup & Social rather than Party." },
];

// ------------------------------------------------------------ V2 Category trees (Pass 2: staged)
// The V2 entity Category trees in public.categories. Tree STRUCTURE lives in
// public.category_tree_v2 (category → V2 parent), never in parent_id, so a
// live V1 row can join the V2 tree under a new parent without changing V1.
//
//   reuse: true   an existing ACTIVE V1 row of the same kind + slug with the
//                 same meaning, kept exactly as it is (V1 keeps reading it);
//                 `name` is its V2 label (category_tree_v2.display_name when
//                 it differs from the V1 name; "" = keep the V1 name).
//   otherwise     a NEW row inserted with status 'staged' — invisible to V1
//                 (RLS hides staged rows from anon/authenticated; service-
//                 role V1 readers exclude them explicitly) until the read
//                 switch.
//
// Only Business / Location / Event / Product are Categories. Event Type,
// Mechanic, Appearance Type, Topic, Audience, Access, Price, Setting,
// Benefits, Attributes and Business Model are separate dimensions.

export type V2CategoryKind = "business" | "location" | "event" | "product";

export interface CategoryNode {
  slug: string;
  name: string;
  reuse?: true;
  children?: CategoryNode[];
}

const n = (slug: string, name: string, children?: CategoryNode[]): CategoryNode => ({ slug, name, ...(children ? { children } : {}) });
/** An existing V1 row reused as-is (its V2 label may differ). */
const r = (slug: string, name: string, children?: CategoryNode[]): CategoryNode => ({ slug, name, reuse: true, ...(children ? { children } : {}) });
/** Reused V1 rows that keep their V1 names in V2 too (name ""). */
const rs = (...slugs: string[]): CategoryNode[] => slugs.map((s) => r(s, ""));

/** Event Category / Domain — ONE level. Specificity comes from Event Type,
 * Experience Mechanic, Topic, Audience, Access, Setting, Benefits. Seven
 * V1 top-level rows are exact equivalents; "home-lifestyle" reuses the V1
 * row of that name (a V1 subcategory — its V1 parent_id is untouched; in
 * V2 it is top-level). */
export const V2_EVENT_DOMAINS: CategoryNode[] = [
  r("food-drink", "Food & Drink"),
  r("arts-culture", "Arts & Culture"),
  r("music-nightlife", "Music & Nightlife"),
  r("entertainment", "Entertainment"),
  n("shopping-style", "Shopping & Style"),
  r("beauty-wellness", "Beauty & Wellness"),
  r("sports-fitness", "Sports & Fitness"),
  n("outdoors-nature", "Outdoors & Nature"),
  r("business-tech", "Business & Tech"),
  n("community-causes", "Community & Causes"),
  r("home-lifestyle", "Home & Lifestyle"),
];

/** Industry / vertical only — never business model, audience, channel or
 * participation role (those are Business Model / Audience / relationships). */
export const V2_BUSINESS_TREE: CategoryNode[] = [
  n("food-beverage", "Food & Beverage", [
    n("coffee-tea", "Coffee & Tea"),
    n("bakery-desserts", "Bakery & Desserts"),
    n("restaurants-food-service", "Restaurants & Food Service"),
    n("packaged-food", "Packaged Food"),
    n("beverages", "Beverages"),
    n("alcoholic-beverages", "Alcoholic Beverages"),
    n("non-alcoholic-beverages", "Non-Alcoholic Beverages"),
  ]),
  r("fashion-apparel", "Fashion & Apparel", [
    n("apparel", "Apparel"),
    n("footwear", "Footwear"),
    n("accessories", "Accessories"),
    n("jewelry", "Jewelry"),
    r("vintage-resale", "Vintage & Resale"),
  ]),
  n("beauty-personal-care", "Beauty & Personal Care", [n("skincare", "Skincare"), n("haircare", "Haircare"), n("cosmetics", "Cosmetics"), n("fragrance", "Fragrance"), n("personal-care", "Personal Care")]),
  n("health-wellness", "Health & Wellness", [n("fitness", "Fitness"), n("wellness", "Wellness"), n("health-services", "Health Services")]),
  n("home-living", "Home & Living", [n("home-goods", "Home Goods"), n("furniture-decor", "Furniture & Decor"), n("plants-garden", "Plants & Garden")]),
  n("arts-makers", "Arts & Makers", [n("art", "Art"), n("crafts", "Crafts"), n("makers", "Makers")]),
  n("kids-baby", "Kids & Baby", [n("baby", "Baby"), n("kids", "Kids"), n("toys-play", "Toys & Play")]),
  r("pets", "Pets"),
  n("media-entertainment", "Media & Entertainment", [n("music", "Music"), n("film-video", "Film & Video"), n("publishing-books", "Publishing & Books"), n("entertainment", "Entertainment")]),
  n("events-hospitality", "Events & Hospitality", [n("event-production", "Event Production"), n("hospitality", "Hospitality"), n("venues", "Venues")]),
  n("services", "Services"),
];

/** Function, not physical form (place_type / parent_location_id own form
 * and containment). Reused V1 rows keep their V1 names for V1 readers. */
export const V2_LOCATION_TREE: CategoryNode[] = [
  n("food-drink", "Food & Drink", [
    r("cafe-coffee-shop", "Café & Coffee Shop"),
    n("bakery", "Bakery"),
    r("restaurant", "Restaurant"),
    r("bar-lounge", "Bar"),
    n("food-hall", "Food Hall"),
    n("specialty-food-shop", "Specialty Food Shop"),
  ]),
  n("shopping", "Shopping", [r("retail-store", "Store"), n("boutique", "Boutique"), n("shopping-center", "Shopping Center"), n("market-hall", "Market Hall")]),
  n("arts-culture", "Arts & Culture", [r("gallery", "Gallery"), n("museum", "Museum"), n("theater", "Theater"), n("cinema", "Cinema")]),
  n("event-community-spaces", "Event & Community Spaces", [r("event-venue", "Event Venue"), r("community-space", "Community Space"), n("convention-exhibition-space", "Convention / Exhibition Space")]),
  n("outdoors", "Outdoors", [n("park", "Park"), n("plaza", "Plaza"), n("waterfront", "Waterfront"), n("recreation-area", "Recreation Area")]),
  n("health-wellness", "Health & Wellness", [r("fitness-gym", "Gym & Fitness Studio"), n("wellness-studio", "Wellness Studio"), r("salon-spa", "Salon & Spa")]),
  n("hospitality", "Hospitality", [r("hotel", "Hotel")]),
  n("work-education", "Work & Education", [r("coworking-space", "Coworking Space"), n("school-campus", "School / Campus"), n("library", "Library")]),
  n("landmarks", "Landmarks", [n("landmark-attraction", "Landmark / Attraction")]),
];

/** Catalog products only — no Services category (a service business is a
 * Business Category + Business Model service_provider). The V1 product
 * catalog is already well structured, so its rows are reused under V2
 * parents; only the regrouped tops are new. */
export const V2_PRODUCT_TREE: CategoryNode[] = [
  n("food-snacks", "Food & Snacks", rs("bread-baked-goods", "cakes-desserts", "candy-chocolate", "cookies-pastries", "jams-spreads", "pantry-goods", "prepared-foods", "sauces-condiments", "snacks", "specialty-foods", "spices-seasonings")),
  n("beverages", "Beverages", rs("coffee", "tea-matcha", "non-alcoholic-drinks")),
  n("beauty-personal-care", "Beauty & Personal Care", rs("bath-body", "cosmetics", "fragrance", "grooming", "hair-care", "nail-care", "skincare", "soap")),
  n("apparel", "Apparel", rs("activewear", "baby-clothing", "dresses", "intimates-sleepwear", "kids-clothing", "other-clothing", "outerwear", "pants-shorts", "skirts", "sweatshirts-hoodies", "swimwear", "t-shirts-tops", "vintage-clothing")),
  n("accessories-jewelry", "Accessories & Jewelry", [
    r("jewelry", "Jewelry", rs("anklets", "body-jewelry", "bracelets", "brooches-pins", "charms-pendants", "earrings", "fine-jewelry", "necklaces", "other-jewelry", "rings", "watches")),
    r("bags-accessories", "Bags & Accessories", rs("backpacks", "belts", "hair-accessories", "handbags-purses", "hats-caps", "keychains", "other-accessories", "scarves-wraps", "sunglasses-eyewear", "tote-bags", "travel-accessories", "wallets-card-holders")),
  ]),
  r("home-living", "Home & Living", rs("bath-home", "bedding", "candles", "drinkware", "furniture", "garden-outdoor", "home-decor", "home-fragrance", "kitchen-dining", "other-home-goods", "pillows-textiles", "plants-planters", "storage-organization", "wall-decor")),
  r("art-collectibles", "Art & Collectibles", rs("collectibles", "digital-art", "figurines-miniatures", "illustration", "memorabilia", "mixed-media", "other-art", "paintings", "photography", "posters", "prints", "sculpture")),
  r("craft-maker-goods", "Craft & Maker Goods", rs("ceramics-pottery", "craft-supplies", "crochet-knit", "fiber-arts", "glasswork", "handmade-soap-candles", "leather-goods", "metalwork", "other-maker-goods", "patterns-kits", "resin-goods", "woodwork")),
  r("books-media", "Books & Media", rs("books", "comics", "digital-downloads", "magazines", "music", "other-books-media", "vinyl-physical-media", "zines")),
  r("stationery-paper", "Stationery & Paper", rs("art-prints", "calendars", "gift-wrap", "greeting-cards", "invitations", "journals-notebooks", "other-paper-goods", "party-paper-goods", "planners", "stationery", "stickers")),
  r("kids-baby", "Kids & Baby", [
    ...rs("baby-accessories", "baby-essentials", "baby-gifts", "educational-products", "kids-accessories", "kids-decor", "nursery", "other-kids-baby"),
    r("toys-games", "Toys & Games", rs("collectible-toys", "dolls-figures", "games", "other-toys-games", "outdoor-toys", "plush-stuffed-animals", "puzzles", "sensory-toys", "toys")),
  ]),
  r("pets", "Pets", rs("bowls-feeding", "collars-leashes", "other-pet-products", "pet-accessories", "pet-beds", "pet-clothing", "pet-gifts", "pet-toys", "pet-treats")),
  n("wellness", "Wellness", rs("aromatherapy", "wellness-products")),
];

export const V2_TREES: Record<V2CategoryKind, CategoryNode[]> = { event: V2_EVENT_DOMAINS, business: V2_BUSINESS_TREE, location: V2_LOCATION_TREE, product: V2_PRODUCT_TREE };

/** Maximum tree depth per entity Category kind (1 = flat). */
export const CATEGORY_MAX_DEPTH = { event: 1, location: 3, business: 2, product: 3 } as const;

/** V2 Category → Topic implications (public.category_topics): only where
 * the Category guarantees the subject. A Coffee & Tea business could be a
 * tea brand, so it implies nothing; a Coffee Shop is about coffee. */
export const V2_CATEGORY_TOPIC_IMPLICATIONS: { kind: V2CategoryKind; slug: string; topics: string[] }[] = [
  { kind: "location", slug: "cafe-coffee-shop", topics: ["coffee"] },
  { kind: "location", slug: "bakery", topics: ["bakery-pastry"] },
  { kind: "location", slug: "gallery", topics: ["art"] },
  { kind: "location", slug: "theater", topics: ["theater"] },
  { kind: "location", slug: "cinema", topics: ["film"] },
  { kind: "business", slug: "vintage-resale", topics: ["vintage"] },
  { kind: "business", slug: "jewelry", topics: ["jewelry"] },
  { kind: "business", slug: "skincare", topics: ["skincare"] },
  { kind: "business", slug: "fragrance", topics: ["fragrance"] },
  { kind: "business", slug: "cosmetics", topics: ["beauty"] },
  { kind: "business", slug: "fitness", topics: ["fitness"] },
  { kind: "business", slug: "plants-garden", topics: ["plants"] },
  { kind: "business", slug: "art", topics: ["art"] },
  { kind: "business", slug: "publishing-books", topics: ["books"] },
  { kind: "business", slug: "pets", topics: ["pets"] },
  { kind: "product", slug: "coffee", topics: ["coffee"] },
  { kind: "product", slug: "tea-matcha", topics: ["tea"] },
  { kind: "product", slug: "candy-chocolate", topics: ["chocolate-sweets"] },
  { kind: "product", slug: "bread-baked-goods", topics: ["bakery-pastry"] },
  { kind: "product", slug: "cookies-pastries", topics: ["bakery-pastry"] },
  { kind: "product", slug: "skincare", topics: ["skincare"] },
  { kind: "product", slug: "fragrance", topics: ["fragrance"] },
  { kind: "product", slug: "jewelry", topics: ["jewelry"] },
  { kind: "product", slug: "books", topics: ["books"] },
  { kind: "product", slug: "plants-planters", topics: ["plants"] },
  { kind: "product", slug: "vintage-clothing", topics: ["vintage"] },
  { kind: "product", slug: "pets", topics: ["pets"] },
];

// ------------------------------------------------------------ Location hours (representation only)
// public.location_hours: weekly periods in LOCAL minutes. open_minute is
// 0–1439; close_minute is (open_minute, open_minute + 1440] — a value above
// 1440 runs past midnight into the next day (Fri 17:00 → Sat 02:00 =
// 1020 → 1560). No "24:00" strings, no time type. Weekday is ISO (1 = Mon
// … 7 = Sun), matching Postgres extract(isodow). Several rows on a day =
// split hours. A whole day = 0 → 1440. A day with no rows = closed (when
// hours_status = 'regular'). Unknown hours = locations.hours_status NULL.
// Dated exceptions (holidays, special hours, closures) replace the weekly
// periods for every date they cover. The evaluator (Open Now / At / Until
// / Late, 22:00 local) is a later pass.

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
/** Canonical "Open Late" threshold (query semantics, not taxonomy). */
export const OPEN_LATE_MINUTE = 22 * 60;

/** NULL = unknown hours — never evaluated as open. */
export const HOURS_STATUSES = ["regular", "by_appointment", "event_only", "temporarily_closed"] as const;
export type HoursStatus = (typeof HOURS_STATUSES)[number];

export const HOURS_EXCEPTION_KINDS = ["closed", "special_hours"] as const;
export type HoursExceptionKind = (typeof HOURS_EXCEPTION_KINDS)[number];
export const HOURS_EXCEPTION_REASONS = ["holiday", "temporary_closure", "special_event", "seasonal", "other"] as const;

export interface HoursPeriod {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  openMinute: number;
  closeMinute: number;
}

export interface DayPeriod {
  openMinute: number;
  closeMinute: number;
}

export interface HoursException {
  startsOn: string;
  endsOn: string;
  kind: HoursExceptionKind;
  reason?: (typeof HOURS_EXCEPTION_REASONS)[number];
  label?: string;
  periods: DayPeriod[];
}

export interface LocationHoursV2 {
  status: HoursStatus | null;
  timezone: string | null;
  weekly: HoursPeriod[];
  exceptions: HoursException[];
}

const periodValid = (p: DayPeriod) =>
  Number.isInteger(p.openMinute) && Number.isInteger(p.closeMinute) && p.openMinute >= 0 && p.openMinute < MINUTES_PER_DAY && p.closeMinute > p.openMinute && p.closeMinute <= p.openMinute + MINUTES_PER_DAY;

/** A weekly period as [start, end) ranges on the week-minute circle
 * (Mon 00:00 = 0), split where Sunday night wraps into Monday. */
export function weekRanges(p: HoursPeriod): [number, number][] {
  const start = (p.weekday - 1) * MINUTES_PER_DAY + p.openMinute;
  const end = start + (p.closeMinute - p.openMinute);
  return end <= MINUTES_PER_WEEK ? [[start, end]] : [[start, MINUTES_PER_WEEK], [0, end - MINUTES_PER_WEEK]];
}

const overlaps = (x: [number, number], y: [number, number]) => x[0] < y[1] && y[0] < x[1];

/** The same invariants the database triggers enforce. Problems, or []. */
export function validateHours(h: LocationHoursV2): string[] {
  const problems: string[] = [];
  if (h.status !== null && !(HOURS_STATUSES as readonly string[]).includes(h.status)) problems.push("unknown hours status");
  h.weekly.forEach((p, i) => {
    if (!(Number.isInteger(p.weekday) && p.weekday >= 1 && p.weekday <= 7)) problems.push(`weekly[${i}]: weekday must be 1–7`);
    if (!periodValid(p)) problems.push(`weekly[${i}]: invalid period`);
  });
  for (let i = 0; i < h.weekly.length; i++)
    for (let j = i + 1; j < h.weekly.length; j++)
      if (weekRanges(h.weekly[i]).some((x) => weekRanges(h.weekly[j]).some((y) => overlaps(x, y)))) problems.push(`weekly[${i}] overlaps weekly[${j}]`);
  if (h.status === "regular" && h.weekly.length === 0) problems.push("regular hours need at least one period");
  // Weekly periods belong to regular hours (kept while temporarily closed,
  // for the reopening). Unknown / by-appointment / event-only have none.
  if (h.weekly.length > 0 && h.status !== "regular" && h.status !== "temporarily_closed") problems.push(`${h.status ?? "unknown"} hours have no weekly periods`);
  h.exceptions.forEach((e, i) => {
    if (!(e.startsOn <= e.endsOn)) problems.push(`exceptions[${i}]: ends before it starts`);
    if (e.kind === "closed" && e.periods.length > 0) problems.push(`exceptions[${i}]: a closure has no periods`);
    if (e.kind === "special_hours" && e.periods.length === 0) problems.push(`exceptions[${i}]: special hours need a period`);
    e.periods.forEach((p, k) => {
      if (!periodValid(p)) problems.push(`exceptions[${i}].periods[${k}]: invalid period`);
    });
    for (let k = 0; k < e.periods.length; k++)
      for (let m = k + 1; m < e.periods.length; m++)
        if (overlaps([e.periods[k].openMinute, e.periods[k].closeMinute], [e.periods[m].openMinute, e.periods[m].closeMinute])) problems.push(`exceptions[${i}]: periods overlap`);
  });
  for (let i = 0; i < h.exceptions.length; i++)
    for (let j = i + 1; j < h.exceptions.length; j++) {
      const x = h.exceptions[i];
      const y = h.exceptions[j];
      if (x.startsOn <= y.endsOn && y.startsOn <= x.endsOn) problems.push(`exceptions[${i}] overlaps exceptions[${j}]`);
    }
  return problems;
}

/** "07:00" → 420 (local minutes after midnight). */
export function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`bad time ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
