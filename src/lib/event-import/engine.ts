import "server-only";
// Event Import V1 — the ONE analyze engine. Context-free: it never writes
// anything. Business entry points (and later Admin / onboarding) call it
// with their own context, then persist through ./persist.ts after the
// human Review step.
//
//   validate URL → rate limit → guarded fetch (safe-fetch) → deterministic
//   extraction → optional AI fill-in → normalize → conservative matching.
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetchEventPage, validateFetchUrl, type SafeFetchResult } from "../safe-fetch";
import { findEventMatches, findDuplicateMatches, type EventMatchCandidate, type DuplicateCandidate } from "../admin/appearance-matching";
import type { AppearanceDraft } from "../admin/appearance-import";
import { findLikelyDuplicateLocations, findPossibleLocations } from "../locationCreation";
import { findBusinessMatches } from "../business-matching";
import { extractEventCandidate, needsAiAssist, isPastDate, siteIdentityImages, type ExtractionResult } from "./extract";
import { genericImageEvidence, GENERIC_IMAGE_WARNING } from "./image-guard";
import { classifySource, pageEventRecord } from "./sources";
import {
  applyLocationVisibility,
  combineEvidence,
  decideAttendance,
  decideLocationVisibility,
  isLumaEventUrl,
  pageAttendance,
  pageRecordAttendance,
  structuredAttendance,
} from "./attendance";
import { fetchFailureLogLine, safeFetchDiagnostics } from "./diagnostics";
import {
  assistWithAi,
  EVENT_AI_TIMEOUT_MS,
  defaultEventAiClient,
  readEventImageWithAi,
  readEventTextWithAi,
  sanitizeEventAiOutput,
  type EventAiClient,
  type EventImportImageMediaType,
} from "./ai";
import { extractStructuredEvent } from "./structured-paste";
import { splitPastedEvents, type PastedEventSegment } from "./paste-segments";
import { extractTextEventCandidate, mergeTextAi, needsTextAssist, PASTE_MAX_CHARS, PASTE_MIN_CHARS, type TextExtraction } from "./text-source";
import { mergeSourceIntoStructured } from "./structured-merge";
import {
  EVENT_IMPORT_FAILURE_COPY,
  venueKey,
  type EventCandidate,
  type EventImportAnalysis,
  type EventImportFailure,
  type EventImportMatches,
  type ImportedDate,
  type ImportedOccurrence,
  type ImportedVenue,
  type SourceEventAnalysis,
} from "./types";

/** Distinct places looked up per analysis (each once). */
const MAX_PLACE_LOOKUPS = 15;

type LocationRow = { id: string; name: string; address: string | null; city: string | null; state: string | null; postal_code?: string | null };

export interface EventImportDeps {
  fetchPage: (url: URL) => Promise<SafeFetchResult>;
  ai: EventAiClient | null;
  matchEvent: (draft: AppearanceDraft) => Promise<EventMatchCandidate | null>;
  getEvent: (id: string) => Promise<{ slug: string; host_business_id: string | null } | null>;
  matchLocations: (venue: { name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null }) => Promise<LocationRow[]>;
  /** The matcher's "possible" tier (name containment) — only offered for confirmation. */
  matchPossibleLocations?: (venue: { name: string; state: string | null }) => Promise<LocationRow[]>;
  matchOrganizer: (name: string, city: string | null, state: string | null) => Promise<{ id: string; name: string } | null>;
  matchExistingAppearance: (businessId: string, draft: AppearanceDraft) => Promise<DuplicateCandidate | null>;
  /** V1C retry safety: this Business's schedule item already imported from this Event link. */
  findScheduledBySourceUrl: (businessId: string, url: string) => Promise<{ title: string; startAt: string } | null>;
  /** V1C: a Findmi Event already carrying this Event link. */
  findEventBySourceUrl: (url: string) => Promise<{ id: string; name: string; startAt: string; venueName: string | null; city: string | null } | null>;
  isRateLimited: (key: string) => boolean;
  now: () => number;
  /** Server-side diagnostic for a failed source fetch (one concise line). */
  logFetchFailure?: (line: string) => void;
  /** Event image guard: logo / cover candidates Brand Import already read
   * from this site (read-only). Admin-only (Brand Import tables are Admin
   * data — lib/admin/brand-import.ts); absent → that evidence isn't used. */
  siteBrandImages?: (host: string) => Promise<string[]>;
}

