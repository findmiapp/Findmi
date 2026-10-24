import { normalizeAvailabilityRelationships, type AvailabilityRelationship } from "@/lib/business-availability-domain";
import { STATE_BY_NAME, STATE_BY_USPS } from "@/lib/geo/states";

/** Locator Import — the Findmi side of the mapping. Every source (a CSV today,
 * a store-locator feed later) is reduced to these fields; everything after
 * this file works on `ImportRowData`, never on source columns. */

export const IMPORT_FIELDS = [
  { key: "externalId", label: "Source ID", hint: "A stable id from the source — lets a repeat import update instead of duplicate.", required: false },
  { key: "name", label: "Location Name", hint: "The store or place name.", required: true },
  { key: "address", label: "Street Address", hint: "With the building number.", required: true },
  { key: "city", label: "City", hint: "", required: true },
  { key: "state", label: "State", hint: "", required: true },
  { key: "postalCode", label: "ZIP", hint: "", required: false },
  { key: "website", label: "Website", hint: "", required: false },
  { key: "phone", label: "Phone", hint: "", required: false },
  { key: "relationship", label: "How You’re There", hint: "Stocked, sold, served, featured or sampled. Separate several with a comma.", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export const IMPORT_FIELD_KEYS: readonly ImportFieldKey[] = IMPORT_FIELDS.map((f) => f.key);
export const isImportFieldKey = (v: unknown): v is ImportFieldKey => typeof v === "string" && (IMPORT_FIELD_KEYS as readonly string[]).includes(v);

/** field key → source column index (or absent = not mapped). */
export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Header aliases (normalized). Common store-locator export vocabulary. */
const ALIASES: Record<ImportFieldKey, string[]> = {
  externalId: ["id", "store id", "storeid", "location id", "locationid", "source id", "external id", "retailer id", "dealer id", "account id", "account number", "store number", "store no", "store code", "site id", "uuid"],
  name: ["name", "location name", "store name", "store", "retailer", "retailer name", "dealer", "dealer name", "venue", "venue name", "place", "place name", "title", "business name", "account name", "account", "location"],
  address: ["address", "street address", "street", "address 1", "address1", "address line 1", "addr", "street 1", "location address", "store address", "address line1"],
  city: ["city", "town", "locality", "municipality"],
  state: ["state", "st", "province", "region", "state province", "state code", "state abbreviation"],
  postalCode: ["zip", "zip code", "zipcode", "postal code", "postal", "postcode", "post code"],
  website: ["website", "web site", "url", "site", "web", "website url", "homepage", "link"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "contact number"],
  relationship: ["relationship", "type", "how", "availability", "relation", "carries", "channel"],
};

/** Best-guess mapping for a header row: each field takes the first column
 * whose name matches one of its aliases, and a column is used once. Exact
 * alias matches win over the looser "contains" fallback. */
export function detectMapping(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(norm);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const order: ImportFieldKey[] = ["externalId", "name", "address", "city", "state", "postalCode", "website", "phone", "relationship"];
  for (const key of order) {
    const exact = normalized.findIndex((h, i) => !used.has(i) && ALIASES[key].includes(h));
    if (exact >= 0) {
      mapping[key] = exact;
      used.add(exact);
    }
  }
  // Looser: a header that ends with / contains a distinctive alias
  // ("Store Street Address" → address). Only for fields still unmapped.
  const LOOSE: Partial<Record<ImportFieldKey, RegExp>> = {
    name: /\b(store|location|retailer|venue|dealer) name\b|\bname\b/,
    address: /\baddress\b|\bstreet\b/,
    city: /\bcity\b/,
    state: /\bstate\b|\bprovince\b/,
    postalCode: /\bzip\b|\bpostal\b|\bpostcode\b/,
    website: /\bwebsite\b|\burl\b/,
    phone: /\bphone\b|\btelephone\b/,
  };
  for (const key of order) {
    if (mapping[key] !== undefined) continue;
    const re = LOOSE[key];
    if (!re) continue;
    const loose = normalized.findIndex((h, i) => !used.has(i) && re.test(h));
    if (loose >= 0) {
      mapping[key] = loose;
      used.add(loose);
    }
  }
  return mapping;
}

/** Sanitizes a client-supplied mapping against the real column count. */
export function cleanMapping(raw: unknown, columnCount: number): ColumnMapping {
  const out: ColumnMapping = {};
  if (!raw || typeof raw !== "object") return out;
  const used = new Set<number>();
  for (const key of IMPORT_FIELD_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= columnCount || used.has(v)) continue;
    out[key] = v;
    used.add(v);
  }
  return out;
}

/** What must be mapped before a preview makes sense. */
export function missingRequiredMapping(mapping: ColumnMapping): string[] {
  return IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label);
}

