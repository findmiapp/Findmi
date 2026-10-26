// Taxonomy V2 — Pass 2: legacy → V2 mapping (pure; client + server).
//
// Every V1 classification row (public.categories, all five kinds) maps to
// the V2 concept(s) it means — a V2 Category of the same entity kind, an
// Event Type, Experience Mechanic, Topic, Business Model or Audience — with
// a confidence PER TARGET:
//
//   deterministic     the V1 value proves it → backfilled as a confirmed
//                     assignment (source 'migration')
//   review_required   plausible, not provable → a classification
//                     suggestion only; never powers discovery
//
// and a row-level status: deterministic (every target deterministic),
// review_required (any target needs review), intentionally_unmapped (no
// V2 meaning — e.g. "Other", "Residential", a season-as-category).
//
// Slug similarity is never the evidence; the V1 row's own name and real
// usage are (production inventory, Pass 2). Mirrors the generated
// taxonomy_legacy_mappings rows in
// supabase/migrations/20261117000000_taxonomy_v2_staged_categories.sql.

import { V2_TREES, type CategoryNode, type V2CategoryKind } from "./v2";

export type LegacyKind = V2CategoryKind | "event_format";
export type TargetDimension = "category" | "event_type" | "experience_mechanic" | "topic" | "business_model" | "audience";
export type TargetConfidence = "deterministic" | "review_required";
export type MappingStatus = "deterministic" | "review_required" | "intentionally_unmapped";

export interface MappingTarget {
  dimension: TargetDimension;
  value: string;
  confidence: TargetConfidence;
}

export interface LegacyMapping {
  kind: LegacyKind;
  slug: string;
  targets: MappingTarget[];
  note?: string;
}

const D = (dimension: TargetDimension, value: string): MappingTarget => ({ dimension, value, confidence: "deterministic" });
const R = (dimension: TargetDimension, value: string): MappingTarget => ({ dimension, value, confidence: "review_required" });
const m = (kind: LegacyKind, slug: string, targets: MappingTarget[], note?: string): LegacyMapping => ({ kind, slug, targets, ...(note ? { note } : {}) });

export const mappingStatus = (x: LegacyMapping): MappingStatus =>
  x.targets.length === 0 ? "intentionally_unmapped" : x.targets.every((t) => t.confidence === "deterministic") ? "deterministic" : "review_required";

/** The V2 Category kind a legacy row's category targets belong to. */
export const categoryKindOf = (k: LegacyKind): V2CategoryKind => (k === "event_format" ? "event" : k);

// ------------------------------------------------------------ Event categories → Domain / Type / Mechanic / Topic / Audience