// ── rate limit: 20 analyses per user per 10 minutes (in-memory, per instance) ──
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
export function recordEventImportAnalysis(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
export function resetEventImportRateLimit(): void {
  hits.clear();
}

export function defaultEventImportDeps(admin: SupabaseClient): EventImportDeps {
  return {
    fetchPage: (url) => safeFetchEventPage(url),
    ai: defaultEventAiClient(),
    matchEvent: async (draft) => (await findEventMatches([draft]))[0] ?? null,
    getEvent: async (id) => {
      const { data } = await admin.from("events").select("slug, host_business_id").eq("id", id).maybeSingle();
      return (data as { slug: string; host_business_id: string | null } | null) ?? null;
    },
    matchLocations: (venue) => findLikelyDuplicateLocations(admin, venue),
    matchPossibleLocations: (venue) => findPossibleLocations(admin, venue),
    matchOrganizer: async (name, city, state) => {
      const matches = await findBusinessMatches(admin, { name, city, state });
      const m = matches.find((x) => x.isPublic && x.reasons.includes("name_location"));
      return m ? { id: m.id, name: m.name } : null;
    },
    matchExistingAppearance: async (businessId, draft) => (await findDuplicateMatches(businessId, [draft]))[0] ?? null,
    findScheduledBySourceUrl: async (businessId, url) => {
      const { data } = await admin
        .from("appearances")
        .select("title, start_at")
        .eq("business_id", businessId)
        .eq("external_url", url)
        .neq("status", "canceled")
        .order("start_at", { ascending: true })
        .limit(1);
      const row = ((data ?? []) as { title: string; start_at: string }[])[0];
      return row ? { title: row.title, startAt: row.start_at } : null;
    },
    findEventBySourceUrl: async (url) => {
      const { data } = await admin
        .from("events")
        .select("id, name, start_at, venue_name, city")
        .eq("external_url", url)
        .is("trashed_at", null)
        .is("archived_at", null)
        // A just-imported Event awaiting review is still the same Event —
        // matching it prevents a second copy; a rejected one is not reused.
        .neq("publication_status", "rejected")
        .limit(1);
      const row = ((data ?? []) as { id: string; name: string; start_at: string; venue_name: string | null; city: string | null }[])[0];
      return row ? { id: row.id, name: row.name, startAt: row.start_at, venueName: row.venue_name, city: row.city } : null;
    },
    isRateLimited: (key) => recordEventImportAnalysis(key),
    now: () => Date.now(),
    logFetchFailure: (line) => console.warn(line),
  };
}

const FETCH_FAILURE: Record<string, EventImportFailure> = {
  invalid_url: "invalid_url",
  blocked_destination: "blocked_url",
  redirect_rejected: "blocked_url",
  dns_failed: "unreachable",
  timeout: "unreachable",
  too_many_redirects: "unreachable",
  redirect_loop: "unreachable",
  http_error: "unreachable",
  network_error: "unreachable",
  too_large: "unreachable",
  blocked_by_site: "blocked_by_site",
  unsupported_content: "not_html",
};

/** "example.com/e/123" → "https://example.com/e/123"; anything that is not
 * a plain public web address is rejected before any network use. */
export function normalizeImportUrl(input: string): { ok: true; url: URL } | { ok: false; code: EventImportFailure } {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return { ok: false, code: "invalid_url" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, code: "blocked_url" };
  if (parsed.username || parsed.password) return { ok: false, code: "blocked_url" };
  // The shared validator decides destination safety (public hostname rules,
  // no IP literals / internal names) and upgrades to https.
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  const v = validateFetchUrl(parsed, { allowSharedPlatforms: true });
  if (!v.ok) return { ok: false, code: v.code === "invalid_url" ? "invalid_url" : "blocked_url" };
  return { ok: true, url: v.url };
}

/** Rich Event Persistence — does the source ground a genuine Event (not
 * just a Business's whereabouts)? Conservative: a title and at least one
 * dated occurrence, plus Event evidence — structured Event data
 * (schema.org / page data / event meta), or a dedicated Event page of its
 * own with real details (its own link and a description). A schedule read
 * only by the AI step, or a bare line of text, stays a schedule item.
 * Nothing is invented either way: missing details stay "Needs Details". */
export function classifyPersistence(candidate: EventCandidate, opts: { ownPage: boolean }): "event" | "schedule_item" {
  if (!candidate.title || candidate.occurrences.length === 0) return "schedule_item";
  const structured = candidate.sources.title === "structured" || candidate.sources.dates === "structured";
  if (structured) return "event";
  if (candidate.sources.dates === "ai") return "schedule_item";
  return opts.ownPage && Boolean(candidate.sourceUrl) && Boolean(candidate.description) ? "event" : "schedule_item";
}

/** Rich Event Persistence for Paste Details / Upload — the same question
 * as classifyPersistence, decided from the evidence alone (a source link is
 * provenance, not a prerequisite): a name, at least one date, and something
 * that makes it a real scheduled Event — where it happens (a place, a city,
 * an organizer-withheld address, or online) or what it is (a description).
 * A bare name + date stays the Business's own schedule item. */
export function classifyEvidencePersistence(candidate: EventCandidate): "event" | "schedule_item" {
  if (!candidate.title || candidate.occurrences.length === 0) return "schedule_item";
  const placed = candidate.occurrences.some((o) => venueKey(o.venue) || o.venue.city) || candidate.online || candidate.locationVisibility === "hidden";
  return placed || Boolean(candidate.description) ? "event" : "schedule_item";
}

/** NY calendar date for an imported date (date-only values pass through). */
export function nyDateOf(d: ImportedDate): string {
  return d.hasTime ? new Date(d.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : d.start;
}

function draftFor(candidate: EventCandidate, d: ImportedOccurrence): AppearanceDraft {
  return {
    title: candidate.title ?? "",
    date: nyDateOf(d),
    // NY wall-clock start, so the Event matcher can tell same-day Events
    // hours apart from one another.
    start_time: d.hasTime ? new Date(d.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) : null,
    end_time: null,
    time_tbd: !d.hasTime,
    venue_name: d.venue.name,
    address: d.venue.address,
    city: d.venue.city,
    state: d.venue.state,
  } as unknown as AppearanceDraft;
}

export async function analyzeEventUrl(
  input: { url: string; businessId: string | null; rateKey: string },
  deps: EventImportDeps
): Promise<EventImportAnalysis> {
  const normalized = normalizeImportUrl(input.url);
  if (!normalized.ok) return normalized;
  if (deps.isRateLimited(input.rateKey)) return { ok: false, code: "rate_limited" };

  let page: SafeFetchResult;
  try {
    page = await deps.fetchPage(normalized.url);
  } catch {
    return { ok: false, code: "unreachable" };
  }
  if (!page.ok) {
    const code = FETCH_FAILURE[page.code] ?? "unreachable";
    // Only a failure where the site actually answered carries diagnostics.
    if (page.status === undefined && page.host === undefined) return { ok: false, code };
    const fetch = safeFetchDiagnostics(page);
    deps.logFetchFailure?.(fetchFailureLogLine(normalized.url.hostname, code, fetch));
    return { ok: false, code, fetch };
  }

  const now = deps.now();

  // V1C — one Event, or a source listing many distinct Events?
  const source = classifySource(page.html, page.url, now);
  if (source.kind === "multi_unreadable") return { ok: false, code: "calendar_unreadable" };
  if (source.kind === "multi") {
    const events: SourceEventAnalysis[] = [];
    const list = source.events;
    // Each Event is normalized and matched on its own (small batches keep
    // the lookups bounded).
    for (let i = 0; i < list.length; i += 4) {
      const batch = await Promise.all(list.slice(i, i + 4).map((e) => analyzeSourceEvent(e.identity, e.candidate, input.businessId, now, deps)));
      events.push(...batch);
    }
    const upcoming = events.filter((e) => !e.past).length;
    const warnings: string[] = [];
    if (events.length > 0 && upcoming === 0) warnings.push("All the Events on that page have already happened.");
    return { ok: true, kind: "multi", source: { url: page.url.toString(), name: source.sourceName, platform: list[0]?.candidate.platform ?? null }, events, warnings };
  }

  const extracted = extractEventCandidate(page.html, page.url, now);
  let candidate = extracted.candidate;
  // Event image quality: a page-level fallback image proven to be the
  // site's / Business's own identity imagery is dropped (no image at all
  // rather than a Brand logo as Event art). The Event's structured image
  // is never checked or dropped.
  const imageGuard = await guardFallbackImage(extracted, page, deps);
  if (imageGuard) {
    const sources = { ...candidate.sources };
    delete sources.image;
    candidate = { ...candidate, imageUrl: null, sources, imageGuard };
  }
  // Attendance + location-privacy evidence — read BEFORE the AI step and
  // only from the page's own structured data, platform record and controls.
  const record = pageEventRecord(extracted.evidence.jsonState, page.url);
  const evidence = combineEvidence(
    structuredAttendance(extracted.evidence.primary, page.url),
    pageRecordAttendance(record),
    pageAttendance(extracted.evidence.controls, extracted.evidence.lines, page.url)
  );
  if (needsAiAssist(candidate)) candidate = (await assistWithAi(candidate, extracted.excerpt, deps.ai, { now, yearHint: extracted.yearHint })).candidate;
  if (evidence.onlineMode && !candidate.occurrences.some((o) => venueKey(o.venue))) candidate = { ...candidate, online: true };
  // The source's privacy decision wins over anything read or filled in: a
  // hidden address leaves no venue/street to show or to match a Location.
  const locationVisibility = decideLocationVisibility(candidate, evidence.hiddenLocation);
  candidate = applyLocationVisibility(candidate, locationVisibility);
  // Platform rule: a VERIFIED individual Luma Event page (a single-Event
  // classification, Event data for this page, an Event-slug URL) is where
  // people register — its own link may be the attendance destination.
  const lumaEventUrl = isLumaEventUrl(candidate.sourceUrl) && (candidate.sources.title === "structured" || record !== null) ? candidate.sourceUrl : null;
  candidate = { ...candidate, locationVisibility, attendance: decideAttendance(evidence, { lumaEventUrl }) };

  const hasPlace = candidate.occurrences.some((o) => venueKey(o.venue) || o.venue.city);
  // Not an event page at all: nothing that identifies an event.
  if (!candidate.title || (candidate.occurrences.length === 0 && candidate.sources.title === "page" && !hasPlace)) {
    return { ok: false, code: "no_event" };
  }

  // Past/future is decided on the FINAL occurrence set (after recurrence
  // expansion and AI fill-in). Past dates are kept and flagged — Review
  // shows them, not included by default — never silently discarded.
  candidate = { ...candidate, occurrences: candidate.occurrences.map((o) => ({ ...o, past: isPastDate(o, now) })) };
  const total = candidate.occurrences.length;
  const pastCount = candidate.occurrences.filter((o) => o.past).length;

  const warnings: string[] = [];
  if (total > 0 && pastCount === total) warnings.push("All the dates on that page have already passed.");
  else if (pastCount > 0) warnings.push("Some dates on this page have already passed. Future dates are shown below.");
  if (total === 0) warnings.push("We couldn't find a date. Add it below.");
  if (extracted.unresolvedRanges > 0 && candidate.sources.dates !== "structured") {
    warnings.push("Part of the schedule on that page couldn't be turned into dates. Please compare with the page and add any missing dates.");
  }
  if (extracted.truncated) warnings.push(`That page lists a lot of dates. The first ${total} are shown.`);
  if (candidate.occurrences.some((d) => !d.hasTime)) warnings.push("Some dates don't have a start time. Add it below.");
  if (extracted.assumedZone || candidate.sources.dates === "ai") warnings.push("The page didn't say which time zone it uses. Times are shown in Eastern Time. Please check them.");
  if (!hasPlace && !candidate.online && locationVisibility !== "hidden") warnings.push("We couldn't find where it's happening. Add the place below.");
  if (candidate.online) warnings.push("This looks like an online event.");
  if (locationVisibility === "hidden") warnings.push("The organizer shares the exact location only after registration. Findmi won't show or link an address.");
  if (Object.values(candidate.sources).includes("ai")) warnings.push("Some details were read from the page text. Please check them.");
  if (candidate.imageGuard) warnings.push(GENERIC_IMAGE_WARNING);

  const matches = await matchCandidate(candidate, input.businessId, deps);
  candidate = { ...candidate, persistAs: classifyPersistence(candidate, { ownPage: true }) };

  return { ok: true, kind: "single", candidate, matches, warnings };
}

// ── Event image quality guard ──────────────────────────────────────────

/** The site homepage's identity images, per host (one safe fetch, then
 * reused for 10 minutes — a 25-Event paste from one site fetches it once). */
const HOMEPAGE_TTL_MS = 10 * 60 * 1000;
const HOMEPAGE_CACHE_MAX = 200;
const homepageImageCache = new Map<string, { at: number; images: string[] | null }>();
export function resetEventImageGuardCache(): void {
  homepageImageCache.clear();
}

async function homepageIdentityImages(page: { url: URL; html: string }, deps: EventImportDeps): Promise<string[] | null> {
  const home = new URL("/", page.url);
  // The Event page IS the homepage: no independent evidence.
  if (home.href === page.url.href) return null;
  const now = deps.now();
  const hit = homepageImageCache.get(home.host);
  if (hit && now - hit.at < HOMEPAGE_TTL_MS) return hit.images;
  let images: string[] | null = null;
  try {
    const res = await deps.fetchPage(home);
    // The same document served for "/" proves nothing about genericness.
    images = res.ok && res.html !== page.html ? siteIdentityImages(res.html, res.url) : null;
  } catch {
    images = null;
  }
  if (homepageImageCache.size >= HOMEPAGE_CACHE_MAX) homepageImageCache.clear();
  homepageImageCache.set(home.host, { at: now, images });
  return images;
}

/** A page-level social image (og:image:secure_url / og:image /
 * twitter:image) that is provably the site's own identity imagery →
 * why; otherwise null (kept). Cheapest evidence first; the homepage is
 * fetched only when nothing cheaper decides. */
async function guardFallbackImage(extracted: ExtractionResult, page: { url: URL; html: string }, deps: EventImportDeps): Promise<EventCandidate["imageGuard"] | null> {
  const url = extracted.candidate.imageUrl;
  const provenance = extracted.imageProvenance;
  if (!url || !provenance || provenance === "jsonld_event") return null;
  const found = (evidence: ReturnType<typeof genericImageEvidence>) => (evidence ? ({ ignored: "generic_site_image", provenance, evidence } as const) : null);
  const onPage = found(genericImageEvidence(url, { pageLogos: extracted.siteLogos }));
  if (onPage) return onPage;
  if (deps.siteBrandImages) {
    const brandImages = await deps.siteBrandImages(page.url.host).catch(() => [] as string[]);
    const fromBrand = found(genericImageEvidence(url, { brandImages }));
    if (fromBrand) return fromBrand;
  }
  const homepageImages = await homepageIdentityImages(page, deps);
  return homepageImages ? found(genericImageEvidence(url, { homepageImages })) : null;
}

// ── Paste Details / Upload ─────────────────────────────────────────────
// The same engine for evidence that isn't a link: pasted text, or an
// uploaded image (its visible text, read by the multimodal AI step). Both
// become the SAME EventCandidate (./text-source.ts), then share everything
// below with From Link: attendance + location-privacy evidence (from the
// text itself, never the AI), matching, Review, persistence. No source link
// or image is ever invented: the candidate has no sourceUrl, and an uploaded
// image is evidence only — never the Event's cover.

/** Never a real destination: only absolute https links in the text are
 * read, and nothing is ever resolved against this. */
const TEXT_BASE = new URL("https://evidence.findmi.invalid/");

export async function analyzeEventText(
  input: {
    text: string;
    businessId: string | null;
    rateKey: string;
    /** Admin Event Import only: read blocks written in the structured field
     * syntax ("Event Name: …") deterministically (./structured-paste.ts). */
    structured?: boolean;
  },
  deps: EventImportDeps
): Promise<EventImportAnalysis> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > PASTE_MAX_CHARS) return { ok: false, code: "text_too_long" };
  if (text.length < PASTE_MIN_CHARS) return { ok: false, code: "text_no_event" };
  // One paste = one request against the per-person limit, however many
  // Events it marks.
  if (deps.isRateLimited(input.rateKey)) return { ok: false, code: "rate_limited" };
  const now = deps.now();

  // Several explicitly marked Events (EVENT n … === END EVENT n ===)?
  const split = splitPastedEvents(text, PASTE_MIN_CHARS);
  if (split.kind === "error") return { ok: false, code: split.code, detail: split.detail };
  const structured = input.structured === true;
  if (split.kind === "none") return analyzeOneTextEvent(text, input.businessId, now, deps, true, structured);
  // A single marked Event is just one Event (its own details).
  if (split.segments.length === 1) return analyzeOneTextEvent(split.segments[0].text, input.businessId, now, deps, true, structured);
  return analyzePastedEvents(split.segments, input.businessId, now, deps, structured);
}

