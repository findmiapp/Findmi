// Event Import — attendance + location-visibility evidence (pure; no network).
//
// Only what the source actually states is used. Precedence:
//   1. explicit structured data (schema.org offers / isAccessibleForFree /
//      eventAttendanceMode, a platform's own page-state record);
//   2. explicit page controls and wording ("RSVP", "Register",
//      "Get Tickets", "Free", "Tickets: $25", "No registration required");
//   3. platform-specific deterministic semantics — ONLY a verified
//      individual Luma Event page, whose own page is where people register;
//   4. unknown.
// Nothing here is ever produced by the AI step: free/paid, price, RSVP,
// registration and ticket requirements stay unknown unless evidenced.
//
// The source link (external_url) is never assumed to be an attendance link
// in general — only the Luma rule above makes the Event's own Luma page the
// registration destination.
import { cleanText, usStateCode } from "../brand-website-extract";
import { absoluteHttps, sameEventUrl, str, type JsonObject } from "./extract";
import type { EventCandidate, ImportedVenue } from "./types";
import type { LocationVisibility } from "../event-attendance";
export { reviewAttendanceDefaults } from "./attendance-links";

export type AttendanceCta = "rsvp" | "register" | "tickets";
export type AttendancePricing = "free" | "paid" | "unknown";
export type RegistrationRequirement = "required" | "not_required" | "unknown";

export interface ImportedAttendance {
  /** Where people RSVP / register / buy tickets (https), or null. */
  url: string | null;
  /** The action to offer, or null (no evidenced attendance path). */
  cta: AttendanceCta | null;
  pricing: AttendancePricing;
  /** Display text from the source ("$25", "$15–$40"), never computed. */
  price: string | null;
  registration: RegistrationRequirement;
  /** Where the destination/action came from. */
  basis: "structured" | "page" | "platform" | null;
}

export const UNKNOWN_ATTENDANCE: ImportedAttendance = { url: null, cta: null, pricing: "unknown", price: null, registration: "unknown", basis: null };

/** One clickable control on the page (anchor or button). */
export interface PageControl {
  text: string;
  href: string | null;
}

export interface AttendanceEvidence {
  pricing: AttendancePricing;
  pricingBasis: "structured" | "page" | null;
  price: string | null;
  /** An explicit attendance link (offer url, or a control's own link). */
  url: string | null;
  urlBasis: "structured" | "page" | null;
  /** Explicit control wording, when the page uses exactly one kind. */
  wording: AttendanceCta | null;
  registration: RegistrationRequirement;
  /** The organizer withholds the exact address until registration. */
  hiddenLocation: boolean;
  /** schema.org eventAttendanceMode says online. */
  onlineMode: boolean;
}

// ── schema.org ─────────────────────────────────────────────────────────

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^free$/i.test(t)) return 0;
    const m = /^\$?\s*(\d{1,6}(\.\d{1,2})?)$/.exec(t.replace(/,/g, ""));
    if (m) return Number(m[1]);
  }
  return null;
}

function boolOf(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (/^true$/i.test(v.trim())) return true;
    if (/^false$/i.test(v.trim())) return false;
  }
  return null;
}

function formatPrice(min: number, max: number, currency: string | null): string {
  const cur = (currency ?? "USD").toUpperCase();
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const one = (n: number) => (cur === "USD" ? `$${fmt(n)}` : `${fmt(n)} ${cur}`);
  return max > min ? `${one(min)}–${one(max)}` : one(min);
}

/** Evidence from a schema.org Event node: offers, isAccessibleForFree,
 * eventAttendanceMode. */
