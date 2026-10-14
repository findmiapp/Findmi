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
import { extractEventCandidate, needsAiAssist, isPastDate } from "./extract";
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
import { assistWithAi, defaultEventAiClient, type EventAiClient } from "./ai";
import {
  venueKey,
  type EventCandidate,
  type EventImportAnalysis,
  type EventImportFailure,
  type EventImportMatches,
  type ImportedDate,
  type ImportedOccurrence,
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

  const matches = await matchCandidate(candidate, input.businessId, deps);
  candidate = { ...candidate, persistAs: classifyPersistence(candidate, { ownPage: true }) };

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
  const city = candidate.occurrences.find((o) => o.venue.city)?.venue ?? null;
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
      candidate.organizer ? deps.matchOrganizer(candidate.organizer, city?.city ?? null, city?.state ?? null) : Promise.resolve(null),
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