/** ONE Event's pasted details → a single candidate (the original Paste
 * Details path, unchanged): deterministic reading, AI assist only when the
 * reading is incomplete (and `allowAi`), the multiple-Events refusal,
 * attendance/privacy evidence, matching. */
async function analyzeOneTextEvent(text: string, businessId: string | null, now: number, deps: EventImportDeps, allowAi = true, structured = false): Promise<EventImportAnalysis> {
  // Admin structured fields: explicit values, read deterministically — no
  // AI rediscovery, no free-text guessing.
  const fields = structured ? extractStructuredEvent(text, { now }) : null;
  if (fields) return finishEvidenceCandidate(fields, fields.candidate, "text_no_event", businessId, now, deps);
  const extraction = extractTextEventCandidate(text, { now, origin: "text" });
  if (extraction.multipleEvents) return { ok: false, code: "multiple_events" };
  const hidden = pageAttendance(extraction.controls, extraction.lines, TEXT_BASE).hiddenLocation;
  const ai = allowAi && needsTextAssist(extraction.candidate, hidden) ? await readEventTextWithAi(text, deps.ai) : null;
  if (ai?.multiple_events) return { ok: false, code: "multiple_events" };
  const sanitized = ai ? sanitizeEventAiOutput(ai, text, { now, yearHint: extraction.yearHint }) : null;
  return finishEvidenceCandidate(extraction, sanitized ? mergeTextAi(extraction.candidate, sanitized) : extraction.candidate, "text_no_event", businessId, now, deps);
}

