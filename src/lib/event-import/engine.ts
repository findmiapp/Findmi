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
import { findLikelyDuplicateLocations } from "../locationCreation";
import { findBusinessMatches } from "../business-matching";
import { extractEventCandidate, needsAiAssist, isPastDate } from "./extract";
import { assistWithAi, defaultEventAiClient, type EventAiClient } from "./ai";
import { venueKey, type EventCandidate, type EventImportAnalysis, type EventImportFailure, type EventImportMatches, type ImportedDate, type ImportedOccurrence } from "./types";

/** Distinct places looked up per analysis (each once). */
const MAX_PLACE_LOOKUPS = 15;

export interface EventImportDeps {
  fetchPage: (url: URL) => Promise<SafeFetchResult>;
  ai: EventAiClient | null;
  matchEvent: (draft: AppearanceDraft) => Promise<EventMatchCandidate | null>;
  getEvent: (id: string) => Promise<{ slug: string; host_business_id: string | null } | null>;
  matchLocations: (venue: { name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null }) => Promise<{ id: string; name: string; address: string | null; city: string | null; state: string | null }[]>;
  matchOrganizer: (name: string, city: string | null, state: string | null) => Promise<{ id: string; name: string } | null>;
  matchExistingAppearance: (businessId: string, draft: AppearanceDraft) => Promise<DuplicateCandidate | null>;
  isRateLimited: (key: string) => boolean;
  now: () => number;
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
    matchOrganizer: async (name, city, state) => {
      const matches = await findBusinessMatches(admin, { name, city, state });
      const m = matches.find((x) => x.isPublic && x.reasons.includes("name_location"));
      return m ? { id: m.id, name: m.name } : null;
    },
    matchExistingAppearance: async (businessId, draft) => (await findDuplicateMatches(businessId, [draft]))[0] ?? null,
    isRateLimited: (key) => recordEventImportAnalysis(key),
    now: () => Date.now(),
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

/** NY calendar date for an imported date (date-only values pass through). */
export function nyDateOf(d: ImportedDate): string {
  return d.hasTime ? new Date(d.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : d.start;
}

function draftFor(candidate: EventCandidate, d: ImportedOccurrence): AppearanceDraft {
  return {
    title: candidate.title ?? "",
    date: nyDateOf(d),
    start_time: null,
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
  if (!page.ok) return { ok: false, code: FETCH_FAILURE[page.code] ?? "unreachable" };

  const now = deps.now();
  const extracted = extractEventCandidate(page.html, page.url, now);
  let candidate = extracted.candidate;
  if (needsAiAssist(candidate)) candidate = (await assistWithAi(candidate, extracted.excerpt, deps.ai, { now, yearHint: extracted.yearHint })).candidate;

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
  if (!hasPlace && !candidate.online) warnings.push("We couldn't find where it's happening. Add the place below.");
  if (candidate.online) warnings.push("This looks like an online event.");
  if (Object.values(candidate.sources).includes("ai")) warnings.push("Some details were read from the page text. Please check them.");

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
        [...places.entries()].map(async ([key, v]) => ({
          key,
          v,
          found: await deps
            .matchLocations({ name: v.name!, address: v.address, city: v.city, state: v.state, postal_code: v.postalCode })
            .catch(() => []),
        }))
      ),
      candidate.organizer ? deps.matchOrganizer(candidate.organizer, city?.city ?? null, city?.state ?? null) : Promise.resolve(null),
      first && input.businessId ? deps.matchExistingAppearance(input.businessId, draftFor(candidate, first)) : Promise.resolve(null),
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
          hostedByThisBusiness: Boolean(input.businessId && ev.host_business_id === input.businessId),
        };
      }
    }
    for (const { key, v, found } of locationLists) {
      const loc = found[0];
      if (!loc) continue;
      // Strong = exactly one Location, and the page gave more than a bare
      // name to agree with (address, city or postal code). Otherwise it is
      // shown as a possible match and never pre-selected.
      const strong = found.length === 1 && Boolean(v.address || v.city || v.postalCode);
      matches.locations.push({ key, id: loc.id, name: loc.name, address: loc.address, city: loc.city, state: loc.state, confidence: strong ? "strong" : "possible" });
    }
    matches.organizerBusiness = organizer;
    if (existing && existing.confidence === "strong") matches.existingAppearance = { id: existing.id, title: existing.title, startAt: existing.start_at };
  } catch {
    // Matching is advisory: a failure means "no match found", never a blocked import.
  }

  return { ok: true, candidate, matches, warnings };
}
