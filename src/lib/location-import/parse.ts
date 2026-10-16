import { normalizeStreetAddress } from "@/lib/locationCreation";
import { usStateCode } from "@/lib/brand-website-extract";
import { LOCATION_IMPORT_MAX, type LocationEvidence } from "./types";

/** Location Import V1 — structured paste.
 *
 *   LOCATION 1
 *   Location Name: LAVAN Chelsea
 *   Website: https://example.com
 *   Street Address: 541 W 25th St
 *   City: New York
 *   State: NY
 *   ZIP: 10001
 *   === END LOCATION 1 ===
 *
 * One block without markers is one Location. Unknown labels are reported,
 * never guessed into a field. The same place pasted twice is ONE row. */

const FIELD_LABELS: Record<string, keyof Fields> = {
  "location name": "name",
  "location": "name",
  "name": "name",
  "venue": "name",
  "venue name": "name",
  "place": "name",
  "place name": "name",
  "website": "website",
  "location website": "website",
  "official website": "website",
  "website url": "website",
  "url": "website",
  "street address": "address",
  "address": "address",
  "street": "address",
  "city": "city",
  "state": "state",
  "zip": "postalCode",
  "zip code": "postalCode",
  "postal code": "postalCode",
  "postcode": "postalCode",
  "phone": "phone",
  "phone number": "phone",
  "telephone": "phone",
  "category": "category",
  "location category": "category",
  "description": "description",
  "about": "description",
};

interface Fields {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  category: string | null;
  description: string | null;
}

const BLOCK_START = /^\s*LOCATION\s+(\d{1,3})\s*:?\s*$/i;
const BLOCK_END = /^\s*=+\s*END\s+LOCATION\s*\d*\s*=+\s*$/i;
const LINE = /^\s*([A-Za-z][A-Za-z ]{0,30}?)\s*:\s*(.*)$/;
const FIELD_MAX = 300;
const DESCRIPTION_MAX = 2000;

export type LocationPasteResult =
  | { ok: true; locations: LocationEvidence[]; blocks: number }
  | { ok: false; error: string };

function clean(value: string, max = FIELD_MAX): string | null {
  const v = value.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}

/** https URL for a supplied website ("knix.com" → "https://knix.com/"), or null. */
export function normalizeLocationWebsite(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    url.protocol = "https:";
    url.hash = "";
    return url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

/** Plain phone text with at least 7 digits, or null. */
export function cleanLocationPhone(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v || v.length > 40) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[+()\d\s.\-x#ext]+$/i.test(v) ? v : null;
}

/** A 5-digit ZIP (ZIP+4 kept) or null. */
export function cleanPostalCode(value: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:-(\d{4}))?\s*$/.exec(value ?? "");
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null;
}

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Batch identity: the same name at the same street and locality. Two
 * different addresses never share a key, whatever the name. */
export function locationEvidenceKey(e: { name: string | null; address: string | null; city: string | null; state: string | null; postalCode: string | null }): string {
  const zip = (e.postalCode ?? "").slice(0, 5);
  const locality = zip || `${norm(e.city)}/${norm(e.state)}`;
  return `${norm(e.name)}|${e.address ? normalizeStreetAddress(e.address) : ""}|${locality}`;
}

/** "541 W 25th St, New York, NY 10001" → its parts (only when the paste
 * gave no separate City). */