/** Pasted Events read concurrently, a few at a time. */
const PASTE_CONCURRENCY = 5;
/** AI assist only STARTS while there is still room for one full AI call
 * inside this window (the import page allows 60s in total); a segment
 * reached later keeps its deterministic reading — still a Review row,
 * marked as needing details where something is missing. */
const PASTE_AI_WINDOW_MS = 40_000;

/** Several explicitly marked Events → the existing several-Events Review
 * (`kind: "multi"`). Each Event is read exactly like a one-Event paste and
 * matched on its own (its own Event / Location / organizer matches). An
 * Event that can't be read is never dropped silently: the others still go
 * to Review and a warning names it; if none can be read, the whole paste
 * fails. */
async function analyzePastedEvents(segments: PastedEventSegment[], businessId: string | null, now: number, deps: EventImportDeps, structured = false): Promise<EventImportAnalysis> {
  const started = Date.now();
  const results: { number: number; analysis: EventImportAnalysis }[] = [];
  for (let i = 0; i < segments.length; i += PASTE_CONCURRENCY) {
    const allowAi = Date.now() - started + EVENT_AI_TIMEOUT_MS <= PASTE_AI_WINDOW_MS;
    const batch = await Promise.all(
      segments.slice(i, i + PASTE_CONCURRENCY).map(async (seg) => ({ number: seg.number, analysis: await analyzeOneTextEvent(seg.text, businessId, now, deps, allowAi, structured) }))
    );
    results.push(...batch);
  }

  const events: SourceEventAnalysis[] = [];
  const unread: string[] = [];
  const notes: string[] = [];
  for (const { number, analysis } of results) {
    if (analysis.ok && analysis.kind === "single") {
      const candidate = analysis.candidate;
      for (const note of candidate.structured?.notes ?? []) notes.push(`EVENT ${number}: ${note}`);
      const past = candidate.occurrences.length > 0 && candidate.occurrences.every((o) => o.past);
      events.push({ key: `pasted-event-${number}`, candidate, matches: analysis.matches, warnings: analysis.warnings, past, alreadyOnSchedule: null });
    } else {
      const reason = !analysis.ok && analysis.code === "multiple_events" ? "it looks like more than one Event" : "its name, date or place couldn't be found";
      unread.push(`EVENT ${number} couldn't be read (${reason}). Fix it and paste it again.`);
    }
  }
  if (events.length === 0) return { ok: false, code: "paste_no_events", detail: unread.join(" ") };

  const warnings = [...unread, ...notes];
  if (events.every((e) => e.past)) warnings.push("All the pasted Events have already happened.");
  return { ok: true, kind: "multi", source: { url: "", name: "Pasted Details", platform: null }, events, warnings };
}