const EVENT: LegacyMapping[] = [
  m("event", "art-exhibitions", [D("category", "arts-culture"), D("topic", "art"), R("event_type", "exhibition")], "Art events are not all exhibitions."),
  m("event", "books-talks", [D("category", "arts-culture"), D("topic", "books"), R("event_type", "talk-panel")]),
  m("event", "design", [D("category", "arts-culture"), D("topic", "design")]),
  m("event", "film-screenings", [D("category", "arts-culture"), D("topic", "film"), R("event_type", "screening")], "Could be a film festival."),
  m("event", "beauty-makeup", [D("category", "beauty-wellness"), D("topic", "beauty")]),
  m("event", "fragrance", [D("category", "beauty-wellness"), D("topic", "fragrance")]),
  m("event", "skincare", [D("category", "beauty-wellness"), D("topic", "skincare")]),
  m("event", "wellness-self-care", [D("category", "beauty-wellness"), D("topic", "wellness")]),
  m("event", "ai", [D("category", "business-tech"), D("topic", "ai")]),
  m("event", "careers-networking", [D("category", "business-tech"), D("topic", "careers"), R("event_type", "networking")]),
  m("event", "developers-engineering", [D("category", "business-tech"), D("topic", "tech")]),
  m("event", "finance-investing", [D("category", "business-tech")]),
  m("event", "founders-startups", [D("category", "business-tech"), D("topic", "startups")]),
  m("event", "community-social", [R("category", "community-causes")], "V1 'Community & Social' is wider than causes."),
  m("event", "causes-volunteering", [D("category", "community-causes"), R("event_type", "volunteer-event")]),
  m("event", "local-festivals-street-fairs", [R("category", "community-causes"), R("event_type", "festival")]),
  m("event", "meetups-socials", [R("category", "community-causes"), D("event_type", "meetup-social")]),
  m("event", "comedy", [D("category", "entertainment"), D("topic", "comedy")]),
  m("event", "games-trivia", [D("category", "entertainment")]),
  m("event", "immersive-experiences", [D("category", "entertainment"), D("event_type", "immersive-experience")]),
  m("event", "theater-performance", [D("category", "entertainment"), D("topic", "theater"), D("event_type", "performance")]),
  m("event", "family-kids", [R("audience", "family")], "Audience, not a Category; kids vs family not provable."),
  m("event", "family-experiences", [R("audience", "family")]),
  m("event", "kids-activities", [R("audience", "kids")]),
  m("event", "parenting", [D("topic", "parenting")]),
  m("event", "fashion-style", [D("category", "shopping-style"), D("topic", "fashion")]),
  m("event", "fashion", [D("category", "shopping-style"), D("topic", "fashion")]),
  m("event", "jewelry-accessories", [D("category", "shopping-style"), D("topic", "jewelry")]),
  m("event", "streetwear-sneakers", [D("category", "shopping-style"), D("topic", "streetwear"), D("topic", "sneakers")]),
  m("event", "baking-sweets", [D("category", "food-drink"), D("topic", "bakery-pastry")]),
  m("event", "coffee-tea", [D("category", "food-drink"), R("topic", "coffee"), R("topic", "tea")], "Coffee OR tea — either Topic alone is unproven."),
  m("event", "dining-experiences", [D("category", "food-drink"), D("event_type", "dining-experience")]),
  m("event", "food-festival", [D("category", "food-drink"), D("event_type", "festival")]),
  m("event", "tastings-drinks", [D("category", "food-drink"), R("event_type", "tasting")]),
  m("event", "djs-dance", [D("category", "music-nightlife"), D("topic", "djs-dance")]),
  m("event", "live-music", [D("category", "music-nightlife"), D("topic", "live-music"), R("event_type", "performance")], "A festival can feature live music."),
  m("event", "parties-nightlife", [D("category", "music-nightlife"), R("event_type", "party")]),
  m("event", "pets-animals", [D("topic", "pets")]),
  m("event", "adoption-rescue", [D("category", "community-causes"), D("topic", "pets")]),
  m("event", "pet-events", [D("topic", "pets")]),
  m("event", "pet-friendly-experiences", [R("topic", "pets")], "Pet-friendly is not 'about pets'."),
  m("event", "seasonal-holiday", [], "A season is a Topic, not a Category."),
  m("event", "cultural-celebrations", [R("category", "community-causes")]),
  m("event", "halloween-fall", [R("topic", "halloween")], "'Halloween & Fall' — a fall event is not a Halloween event."),
  m("event", "holiday-winter", [R("topic", "winter-holidays")]),
  m("event", "spring-summer", [R("topic", "summer")]),
  m("event", "shopping-retail", [D("category", "shopping-style")]),
  m("event", "markets-pop-ups", [R("category", "shopping-style"), R("event_type", "market"), R("experience_mechanic", "pop-up")], "V1 'Markets & Fairs' (slug markets-pop-ups) is a catch-all: it holds immersive, pet and brand events."),
  m("event", "retail-experiences", [D("category", "shopping-style"), D("experience_mechanic", "retail-experience")]),
  m("event", "sample-sales", [D("category", "shopping-style"), D("event_type", "shopping-event"), D("experience_mechanic", "sample-sale")]),
  m("event", "vintage-resale", [D("category", "shopping-style"), D("topic", "vintage")]),
  m("event", "fitness-classes", [D("category", "sports-fitness"), D("topic", "fitness"), R("event_type", "fitness-session")]),
  m("event", "outdoor-recreation", [D("category", "outdoors-nature")]),
  m("event", "running", [D("category", "sports-fitness"), D("topic", "running")]),
  m("event", "sports-watch-parties", [D("category", "sports-fitness"), D("event_type", "watch-party")]),
  m("event", "workshops-classes", [R("event_type", "class"), R("event_type", "workshop")], "Class vs workshop, and no domain."),
  m("event", "art-craft-classes", [D("category", "arts-culture"), D("topic", "crafts-diy"), R("event_type", "class")]),
  m("event", "cooking-classes", [D("category", "food-drink"), D("event_type", "class")]),
  m("event", "professional-skill-building", [D("category", "business-tech"), R("topic", "careers"), R("event_type", "class")]),
];