export function structuredAttendance(node: JsonObject | null, pageUrl: URL): Pick<AttendanceEvidence, "pricing" | "price" | "url" | "onlineMode"> {
  const out = { pricing: "unknown" as AttendancePricing, price: null as string | null, url: null as string | null, onlineMode: false };
  if (!node) return out;
  const prices: number[] = [];
  let currency: string | null = null;
  const offers: JsonObject[] = [];
  for (const o of asList(node.offers).slice(0, 20)) {
    if (!o || typeof o !== "object") continue;
    const offer = o as JsonObject;
    offers.push(offer);
    for (const inner of asList(offer.offers).slice(0, 20)) if (inner && typeof inner === "object") offers.push(inner as JsonObject);
  }
  for (const offer of offers) {
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const n = numberOf(str(offer[key]));
      if (n !== null) prices.push(n);
    }
    const c = str(offer.priceCurrency);
    if (!currency && typeof c === "string" && /^[A-Za-z]{3}$/.test(c.trim())) currency = c.trim().toUpperCase();
    if (!out.url) {
      const u = absoluteHttps(str(offer.url), pageUrl);
      if (u) out.url = u;
    }
  }
  const free = boolOf(str(node.isAccessibleForFree));
  if (free === true) out.pricing = "free";
  else if (free === false) out.pricing = "paid";
  if (prices.length > 0) {
    const max = Math.max(...prices);
    const paid = prices.filter((p) => p > 0);
    // Explicit prices outrank the flag: any positive price is paid; all
    // zero is free.
    if (max > 0) {
      out.pricing = "paid";
      out.price = formatPrice(Math.min(...paid), max, currency);
    } else if (out.pricing === "unknown") out.pricing = "free";
  }
  const mode = str(node.eventAttendanceMode);
  if (typeof mode === "string" && /OnlineEventAttendanceMode$/.test(mode.trim())) out.onlineMode = true;
  return out;
}

// ── platform page state (Luma) ─────────────────────────────────────────

/** Evidence from the platform's own embedded record for THIS Event. Luma
 * ships `geo_address_info.mode` ("shown" / "obfuscated" — the organizer
 * hides the address until registration) and `ticket_info` (is_free, price
 * in cents, require_approval). Every field is read defensively: anything
 * missing or of an unexpected type stays unknown. */
export function pageRecordAttendance(record: JsonObject | null): Pick<AttendanceEvidence, "pricing" | "price" | "registration" | "hiddenLocation"> {
  const out = { pricing: "unknown" as AttendancePricing, price: null as string | null, registration: "unknown" as RegistrationRequirement, hiddenLocation: false };
  if (!record) return out;
  const geo = record.geo_address_info;
  if (geo && typeof geo === "object" && (geo as JsonObject).mode === "obfuscated") out.hiddenLocation = true;
  const t = record.ticket_info;
  if (t && typeof t === "object") {
    const info = t as JsonObject;
    if (info.is_free === true) out.pricing = "free";
    else if (info.is_free === false) out.pricing = "paid";
    const cents = (v: unknown) => (v && typeof v === "object" && typeof (v as JsonObject).cents === "number" ? ((v as JsonObject).cents as number) : null);
    const cur = (v: unknown) => (v && typeof v === "object" && typeof (v as JsonObject).currency === "string" ? ((v as JsonObject).currency as string) : null);
    const min = cents(info.price);
    const max = cents(info.max_price) ?? min;
    if (out.pricing === "paid" && min !== null && min > 0 && max !== null) out.price = formatPrice(min / 100, Math.max(min, max) / 100, cur(info.price));
    if (info.require_approval === true) out.registration = "required";
  }
  return out;
}

// ── page controls + wording ────────────────────────────────────────────

const TICKET_WORDS = /^(get|buy|purchase|book)\s+(your\s+)?tickets?$|^tickets?$|^get\s+a\s+ticket$/i;
const RSVP_WORDS = /^rsvp(\s+(now|here|today))?$/i;
// Whole-label matches only (a control reading exactly "Sign Up", "Reserve
// a Spot", "Book Now", "Attend" …) — never a word inside longer copy.
const REGISTER_WORDS = /^(register(\s+(now|here|today))?|request\s+to\s+join|reserve(\s+now|\s+(a|your)\s+(spot|seat|place))?|sign\s*-?\s*up(\s+(now|here|today))?|book(\s+now|\s+(a|your)\s+(spot|seat|place))?|attend(\s+this\s+event)?)$/i;