/** Admin Event Import — ONE pasted Event (structured block) enriched from
 * its own Event Link through the existing Event URL importer
 * (analyzeEventUrl: safe fetch, SSRF protection, extraction, bounded AI
 * assist). Explicit structured values win; the page only fills what the
 * block left empty (./structured-merge.ts). A source that can't be read
 * never loses the Event: it keeps its explicit reading with the reason.
 * An Event already on Findmi with the same link is offered as the match.
 * One call = one Event, so a 25-Event paste is 25 bounded requests (the
 * caller runs them a few at a time) — never one long request. */
export async function analyzeAdminSourceEvent(input: { text: string; rateKey: string }, deps: EventImportDeps): Promise<EventImportAnalysis> {
  const now = deps.now();
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const fields = extractStructuredEvent(text, { now });
  if (!fields) return { ok: false, code: "text_no_event" };
  let candidate: EventCandidate = fields.candidate;
  const link = candidate.sourceUrl;
  let source: NonNullable<NonNullable<EventCandidate["structured"]>["source"]> = { status: "not_read", filled: [] };
  let sourceAttendance: EventCandidate["attendance"] | undefined;
  const differences: string[] = [];
  if (link) {
    let read: EventImportAnalysis;
    try {
      read = await analyzeEventUrl({ url: link, businessId: null, rateKey: input.rateKey }, deps);
    } catch {
      read = { ok: false, code: "server" };
    }
    if (read.ok && read.kind === "single") {
      const merged = mergeSourceIntoStructured(candidate, read.candidate);
      candidate = merged.candidate;
      differences.push(...merged.differences);
      sourceAttendance = read.candidate.attendance;
      if (sourceAttendance?.cta && sourceAttendance.url && !fields.controls.length) merged.filled.push("RSVP / tickets");
      source = { status: "read", filled: merged.filled };
    } else if (read.ok) {
      source = { status: "several_events", filled: [], detail: "The Event Link lists several Events, so nothing was taken from it." };
    } else {
      source = { status: "failed", filled: [], detail: EVENT_IMPORT_FAILURE_COPY[read.code] };
    }
  }
  candidate = { ...candidate, structured: { ...candidate.structured!, source, notes: [...(candidate.structured?.notes ?? []), ...differences] } };

  const result = await finishEvidenceCandidate(fields, candidate, "text_no_event", null, now, deps);
  if (!result.ok || result.kind !== "single") return result;
  let finished = result.candidate;
  // RSVP / tickets: an explicit structured link wins; else the page's own.
  if (!fields.controls.length && sourceAttendance?.cta && sourceAttendance.url) finished = { ...finished, attendance: sourceAttendance };
  const matches = { ...result.matches };
  if (link && !matches.event) {
    const existing = await deps.findEventBySourceUrl(link).catch(() => null);
    const ev = existing ? await deps.getEvent(existing.id).catch(() => null) : null;
    if (existing && ev) {
      matches.event = {
        id: existing.id,
        name: existing.name,
        slug: ev.slug,
        startAt: existing.startAt,
        venueName: existing.venueName,
        city: existing.city,
        confidence: "strong",
        hostBusinessId: ev.host_business_id,
        hostedByThisBusiness: false,
      };
    }
  }
  const warnings = [...result.warnings];
  if (source.status === "failed" || source.status === "several_events") warnings.push(`Event Link not read: ${source.detail}`);
  return { ok: true, kind: "single", candidate: finished, matches, warnings };
}