function splitOneLineAddress(address: string): { address: string; city: string; state: string | null; postalCode: string | null } | null {
  const m = /^(.+?),\s*([^,]+?),\s*([A-Za-z .]+?)\s*(\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?$/i.exec(address);
  if (!m) return null;
  const state = usStateCode(m[3]);
  if (!state) return null;
  return { address: m[1].trim(), city: m[2].trim(), state, postalCode: m[4] ?? null };
}

function toEvidence(fields: Fields, label: string, warnings: string[]): LocationEvidence {
  let { address, city, state, postalCode } = fields;
  if (address && !city) {
    const split = splitOneLineAddress(address);
    if (split) ({ address, city, state, postalCode } = { address: split.address, city: split.city, state: state ?? split.state, postalCode: postalCode ?? split.postalCode });
  }
  const stateCode = state ? usStateCode(state) ?? state : null;
  const website = normalizeLocationWebsite(fields.website);
  if (fields.website && !website) warnings.push(`${label}: the Website isn't a web address — left out.`);
  const phone = cleanLocationPhone(fields.phone);
  if (fields.phone && !phone) warnings.push(`${label}: the Phone doesn't look like a phone number — left out.`);
  const zip = cleanPostalCode(postalCode);
  if (postalCode && !zip) warnings.push(`${label}: the ZIP isn't a 5-digit ZIP — left out.`);
  const e = { name: fields.name, address, city, state: stateCode, postalCode: zip };
  return {
    key: locationEvidenceKey(e),
    labels: [label],
    ...e,
    website,
    phone,
    category: fields.category,
    description: fields.description,
    warnings,
  };
}

function parseBlock(lines: string[], label: string): LocationEvidence | null {
  const fields: Fields = { name: null, address: null, city: null, state: null, postalCode: null, website: null, phone: null, category: null, description: null };
  const warnings: string[] = [];
  let last: keyof Fields | null = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = LINE.exec(raw);
    const field = m ? FIELD_LABELS[m[1].trim().toLowerCase()] : undefined;
    // "https://…" is a value, not a "https" label.
    if (m && field && !/^\/\//.test(m[2])) {
      const value = field === "description" ? clean(m[2], DESCRIPTION_MAX) : clean(m[2]);
      if (value) fields[field] = field === "description" && fields.description ? `${fields.description}\n${value}`.slice(0, DESCRIPTION_MAX) : value;
      last = field;
    } else if (m && !field && !/^https?$/i.test(m[1].trim())) {
      warnings.push(`${label}: "${m[1].trim()}" isn't a Location field — ignored.`);
      last = null;
    } else if (last === "description") {
      const value = clean(raw, DESCRIPTION_MAX);
      if (value) fields.description = `${fields.description ?? ""}\n${value}`.trim().slice(0, DESCRIPTION_MAX);
    }
  }
  if (!fields.name && !fields.address) return null;
  return toEvidence(fields, label, warnings);
}

/** Paste → Location evidence (≤ 25 distinct places). */
export function parseLocationPaste(text: string): LocationPasteResult {
  const lines = (typeof text === "string" ? text : "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: { label: string; lines: string[] }[] = [];
  let current: { label: string; lines: string[] } | null = null;
  const loose: string[] = [];
  for (const line of lines) {
    const start = BLOCK_START.exec(line);
    if (start) {
      current = { label: `Location ${Number(start[1])}`, lines: [] };
      blocks.push(current);
      continue;
    }
    if (BLOCK_END.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
    else loose.push(line);
  }
  if (blocks.length === 0 && loose.some((l) => l.trim())) blocks.push({ label: "Location 1", lines: loose });
  if (blocks.length === 0) return { ok: false, error: "Paste at least one Location (Location Name, Street Address, City, State)." };
  if (blocks.length > LOCATION_IMPORT_MAX) return { ok: false, error: `Add up to ${LOCATION_IMPORT_MAX} Locations at a time — this paste has ${blocks.length}.` };

  const byKey = new Map<string, LocationEvidence>();
  for (const block of blocks) {
    const e = parseBlock(block.lines, block.label);
    if (!e) continue;
    const seen = byKey.get(e.key);
    if (seen) {
      // The same place again: one row; it only fills what the first left empty.
      seen.labels.push(block.label);
      for (const f of ["website", "phone", "category", "description"] as const) seen[f] = seen[f] ?? e[f];
      seen.warnings.push(...e.warnings);
    } else {
      byKey.set(e.key, e);
    }
  }
  if (byKey.size === 0) return { ok: false, error: "Each Location needs at least a Location Name or Street Address." };
  return { ok: true, locations: [...byKey.values()], blocks: blocks.length };
}