export function controlWording(text: string): AttendanceCta | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return null;
  if (TICKET_WORDS.test(t)) return "tickets";
  if (RSVP_WORDS.test(t)) return "rsvp";
  if (REGISTER_WORDS.test(t)) return "register";
  return null;
}

const HIDDEN_LOCATION = [
  /\bregister to see (the )?(address|location)\b/i,
  /\b(address|location|venue)\s+(is\s+|will\s+be\s+)?(shared|revealed|provided|sent|shown|visible|available|released)\s+(only\s+)?(to\s+(registered|approved|confirmed)\s+(guests|attendees)|after\s+(you\s+)?(register|registration|rsvp|approval|signing up|sign-up))\b/i,
  /\b(address|location)\s+(shown|available)\s+(to|for)\s+(registered|approved|confirmed)\s+(guests|attendees)\b/i,
];
const WALK_IN = [/\bno\s+(registration|rsvp|tickets?)\s+(is\s+|are\s+)?(required|needed|necessary)\b/i, /\bwalk-?ins?\s+(are\s+)?welcome\b/i];
const FREE_LINE = /^(free|free event|free admission|free entry|free to attend|(admission|entry|price|cost|tickets?)\s*[:\-–]?\s*free)\.?$/i;
const PRICE_LINE = /^(tickets?|admission|price|cost|entry)\s*[:\-–]?\s*\$\s?(\d{1,5}(\.\d{2})?)(\s*[-–]\s*\$\s?(\d{1,5}(\.\d{2})?))?\b/i;

export function pageAttendance(controls: PageControl[], lines: string[], pageUrl: URL): Pick<AttendanceEvidence, "pricing" | "price" | "url" | "wording" | "registration" | "hiddenLocation"> {
  const out = {
    pricing: "unknown" as AttendancePricing,
    price: null as string | null,
    url: null as string | null,
    wording: null as AttendanceCta | null,
    registration: "unknown" as RegistrationRequirement,
    hiddenLocation: false,
  };
  const kinds = new Set<AttendanceCta>();
  for (const c of controls.slice(0, 400)) {
    const kind = controlWording(c.text);
    if (!kind) continue;
    kinds.add(kind);
    // A control's own link to a separate page is an explicit destination
    // (never an in-page anchor, mailto or this same page).
    if (!out.url && c.href && !/^(#|mailto:|tel:|javascript:)/i.test(c.href.trim())) {
      const abs = absoluteHttps(c.href, pageUrl);
      if (abs && !sameEventUrl(abs, pageUrl)) out.url = abs;
    }
  }
  // Only unambiguous wording (one kind of control) is used.
  if (kinds.size === 1) out.wording = [...kinds][0];
  for (const raw of lines.slice(0, 800)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length > 300) continue;
    if (!out.hiddenLocation && HIDDEN_LOCATION.some((re) => re.test(line))) out.hiddenLocation = true;
    if (out.registration === "unknown" && WALK_IN.some((re) => re.test(line))) out.registration = "not_required";
    if (out.pricing === "unknown") {
      if (FREE_LINE.test(line)) out.pricing = "free";
      else {
        const m = PRICE_LINE.exec(line);
        if (m) {
          const min = Number(m[2]);
          const max = m[5] ? Number(m[5]) : min;
          if (max > 0) {
            out.pricing = "paid";
            out.price = formatPrice(min > 0 ? min : max, Math.max(min, max), "USD");
          }
        }
      }
    }
  }
  return out;
}

/** Merges evidence by precedence: structured → platform record → page. */
export function combineEvidence(
  structured: ReturnType<typeof structuredAttendance>,
  record: ReturnType<typeof pageRecordAttendance>,
  page: ReturnType<typeof pageAttendance>
): AttendanceEvidence {
  const pricingFrom = structured.pricing !== "unknown" ? structured : record.pricing !== "unknown" ? record : page;
  return {
    pricing: pricingFrom.pricing,
    pricingBasis: structured.pricing !== "unknown" || record.pricing !== "unknown" ? "structured" : page.pricing !== "unknown" ? "page" : null,
    price: pricingFrom.price,
    url: structured.url ?? page.url,
    urlBasis: structured.url ? "structured" : page.url ? "page" : null,
    wording: page.wording,
    registration: record.registration !== "unknown" ? record.registration : page.registration,
    hiddenLocation: record.hiddenLocation || page.hiddenLocation,
    onlineMode: structured.onlineMode,
  };
}

