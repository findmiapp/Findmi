import { cleanText, jsonLdBlocksOf, usStateCode, JSONLD_MAX_BLOCK_CHARS, JSONLD_MAX_BLOCKS } from "@/lib/brand-website-extract";
import { normalizeStreetAddress } from "@/lib/locationCreation";
import { normalizeLocationHours } from "@/lib/locationHours";
import type { LocationHours, LocationWeekday } from "@/lib/types";
import { cleanLocationPhone, cleanPostalCode } from "./parse";
import { similarLocationNames } from "./resolve";
import type { LocationEvidence, LocationField, LocationProposal, LocationWebsiteFacts } from "./types";

/** Location Import V1 — what an official Location website itself states,
 * from its JSON-LD place data only (LocalBusiness / Place / Organization
 * with a postal address). Never arbitrary body text, never social sites.
 * Pure: the page was already read through the shared safe fetch. */

type Json = Record<string, unknown>;

const PLACE_TYPES = /^(Place|LocalBusiness|Organization|Corporation|EventVenue|CivicStructure|Store|.*Store|Restaurant|.*Restaurant|CafeOrCoffeeShop|BarOrPub|NightClub|Brewery|Winery|Bakery|ArtGallery|Museum|MovieTheater|PerformingArtsTheater|MusicVenue|Hotel|LodgingBusiness|ShoppingCenter|Park|Library|SportsActivityLocation|ExerciseGym|HealthClub|BeautySalon|DaySpa|HairSalon|NailSalon|FoodEstablishment|EntertainmentBusiness|ProfessionalService|CoworkingSpace|Florist)$/;