export async function analyzeEventImage(
  input: { image: { mediaType: EventImportImageMediaType; base64: string }; businessId: string | null; rateKey: string },
  deps: EventImportDeps
): Promise<EventImportAnalysis> {
  if (!deps.ai) return { ok: false, code: "image_unavailable" };
  if (deps.isRateLimited(input.rateKey)) return { ok: false, code: "rate_limited" };
  const now = deps.now();
  const read = await readEventImageWithAi(input.image, deps.ai);
  if (!read) return { ok: false, code: "image_no_event" };
  if (read.output.multiple_events) return { ok: false, code: "multiple_events" };
  // The image's visible text is the evidence: read deterministically, and
  // every AI value is checked against it.
  const extraction = extractTextEventCandidate(read.visibleText, { now, origin: "image" });
  if (extraction.multipleEvents) return { ok: false, code: "multiple_events" };
  const sanitized = sanitizeEventAiOutput(read.output, read.visibleText, { now, yearHint: extraction.yearHint });
  return finishEvidenceCandidate(extraction, mergeTextAi(extraction.candidate, sanitized), "image_no_event", input.businessId, now, deps);
}

function hiddenVenue(v: ImportedVenue): ImportedVenue {
  return { name: null, address: null, postalCode: null, city: v.city, state: v.state };
}