// ── Luma individual Event pages ────────────────────────────────────────

const LUMA_HOST = /(^|\.)(lu\.ma|luma\.com)$/i;
const LUMA_RESERVED = new Set([
  "calendar", "user", "discover", "home", "signin", "login", "signup", "create", "explore", "pricing", "settings", "event", "events",
  "u", "about", "privacy", "terms", "help", "embed", "check-in", "join", "map", "search", "nyc", "sf", "london",
]);

/** A single Luma Event's own page: a lu.ma / luma.com URL whose path is one
 * Event slug (never a calendar, user, discovery or city page). The caller
 * must also have confirmed the page IS one Event (the classifier's single
 * result and structured Event data / the page's own Event record). */
export function isLumaEventUrl(url: string | URL | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !LUMA_HOST.test(u.hostname)) return false;
    const m = /^\/([A-Za-z0-9][A-Za-z0-9_-]{2,120})\/?$/.exec(u.pathname);
    return Boolean(m && !LUMA_RESERVED.has(m[1].toLowerCase()));
  } catch {
    return false;
  }
}

/** A registration platform's own single-Event page — the page IS where
 * people register or buy (Luma, Eventbrite /e/…, Partiful /e/…). Only then
 * may an Event Link serve as the attendance destination (approved
 * registration precedence, rule 4); an informational page (a venue, a
 * brand, a festival site, a platform listing / discovery page) never does. */