/** One source row, normalized into Findmi fields. */
export interface ImportRowData {
  externalId: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  /** Relationships read from the row; null = the row didn't say (use the batch default). */
  relationships: AvailabilityRelationship[] | null;
}

const clean = (v: string | undefined, max = 200) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

/** Accepts "NY" or "New York" → "NY"; unknown text stays as typed. */
export function normalizeImportState(v: string | null): string | null {
  if (!v) return null;
  const t = v.replace(/\./g, "").trim();
  const state = STATE_BY_USPS.get(t.toUpperCase()) ?? STATE_BY_NAME.get(t.toLowerCase());
  return state ? state.usps : t.slice(0, 40);
}

const REL_SYNONYMS: Record<string, AvailabilityRelationship> = {
  stocked: "stocked", stock: "stocked", stocks: "stocked", carried: "stocked", carries: "stocked", retail: "stocked", retailer: "stocked", wholesale: "stocked",
  sold: "sold", sells: "sold", sale: "sold", "for sale": "sold",
  served: "served", serves: "served", "on tap": "served", "on menu": "served", menu: "served", restaurant: "served",
  featured: "featured", feature: "featured", displayed: "featured", display: "featured",
  sampled: "sampled", sample: "sampled", samples: "sampled", tasting: "sampled", tastings: "sampled", demo: "sampled",
};

export function parseImportRelationships(v: string | null): AvailabilityRelationship[] | null {
  if (!v) return null;
  const parts = v.split(/[,;/|&]|\band\b/i).map((p) => norm(p)).filter(Boolean);
  const found = normalizeAvailabilityRelationships(parts.map((p) => REL_SYNONYMS[p]).filter(Boolean));
  return found.length > 0 ? found : null;
}

export function rowFromCells(cells: readonly string[], mapping: ColumnMapping): ImportRowData {
  const at = (key: ImportFieldKey, max?: number) => (mapping[key] === undefined ? null : clean(cells[mapping[key] as number], max));
  const zip = at("postalCode", 20);
  return {
    externalId: at("externalId", 200),
    name: at("name", 160),
    address: at("address", 300),
    city: at("city", 80),
    state: normalizeImportState(at("state", 40)),
    postalCode: zip ? (zip.replace(/\D/g, "").length >= 5 ? zip.replace(/[^\d-]/g, "").slice(0, 10) : zip) : null,
    website: at("website", 300),
    phone: at("phone", 40),
    relationships: parseImportRelationships(at("relationship", 120)),
  };
}

// ── Import target — which Business↔Location relationship a batch writes ────
//
//   find_us_here   business_location_availability (the original import):
//                  places carrying / serving / offering the Business, with
//                  source ids, relationships, products and "Not In This File".
//   our_locations  business_locations: places the Business owns or operates.
//                  New places are created and linked exactly like one-at-a-
//                  time Our Locations creation (pending review, no management
//                  granted); an EXISTING place links only when the importer
//                  already manages it (the Connect rule). Never both.

export type ImportTarget = "find_us_here" | "our_locations";
export const isImportTarget = (v: unknown): v is ImportTarget => v === "find_us_here" || v === "our_locations";
/** URL form (`?target=our-locations`) → target; anything else is Find Us Here. */
export const importTargetFromParam = (v: unknown): ImportTarget => (v === "our-locations" || v === "our_locations" ? "our_locations" : "find_us_here");
export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = { find_us_here: "Find Us Here", our_locations: "Our Locations" };
export const ALREADY_OPERATED_ROW = "Already one of your locations.";
export const NOT_MANAGED_EXISTING_ROW = "This place is already on Findmi but you don’t manage it — claim it from its page, then connect it.";