async function finishEvidenceCandidate(
  extraction: TextExtraction,
  read: EventCandidate,
  failure: EventImportFailure,
  businessId: string | null,
  now: number,
  deps: EventImportDeps
): Promise<EventImportAnalysis> {
  let candidate = read;
  // Attendance + location privacy: the text's own wording and explicit
  // links only (the same reader a web page's text gets) — never the AI.
  const evidence = combineEvidence(structuredAttendance(null, TEXT_BASE), pageRecordAttendance(null), pageAttendance(extraction.controls, extraction.lines, TEXT_BASE));
  const withPlace = { ...candidate, occurrences: candidate.place ? [...candidate.occurrences, { start: "", end: null, hasTime: false, venue: candidate.place, evidence: null }] : candidate.occurrences };
  const locationVisibility = decideLocationVisibility(withPlace, evidence.hiddenLocation);
  candidate = applyLocationVisibility(candidate, locationVisibility);
  if (candidate.place && locationVisibility === "hidden") candidate = { ...candidate, place: hiddenVenue(candidate.place) };
  candidate = { ...candidate, locationVisibility, attendance: decideAttendance(evidence, { lumaEventUrl: null }) };

  const venues = [...candidate.occurrences.map((o) => o.venue), ...(candidate.place ? [candidate.place] : [])];
  const hasPlace = venues.some((v) => venueKey(v) || v.city);
  if (!candidate.title || (candidate.occurrences.length === 0 && !hasPlace)) return { ok: false, code: failure };

  candidate = { ...candidate, occurrences: candidate.occurrences.map((o) => ({ ...o, past: isPastDate(o, now) })) };
  const total = candidate.occurrences.length;
  const pastCount = candidate.occurrences.filter((o) => o.past).length;
  const noun = candidate.origin === "image" ? "image" : "text";
  const warnings: string[] = [];
  if (total > 0 && pastCount === total) warnings.push("That date has already passed.");
  else if (pastCount > 0) warnings.push("Some dates have already passed. Future dates are shown below.");
  if (total === 0) warnings.push("We couldn't find a date. Add it below.");
  if (extraction.unresolvedRanges > 0 && candidate.sources.dates !== "ai") warnings.push("Part of the schedule couldn't be turned into dates. Please add any missing dates.");
  if (candidate.occurrences.some((d) => !d.hasTime)) warnings.push("Some dates don't have a start time. Add it below.");
  if (candidate.occurrences.some((d) => d.hasTime)) warnings.push("Times are shown in Eastern Time. Please check them.");
  if (!hasPlace && locationVisibility !== "hidden") warnings.push("We couldn't find where it's happening. Add the place below.");
  if (locationVisibility === "hidden") warnings.push("The organizer shares the exact location only after registration. Findmi won't show or link an address.");
  if (Object.values(candidate.sources).includes("ai")) warnings.push(`Some details were read from your ${noun} by Findmi. Please check them.`);
  warnings.push(...(candidate.structured?.notes ?? []));

  const matches = await matchCandidate(candidate, businessId, deps);
  candidate = { ...candidate, persistAs: classifyEvidencePersistence(candidate) };
  return { ok: true, kind: "single", candidate, matches, warnings };
}

/** Advisory matching for ONE Event candidate: existing Findmi Event, each
 * distinct place's Location, organizer Business, this Business's existing
 * schedule item. A failure means "no match found", never a blocked import. */