export function isRegistrationPlatformEventUrl(url: string | URL | null | undefined): boolean {
  if (!url) return false;
  if (isLumaEventUrl(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (/(^|\.)eventbrite\.[a-z.]+$/i.test(u.hostname)) return /^\/e\/[A-Za-z0-9][A-Za-z0-9_-]{2,200}\/?$/.test(u.pathname);
    if (/(^|\.)partiful\.com$/i.test(u.hostname)) return /^\/e\/[A-Za-z0-9_-]{4,64}\/?$/.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}

// ── decision ───────────────────────────────────────────────────────────

/** The attendance action, from evidence only:
 *   explicit walk-in (and not paid)                 → no registration CTA;
 *   no attendance destination at all                → no CTA (facts kept);
 *   explicit control wording                        → that wording;
 *   paid / ticketed                                 → Get Tickets;
 *   free or unknown, with an attendance destination → Register.
 * RSVP is only ever used when the source itself says RSVP. */
export function decideAttendance(e: AttendanceEvidence, opts: { lumaEventUrl: string | null }): ImportedAttendance {
  const base = { pricing: e.pricing, price: e.price, registration: e.registration };
  if (e.registration === "not_required" && e.pricing !== "paid") return { ...base, url: null, cta: null, basis: null };
  let url = e.url;
  let basis: ImportedAttendance["basis"] = e.urlBasis;
  if (!url && opts.lumaEventUrl) {
    url = opts.lumaEventUrl;
    basis = "platform";
  }
  if (!url) return { ...base, url: null, cta: null, basis: null };
  const cta: AttendanceCta = e.wording ?? (e.pricing === "paid" ? "tickets" : "register");
  return { ...base, url, cta, basis, registration: e.registration === "unknown" && basis === "platform" ? "required" : e.registration };
}

// ── location visibility ────────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, " ").trim();

/** A "venue" that is only broad geography ("New York, NY", "Brooklyn"). */
export function geographyOnly(v: ImportedVenue): { city: string | null; state: string | null } | null {
  if (!v.name || v.address) return null;
  const name = norm(v.name);
  if (v.city && (name === norm(v.city) || name === norm(`${v.city} ${v.state ?? ""}`))) return { city: v.city, state: v.state };
  const m = /^([A-Za-z .'-]{2,60}),\s*([A-Za-z .]{2,30})$/.exec(v.name.trim());
  if (m) {
    const state = usStateCode(m[2]);
    if (state) return { city: cleanText(m[1], 80), state };
  }
  return null;
}

export function decideLocationVisibility(candidate: Pick<EventCandidate, "occurrences" | "online">, hidden: boolean): LocationVisibility {
  if (hidden) return "hidden";
  const venues = candidate.occurrences.map((o) => o.venue);
  if (venues.some((v) => v.address || (v.name && !geographyOnly(v)))) return "exact";
  if (venues.some((v) => v.city || v.state || geographyOnly(v))) return "broad";
  return "none";
}

/** Applies the source's location decision to every occurrence:
 *   hidden — venue name, street address and postal code are dropped (only
 *            the public city/state remain), so no precise place can be
 *            stored, shown or matched to a Findmi Location;
 *   broad  — a geography-only "venue" becomes plain city/state;
 *   exact / none — unchanged. */
export function applyLocationVisibility<T extends Pick<EventCandidate, "occurrences" | "online">>(candidate: T, visibility: LocationVisibility): T {
  if (visibility !== "hidden" && visibility !== "broad") return candidate;
  return {
    ...candidate,
    occurrences: candidate.occurrences.map((o) => {
      const geo = geographyOnly(o.venue);
      if (visibility === "hidden") {
        return { ...o, venue: { name: null, address: null, postalCode: null, city: o.venue.city ?? geo?.city ?? null, state: o.venue.state ?? geo?.state ?? null } };
      }
      return geo ? { ...o, venue: { name: null, address: null, postalCode: o.venue.postalCode, city: o.venue.city ?? geo.city, state: o.venue.state ?? geo.state } } : o;
    }),
  };
}

// ── persistence mapping ────────────────────────────────────────────────

export interface ReviewedAttendance {
  cta: AttendanceCta;
  url: string;
}

/** A reviewed attendance action, validated: a known action and an https
 * link (never a relative path, mailto or javascript:). */
export function normalizeReviewedAttendance(value: unknown): ReviewedAttendance | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { cta?: unknown; url?: unknown };
  const cta = v.cta === "tickets" || v.cta === "rsvp" || v.cta === "register" ? v.cta : null;
  if (!cta || typeof v.url !== "string") return null;
  const raw = v.url.trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return { cta, url: u.toString() };
  } catch {
    return null;
  }
}

/** A reviewed Ticket link (https only), or null. */
export function normalizeReviewedUrl(value: unknown): string | null {
  return normalizeReviewedAttendance({ cta: "tickets", url: value })?.url ?? null;
}

/** Existing Event action columns for a reviewed attendance action. Only a
 * present action turns anything on — nothing is ever switched off here. */
export function attendanceEventColumns(a: ReviewedAttendance | null, ticketsUrl: string | null = null): { tickets_enabled?: boolean; tickets_url?: string; rsvp_enabled?: boolean; rsvp_url?: string } {
  const tickets = ticketsUrl && a?.cta !== "tickets" ? { tickets_enabled: true, tickets_url: ticketsUrl } : {};
  if (!a) return tickets;
  return a.cta === "tickets" ? { tickets_enabled: true, tickets_url: a.url } : { rsvp_enabled: true, rsvp_url: a.url, ...tickets };
}

/** The two newer Event columns (rsvp_cta, location_visibility). Written in
 * a separate best-effort update by callers, so Event creation keeps working
 * on a database where that migration hasn't been applied yet. */
export function attendanceExtraColumns(a: ReviewedAttendance | null, visibility: LocationVisibility | null): { rsvp_cta?: "rsvp" | "register"; location_visibility?: LocationVisibility } {
  return {
    ...(a && a.cta !== "tickets" ? { rsvp_cta: a.cta } : {}),
    ...(visibility ? { location_visibility: visibility } : {}),
  };
}