const typesOf = (node: Json): string[] =>
  (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]])
    .filter((t): t is string => typeof t === "string")
    .slice(0, 8)
    .map((t) => t.split(/[/:#]/).pop() ?? "")
    .filter(Boolean);

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown, max = 200) => cleanText(first(v), max);

interface PlaceNode {
  node: Json;
  types: string[];
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

function addressOf(node: Json): { street: string | null; city: string | null; state: string | null; postalCode: string | null } | null {
  const raw = first(node.address);
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Json;
  const country = first(a.addressCountry);
  const countryName = typeof country === "string" ? country : country && typeof country === "object" ? (country as Json).name : null;
  if (typeof countryName === "string" && !/^(us|usa|united states( of america)?)$/i.test(countryName.trim())) return null;
  const street = str(a.streetAddress, 160);
  if (!street) return null;
  return { street, city: str(a.addressLocality, 80), state: usStateCode(a.addressRegion), postalCode: cleanPostalCode(typeof a.postalCode === "string" ? a.postalCode : null) };
}

/** Bounded JSON-LD walk collecting place-like nodes with a street address. */
function collectPlaces(blocks: string[]): PlaceNode[] {
  const out: PlaceNode[] = [];
  let budget = 300;
  const visit = (value: unknown, depth: number) => {
    if (budget <= 0 || depth > 6 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) visit(item, depth + 1);
      return;
    }
    budget -= 1;
    const node = value as Json;
    const types = typesOf(node);
    if (types.some((t) => PLACE_TYPES.test(t))) {
      const addr = addressOf(node);
      if (addr) out.push({ node, types, ...addr });
    }
    for (const [k, child] of Object.entries(node).slice(0, 100)) if (k !== "@context" && child && typeof child === "object") visit(child, depth + 1);
  };
  for (const block of blocks.slice(0, JSONLD_MAX_BLOCKS)) {
    if (block.length > JSONLD_MAX_BLOCK_CHARS) continue;
    try {
      visit(JSON.parse(block), 0);
    } catch {
      // not JSON — ignored
    }
  }
  return out;
}

const DAY: Record<string, LocationWeekday> = {
  monday: "mon", mo: "mon", mon: "mon",
  tuesday: "tue", tu: "tue", tue: "tue",
  wednesday: "wed", we: "wed", wed: "wed",
  thursday: "thu", th: "thu", thu: "thu",
  friday: "fri", fr: "fri", fri: "fri",
  saturday: "sat", sa: "sat", sat: "sat",
  sunday: "sun", su: "sun", sun: "sun",
};
const ORDER: LocationWeekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayOf = (v: unknown): LocationWeekday | null => (typeof v === "string" ? DAY[(v.split(/[/:#]/).pop() ?? "").trim().toLowerCase()] ?? null : null);

function hhmm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h === 24 && m[2] === "00") return "23:59";
  return h <= 23 && Number(m[2]) <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

function setDay(out: Record<string, unknown>, day: LocationWeekday, open: string | null, close: string | null) {
  if (!open || !close) return;
  if (open === "00:00" && close === "23:59") out[day] = { closed: false, allDay: true };
  else if (open === close) out[day] = { closed: true };
  else out[day] = { closed: false, open, close };
}

/** schema.org opening hours → the existing Location hours model. Days the
 * site doesn't mention stay unset (never guessed closed). */
export function hoursFromSchema(node: Json): LocationHours | null {
  const out: Record<string, unknown> = {};
  const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : node.openingHoursSpecification ? [node.openingHoursSpecification] : [];
  for (const spec of specs.slice(0, 20)) {
    if (!spec || typeof spec !== "object") continue;
    const s = spec as Json;
    // Seasonal / one-off specifications aren't normal operating hours.
    if (s.validFrom || s.validThrough) continue;
    const days = (Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek]).map(dayOf).filter((d): d is LocationWeekday => Boolean(d));
    for (const d of days) setDay(out, d, hhmm(s.opens), hhmm(s.closes));
  }
  const strings = (Array.isArray(node.openingHours) ? node.openingHours : [node.openingHours]).filter((v): v is string => typeof v === "string").slice(0, 14);
  for (const line of strings) {
    // "Mo-Fr 10:00-19:00", "Sa,Su 11:00-18:00", "Mo-Su"
    const m = /^\s*([A-Za-z]{2,9}(?:\s*[-,]\s*[A-Za-z]{2,9})*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(line);
    if (!m) continue;
    const days: LocationWeekday[] = [];
    for (const part of m[1].split(",")) {
      const [a, b] = part.split("-").map((x) => dayOf(x.trim()));
      if (a && b) {
        const i = ORDER.indexOf(a);
        const j = ORDER.indexOf(b);
        if (i <= j) days.push(...ORDER.slice(i, j + 1));
      } else if (a && !part.includes("-")) days.push(a);
    }
    for (const d of days) setDay(out, d, hhmm(m[2]), hhmm(m[3]));
  }
  return normalizeLocationHours(out);
}

function geoOf(node: Json): { latitude: number; longitude: number } | null {
  const g = first(node.geo);
  if (!g || typeof g !== "object") return null;
  const lat = Number((g as Json).latitude);
  const lng = Number((g as Json).longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { latitude: lat, longitude: lng };
}

/** The place facts the site publishes. With a supplied street address,
 * only the entity AT that address is used (a chain's site lists many
 * branches); without one, only when the site lists exactly one address. */
export function extractLocationFacts(html: string, supplied: { address: string | null } = { address: null }): LocationWebsiteFacts {
  const places = collectPlaces(jsonLdBlocksOf(html));
  const streets = new Map<string, PlaceNode>();
  for (const p of places) if (p.street) streets.set(normalizeStreetAddress(p.street), streets.get(normalizeStreetAddress(p.street)) ?? p);
  const wanted = supplied.address ? normalizeStreetAddress(supplied.address) : null;
  const chosen = wanted && streets.has(wanted) ? streets.get(wanted)! : streets.size === 1 ? [...streets.values()][0] : null;
  const empty: LocationWebsiteFacts = { name: null, address: null, city: null, state: null, postalCode: null, phone: null, description: null, hours: null, latitude: null, longitude: null, types: [], multipleAddresses: streets.size > 1 };
  if (!chosen) return empty;
  const geo = geoOf(chosen.node);
  return {
    name: str(chosen.node.name, 120),
    address: chosen.street,
    city: chosen.city,
    state: chosen.state,
    postalCode: chosen.postalCode,
    phone: cleanLocationPhone(typeof first(chosen.node.telephone) === "string" ? (first(chosen.node.telephone) as string) : null),
    description: str(chosen.node.description, 600),
    hours: hoursFromSchema(chosen.node),
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    types: chosen.types,
    multipleAddresses: streets.size > 1,
  };
}

/** schema.org place type → an existing Location category SLUG (exact,
 * maintained list; resolved against live categories; never created). */
export const SCHEMA_TYPE_LOCATION_CATEGORY: Readonly<Record<string, string>> = {
  EventVenue: "event-venue",
  MusicVenue: "event-venue",
  PerformingArtsTheater: "event-venue",
  Restaurant: "restaurant",
  FastFoodRestaurant: "restaurant",
  FoodEstablishment: "restaurant",
  CafeOrCoffeeShop: "cafe-coffee-shop",
  BarOrPub: "bar-lounge",
  NightClub: "bar-lounge",
  Brewery: "brewery-taproom",
  Winery: "brewery-taproom",
  ArtGallery: "gallery",
  Hotel: "hotel",
  LodgingBusiness: "hotel",
  Park: "park-outdoor-space",
  CoworkingSpace: "coworking-space",
  Store: "retail-store",
  ClothingStore: "retail-store",
  ShoeStore: "retail-store",
  JewelryStore: "retail-store",
  BookStore: "retail-store",
  DepartmentStore: "retail-store",
  HomeGoodsStore: "retail-store",
  ShoppingCenter: "market",
};

export interface LocationCategoryOption {
  id: string;
  name: string;
  slug: string;
}

const catNorm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** The operator's written category ("Event Venue", "event-venue",
 * "Café"), or the website's schema type — exact matches only. */
export function resolveLocationCategory(written: string | null, types: readonly string[], categories: readonly LocationCategoryOption[]): string | null {
  if (written?.trim()) {
    const w = catNorm(written);
    const exact = categories.find((c) => catNorm(c.name) === w || catNorm(c.slug) === w);
    if (exact) return exact.id;
    // One word naming exactly one category ("Gallery", "Hotel", "Café").
    const byWord = w.length >= 4 ? categories.filter((c) => catNorm(c.name).split(" ").includes(w)) : [];
    if (byWord.length === 1) return byWord[0].id;
  }
  const slugs = new Set(types.filter((t) => Object.hasOwn(SCHEMA_TYPE_LOCATION_CATEGORY, t)).map((t) => SCHEMA_TYPE_LOCATION_CATEGORY[t]));
  if (slugs.size !== 1) return null;
  return categories.find((c) => c.slug === [...slugs][0])?.id ?? null;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") === (b ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Evidence (+ website facts) → the reviewable proposal. Supplied values
 * always win; the website fills only empty fields; a material conflict is
 * FLAGGED, never applied. When the website's address differs from the
 * supplied one, nothing address-bound (phone, hours, map position) is taken
 * from it — it may describe another branch. */
export function buildLocationProposal(e: LocationEvidence, facts: LocationWebsiteFacts | null, categories: readonly LocationCategoryOption[]): LocationProposal {
  const sources: LocationProposal["sources"] = {};
  const conflicts: LocationProposal["conflicts"] = [];
  const notes: string[] = [];
  const pick = (field: LocationField, provided: string | null, site: string | null, equal: (a: string, b: string) => boolean = same): string => {
    if (provided) {
      sources[field] = "provided";
      if (site && !equal(provided, site)) conflicts.push({ field, provided, website: site });
      return provided;
    }
    if (site) {
      sources[field] = "website";
      return site;
    }
    return "";
  };

  const streetConflict = Boolean(facts?.address && e.address && normalizeStreetAddress(facts.address) !== normalizeStreetAddress(e.address));
  const zipConflict = Boolean(facts?.postalCode && e.postalCode && facts.postalCode.slice(0, 5) !== e.postalCode.slice(0, 5));
  const placeConflict = streetConflict || zipConflict;
  if (facts?.multipleAddresses && !facts.address) notes.push("The website lists several addresses and none matches this one — only general website details were used.");
  if (placeConflict) notes.push("The website lists a different address — review it. Its phone, hours and map position weren't used.");

  const name = pick("name", e.name, facts?.name ?? null, (a, b) => similarLocationNames(a, b));
  const address = pick("address", e.address, facts?.address ?? null, (a, b) => normalizeStreetAddress(a) === normalizeStreetAddress(b));
  // City / state / ZIP from the website only together with ITS street.
  const fromSite = !e.address && facts?.address;
  const city = pick("city", e.city, e.address && !placeConflict ? facts?.city ?? null : fromSite ? facts?.city ?? null : null);
  const state = pick("state", e.state, e.address && !placeConflict ? facts?.state ?? null : fromSite ? facts?.state ?? null : null);
  const postalCode = pick("postalCode", e.postalCode, !placeConflict ? facts?.postalCode ?? null : null, (a, b) => a.slice(0, 5) === b.slice(0, 5));
  const phone = pick("phone", e.phone, placeConflict ? null : facts?.phone ?? null, (a, b) => a.replace(/\D/g, "").slice(-10) === b.replace(/\D/g, "").slice(-10));
  const description = pick("description", e.description, facts?.description ?? null, () => true);
  const website = e.website ?? "";
  if (website) sources.website = "provided";

  const hours = placeConflict ? null : facts?.hours ?? null;
  if (hours) sources.hours = "website";
  const geo = !placeConflict && facts?.latitude != null && facts?.longitude != null ? { latitude: facts.latitude, longitude: facts.longitude } : null;
  if (geo) sources.coordinates = "website";

  const categoryId = resolveLocationCategory(e.category, facts?.types ?? [], categories);
  if (categoryId) sources.category = e.category && resolveLocationCategory(e.category, [], categories) ? "provided" : "website";
  if (e.category && !resolveLocationCategory(e.category, [], categories)) notes.push(`"${e.category}" isn't a Findmi Location category — choose one.`);

  return {
    name,
    address,
    city,
    state,
    postalCode,
    website,
    phone,
    description,
    categoryId,
    hours,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    sources,
    conflicts,
    notes,
    logo: null,
    cover: null,
  };
}