// ------------------------------------------------------------ Event Formats → Event Type / Experience Mechanic

const EVENT_FORMAT: LegacyMapping[] = [
  m("event_format", "brand-activation", [D("experience_mechanic", "brand-activation")]),
  m("event_format", "pop-up", [D("experience_mechanic", "pop-up")]),
  m("event_format", "sampling", [D("experience_mechanic", "sampling")]),
  m("event_format", "product-launch", [D("experience_mechanic", "product-launch")]),
  m("event_format", "retail-experience", [D("experience_mechanic", "retail-experience")]),
  m("event_format", "sample-sale", [D("experience_mechanic", "sample-sale")]),
  m("event_format", "market", [D("event_type", "market")]),
  m("event_format", "festival", [D("event_type", "festival")]),
  m("event_format", "networking", [D("event_type", "networking")]),
  m("event_format", "talk-panel", [D("event_type", "talk-panel")]),
  m("event_format", "workshop", [D("event_type", "workshop")]),
  m("event_format", "conference", [D("event_type", "conference")]),
  m("event_format", "exhibition", [D("event_type", "exhibition")]),
  m("event_format", "immersive-experience", [D("event_type", "immersive-experience")]),
  m("event_format", "performance", [D("event_type", "performance")]),
  m("event_format", "party-social", [R("event_type", "party"), R("event_type", "meetup-social")], "Party vs Meetup & Social."),
];

// ------------------------------------------------------------ Business categories → Category / Business Model / Topic

const BUSINESS: LegacyMapping[] = [
  m("business", "agency", [D("category", "services"), D("business_model", "agency")]),
  m("business", "art-illustration", [D("category", "art"), R("business_model", "maker_artist")]),
  m("business", "author", [D("category", "publishing-books")]),
  m("business", "bakery-sweets", [D("category", "bakery-desserts")]),
  m("business", "beauty-self-care", [D("category", "beauty-personal-care")]),
  m("business", "classes-workshops", [R("category", "services"), R("business_model", "service_provider")], "Industry unknown (cooking? art? fitness?)."),
  m("business", "coffee", [D("category", "food-beverage"), R("category", "coffee-tea"), R("topic", "coffee")], "V1 'Coffee, Tea & Beverages' also holds tea and other drink brands."),
  m("business", "events-event-services", [D("category", "events-hospitality"), R("business_model", "organizer")], "Event services may be vendors, not organizers."),
  m("business", "experiences-entertainment", [D("category", "entertainment")]),
  m("business", "flowers", [D("category", "plants-garden")]),
  m("business", "food-drink", [D("category", "food-beverage")]),
  m("business", "food-truck", [D("category", "restaurants-food-service"), D("business_model", "food_service")]),
  m("business", "gifts-specialty-goods", [R("category", "home-goods"), D("topic", "gifts")]),
  m("business", "health-fitness-wellness", [D("category", "health-wellness")]),
  m("business", "home-decor", [D("category", "home-living"), R("category", "furniture-decor")]),
  m("business", "home-local-services", [D("category", "services"), D("business_model", "service_provider")]),
  m("business", "jewelry-accessories", [D("category", "fashion-apparel")], "Jewelry AND accessories → their shared parent."),
  m("business", "kids-family", [R("category", "kids-baby")], "Kids products vs kids activities vs family."),
  m("business", "makers-goods", [D("category", "makers"), D("business_model", "maker_artist")]),
  m("business", "markets-pop-ups", [R("category", "event-production"), R("business_model", "organizer")], "Market organizer vs a brand that pops up."),
  m("business", "music-performers", [D("category", "music"), R("business_model", "maker_artist")]),
  m("business", "other", [], "No meaning to carry."),
  m("business", "packaged-goods", [R("category", "packaged-food")], "May be non-food consumer goods."),
  m("business", "photography-creative", [R("category", "art"), R("category", "film-video")]),
  m("business", "professional-services", [D("category", "services"), D("business_model", "service_provider")]),
  m("business", "retail", [D("business_model", "retailer")], "A business model, not an industry: no V2 Category."),
];