async function matchCandidate(candidate: EventCandidate, businessId: string | null, deps: EventImportDeps): Promise<EventImportMatches> {
  const matches: EventImportMatches = { event: null, locations: [], organizerBusiness: null, existingAppearance: null };
  const first = candidate.occurrences.find((o) => !o.past) ?? candidate.occurrences[0];
  // Each distinct place on the page is looked up once.
  const places = new Map<string, ImportedOccurrence["venue"]>();
  for (const o of candidate.occurrences) {
    const key = venueKey(o.venue);
    if (key && o.venue.name && !places.has(key) && places.size < MAX_PLACE_LOOKUPS) places.set(key, o.venue);
  }
  // Pasted text / an image may state the place without a readable date.
  const placeKey = candidate.place ? venueKey(candidate.place) : "";
  if (candidate.place?.name && placeKey && !places.has(placeKey)) places.set(placeKey, candidate.place);
  const city = candidate.occurrences.find((o) => o.venue.city)?.venue ?? (candidate.place?.city ? candidate.place : null);
  const businessEvidence = candidate.structured?.business ?? candidate.organizer;
  try {
    const [eventMatch, locationLists, organizer, existing] = await Promise.all([
      first ? deps.matchEvent(draftFor(candidate, first)) : Promise.resolve(null),
      Promise.all(
        [...places.entries()].map(async ([key, v]) => {
          const found = await deps
            .matchLocations({ name: v.name!, address: v.address, city: v.city, state: v.state, postal_code: v.postalCode })
            .catch(() => [] as LocationRow[]);
          // Nothing exact → the matcher's possible tier, offered for confirmation only.
          const possible =
            found.length === 0 && deps.matchPossibleLocations ? await deps.matchPossibleLocations({ name: v.name!, state: v.state }).catch(() => [] as LocationRow[]) : [];
          return { key, v, found, possible };
        })
      ),
      // The Business named by the source: an Admin structured "Primary
      // Business:" when given, else the organizer the text names.
      businessEvidence ? deps.matchOrganizer(businessEvidence, city?.city ?? null, city?.state ?? null) : Promise.resolve(null),
      first && businessId ? deps.matchExistingAppearance(businessId, draftFor(candidate, first)) : Promise.resolve(null),
    ]);
    if (eventMatch) {
      const ev = await deps.getEvent(eventMatch.id);
      if (ev) {
        matches.event = {
          id: eventMatch.id,
          name: eventMatch.name,
          slug: ev.slug,
          startAt: eventMatch.start_at,
          venueName: eventMatch.venue_name,
          city: eventMatch.city,
          confidence: eventMatch.confidence,
          hostBusinessId: ev.host_business_id,
          hostedByThisBusiness: Boolean(businessId && ev.host_business_id === businessId),
        };
      }
    }
    for (const { key, v, found, possible } of locationLists) {
      const loc = found[0] ?? possible[0];
      if (!loc) continue;
      // Strong = exactly one exact match, and the page gave more than a bare
      // name to agree with (address, city or postal code). Anything else —
      // including every name-containment match — is shown as a possible
      // match for the person to confirm, never pre-selected.
      const strong = found.length === 1 && Boolean(v.address || v.city || v.postalCode);
      matches.locations.push({ key, id: loc.id, name: loc.name, address: loc.address, city: loc.city, state: loc.state, postalCode: loc.postal_code ?? null, confidence: strong ? "strong" : "possible" });
    }
    matches.organizerBusiness = organizer;
    if (existing && existing.confidence === "strong") matches.existingAppearance = { id: existing.id, title: existing.title, startAt: existing.start_at };
  } catch {
    // Matching is advisory: a failure means "no match found", never a blocked import.
  }

  return matches;
}

/** One Event from a multi-Event source: past flags, its own warnings, its
 * own matches, and retry safety by its own Event link. */
async function analyzeSourceEvent(key: string, raw: EventCandidate, businessId: string | null, now: number, deps: EventImportDeps): Promise<SourceEventAnalysis> {
  const dated: EventCandidate = { ...raw, occurrences: raw.occurrences.map((o) => ({ ...o, past: isPastDate(o, now) })) };
  // A calendar's Event read from page data or its own card with its own
  // Event link is a distinct Event of its own (page-data records ARE
  // structured Event records).
  const candidate: EventCandidate = { ...dated, persistAs: Boolean(dated.title && dated.occurrences.length > 0 && dated.sourceUrl) ? "event" : classifyPersistence(dated, { ownPage: false }) };
  const past = candidate.occurrences.length > 0 && candidate.occurrences.every((o) => o.past);
  const warnings: string[] = [];
  if (candidate.occurrences.length === 0) warnings.push("Add a date.");
  else if (candidate.occurrences.some((o) => !o.hasTime)) warnings.push("Add a start time.");
  if (!candidate.occurrences.some((o) => venueKey(o.venue) || o.venue.city) && !candidate.online) warnings.push("Add the place.");
  if (candidate.online) warnings.push("Online event.");

  const matches = await matchCandidate(candidate, businessId, deps);
  let alreadyOnSchedule: SourceEventAnalysis["alreadyOnSchedule"] = null;
  try {
    if (candidate.sourceUrl) {
      const [scheduled, event] = await Promise.all([
        businessId ? deps.findScheduledBySourceUrl(businessId, candidate.sourceUrl) : Promise.resolve(null),
        matches.event ? Promise.resolve(null) : deps.findEventBySourceUrl(candidate.sourceUrl),
      ]);
      alreadyOnSchedule = scheduled;
      if (event) {
        const ev = await deps.getEvent(event.id);
        if (ev) {
          // Same Event link = the same Event: a strong match.
          matches.event = {
            id: event.id,
            name: event.name,
            slug: ev.slug,
            startAt: event.startAt,
            venueName: event.venueName,
            city: event.city,
            confidence: "strong",
            hostBusinessId: ev.host_business_id,
            hostedByThisBusiness: Boolean(businessId && ev.host_business_id === businessId),
          };
        }
      }
    }
  } catch {
    // advisory only
  }
  if (!alreadyOnSchedule && matches.existingAppearance) alreadyOnSchedule = { title: matches.existingAppearance.title, startAt: matches.existingAppearance.startAt };
  return { key, candidate, matches, warnings, past, alreadyOnSchedule };
}