// ------------------------------------------------------------ Location categories → Category

const LOCATION: LegacyMapping[] = [
  m("location", "brewery-taproom", [D("category", "food-drink"), R("category", "bar-lounge")]),
  m("location", "campus", [D("category", "work-education"), R("category", "school-campus")], "A corporate campus is not a school."),
  m("location", "grocery", [D("category", "food-drink"), R("category", "specialty-food-shop")]),
  m("location", "market", [R("category", "market-hall"), R("category", "shopping")], "Market hall vs open-air market."),
  m("location", "office-workplace", [D("category", "work-education")]),
  m("location", "other", []),
  m("location", "park-outdoor-space", [D("category", "outdoors"), R("category", "park")], "'Park / Outdoor Space' also covers plazas and piers."),
  m("location", "residential", [], "Never public."),
  m("location", "studio", [R("category", "wellness-studio"), R("category", "arts-culture")], "Fitness, art, photo or rental studio."),
];

// ------------------------------------------------------------ Product categories → Category / Topic

const GIFT_OCCASIONS = ["baby-shower", "birthday", "corporate-gifts", "gift-boxes-sets", "holiday-seasonal", "housewarming", "other-gifts", "party-favors", "personalized-gifts", "wedding"];
const PRODUCT: LegacyMapping[] = [
  m("product", "apparel-accessories", [R("category", "apparel"), R("category", "accessories-jewelry")], "Legacy combined top-level."),
  m("product", "beauty-wellness", [R("category", "beauty-personal-care"), R("category", "wellness")]),
  m("product", "books-2", [D("category", "books")], "Duplicate orphan of Books & Media › Books."),
  m("product", "clothing", [D("category", "apparel")]),
  m("product", "food-drink", [R("category", "food-snacks"), R("category", "beverages")]),
  m("product", "other-beauty-wellness", [R("category", "beauty-personal-care"), R("category", "wellness")]),
  m("product", "gifts-occasions", [D("topic", "gifts")], "An occasion/use, not a product Category."),
  ...GIFT_OCCASIONS.map((s) => m("product", s, [D("topic", "gifts")], "An occasion/use, not a product Category.")),
];

const walk = (nodes: CategoryNode[]): CategoryNode[] => nodes.flatMap((x) => [x, ...walk(x.children ?? [])]);

/** Every reused V1 row maps to itself, deterministically. */
const identity = (kind: V2CategoryKind): LegacyMapping[] => walk(V2_TREES[kind]).filter((x) => x.reuse).map((x) => m(kind, x.slug, [D("category", x.slug)]));

export const LEGACY_MAPPINGS: LegacyMapping[] = [
  ...identity("event"), ...EVENT, ...EVENT_FORMAT,
  ...identity("business"), ...BUSINESS,
  ...identity("location"), ...LOCATION,
  ...identity("product"), ...PRODUCT,
];

/** V2 nodes per kind, flattened (slug → node, depth, parent). */
export function v2Nodes(kind: V2CategoryKind): { slug: string; name: string; reuse: boolean; depth: number; parent: string | null }[] {
  const out: { slug: string; name: string; reuse: boolean; depth: number; parent: string | null }[] = [];
  const go = (nodes: CategoryNode[], depth: number, parent: string | null) => {
    for (const x of nodes) {
      out.push({ slug: x.slug, name: x.name, reuse: Boolean(x.reuse), depth, parent });
      go(x.children ?? [], depth + 1, x.slug);
    }
  };
  go(V2_TREES[kind], 1, null);
  return out;
}

/** Appearance Type SUGGESTIONS from a linked Event's single Mechanic /
 * Type (never inherited as truth). */
export const APPEARANCE_TYPE_SUGGESTIONS: { legacyFormat: string; appearanceType: string }[] = [
  { legacyFormat: "sampling", appearanceType: "sampling-demo" },
  { legacyFormat: "pop-up", appearanceType: "pop-up" },
  { legacyFormat: "brand-activation", appearanceType: "activation" },
  { legacyFormat: "market", appearanceType: "vendor-booth" },
];
