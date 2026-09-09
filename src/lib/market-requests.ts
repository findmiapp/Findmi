// Consumer Area Picker + Market Requests V1, extended by the Market ->
// Area/Submarket Hierarchy V2 pass — shared server-only helpers for the
// market_requests / market_request_interests / market_areas tables.
// Plain functions taking an already-obtained admin (service-role)
// client, same shape as lib/admin/business-markets.ts — never
// "use server" here since these aren't meant to be called directly from
// a client component (the one public-facing entry point is the
// "use server" action in src/app/(public)/actions/area-requests.ts,
// which calls into this file).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketRequestResolutionType } from "./types";

const US_STATE_ABBREVIATIONS = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la",
  "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
]);

/** Lightweight grouping/dedup key ONLY — lowercased, punctuation
 * collapsed to spaces, and a trailing US state abbreviation token
 * dropped so "Austin" / "austin" / "Austin, TX" all land on the same
 * key. Never geocoded, never used for automatic Market matching — see
 * this pass's own scope note against building real geography
 * infrastructure. */
export function normalizeMarketRequestKey(raw: string): string {
  const collapsed = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) return collapsed;
  const tokens = collapsed.split(" ");
  if (tokens.length > 1 && US_STATE_ABBREVIATIONS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Plain Levenshtein edit distance — the only "fuzzy" matching this pass
 * uses (per its own explicit "no external geography/geocoding API"
 * scope). Fine for short city/area names against a small (dozens, not
 * millions) candidate set. */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

const FUZZY_MAX_DISTANCE = 2;
const FUZZY_MAX_LENGTH = 24;

function isCloseMatch(query: string, candidate: string): boolean {
  if (!query || !candidate) return false;
  if (query === candidate) return true;
  if (candidate.includes(query) || query.includes(candidate)) return true;
  if (Math.max(query.length, candidate.length) > FUZZY_MAX_LENGTH) return false;
  return levenshtein(query, candidate) <= FUZZY_MAX_DISTANCE;
}

export interface GeographyMatch {
  type: "market" | "area";
  marketId: string;
  marketLabel: string;
  areaId?: string;
  areaLabel?: string;
  /** Full display label, e.g. "Hamptons — Long Island" or "New York City". */
  label: string;
}

type MinimalMarketRow = { id: string; name: string; display_name: string | null; slug: string; areas_included: string[] | null };
type MinimalAreaRow = {
  id: string;
  market_id: string;
  name: string;
  display_name: string | null;
  slug: string;
  aliases: string[] | null;
};

/** Searches BOTH existing Markets and existing Areas/Submarkets for a
 * plausible match to free-typed geography text — exact/substring/close-
 * edit-distance only, never geocoding. Areas are checked first so a
 * precise match (e.g. "Hamptons") wins over a looser match against an
 * unrelated Market's own name/areas_included text. Returns null when
 * nothing plausible is found — callers must never invent geography from
 * a non-match. Considers ALL active rows regardless of consumer_visible
 * (per this pass's own "a legitimate business geography may already
 * exist internally even if not yet consumer-visible" instruction). */
export async function findExistingGeographyMatch(admin: SupabaseClient, text: string): Promise<GeographyMatch | null> {
  const key = normalizeMarketRequestKey(text);
  if (!key) return null;

  const [{ data: marketRows }, { data: areaRows }] = await Promise.all([
    admin.from("markets").select("id, name, display_name, slug, areas_included").eq("active", true),
    admin.from("market_areas").select("id, market_id, name, display_name, slug, aliases").eq("active", true),
  ]);
  const markets = (marketRows ?? []) as MinimalMarketRow[];
  const areas = (areaRows ?? []) as MinimalAreaRow[];
  const marketById = new Map(markets.map((m) => [m.id, m]));

  for (const area of areas) {
    const candidates = [area.name, area.display_name, area.slug, ...(area.aliases ?? [])]
      .filter((v): v is string => Boolean(v))
      .map(normalizeMarketRequestKey);
    if (candidates.some((c) => isCloseMatch(key, c))) {
      const market = marketById.get(area.market_id);
      const marketLabel = market?.display_name || market?.name || "Unknown Market";
      const areaLabel = area.display_name || area.name;
      return { type: "area", marketId: area.market_id, marketLabel, areaId: area.id, areaLabel, label: `${areaLabel} — ${marketLabel}` };
    }
  }

  for (const market of markets) {
    const candidates = [market.name, market.display_name, market.slug, ...(market.areas_included ?? [])]
      .filter((v): v is string => Boolean(v))
      .map(normalizeMarketRequestKey);
    if (candidates.some((c) => isCloseMatch(key, c))) {
      const label = market.display_name || market.name;
      return { type: "market", marketId: market.id, marketLabel: label, label };
    }
  }

  return null;
}

export interface ConsumerMarketRequestInput {
  text: string;
  city?: string | null;
  state?: string | null;
}

export interface ConsumerMarketRequestResult {
  requestId: string;
  /** Non-null when the request auto-resolved onto existing geography
   * (see below) — the caller uses this to show an honest "this Area
   * already exists" message rather than a generic "you're on the list". */
  match: GeographyMatch | null;
  /** Admin Action Email Notifications V1 — true only when this call
   * actually inserted a brand-new market_requests row (never true for
   * the `existing` dedup branch below, which reuses an already-recorded
   * request). Combined with `match === null` (status='pending', not the
   * auto-resolved 'mapped' case), this is exactly "a new request now
   * needs founder review" — what the caller uses to decide whether to
   * fire a notification, without re-deriving this dedup logic itself. */
  created: boolean;
}

/** Consumer requests are deduped onto ONE row per EFFECTIVE normalized
 * key — repeat interest in the same geography is recorded via
 * market_request_interests (see recordMarketRequestInterest), never as
 * additional market_requests rows.
 *
 * Market -> Area/Submarket Hierarchy V2 — before creating a new pending
 * row, this checks for an existing Market/Area match (findExistingGeographyMatch).
 * A match means the geography already exists, so the row is created (or
 * reused) already RESOLVED (status='mapped', mapped_market_id/
 * mapped_area_id/resolution_type set, reviewed_at stamped) instead of
 * 'pending' — no admin action needed, no duplicate Market/Area risk, and
 * the interest record still has a real request to attach to for a future
 * notification pass. Genuinely unmatched geography still creates a
 * normal pending row exactly as V1 did. */
export async function findOrCreateConsumerMarketRequest(
  admin: SupabaseClient,
  input: ConsumerMarketRequestInput
): Promise<ConsumerMarketRequestResult> {
  const match = await findExistingGeographyMatch(admin, input.text);
  const effectiveKey = match ? normalizeMarketRequestKey(match.type === "area" ? match.areaLabel! : match.marketLabel) : normalizeMarketRequestKey(input.text);

  const { data: existing } = await admin
    .from("market_requests")
    .select("id")
    .eq("source", "consumer")
    .eq("effective_normalized_key", effectiveKey)
    .neq("status", "rejected")
    .maybeSingle();
  if (existing) return { requestId: existing.id, match, created: false };

  const resolutionType: MarketRequestResolutionType | null = match ? (match.type === "area" ? "existing_area" : "existing_market") : null;
  const { data, error } = await admin
    .from("market_requests")
    .insert({
      requested_text: input.text.trim(),
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      normalized_key: normalizeMarketRequestKey(input.text),
      effective_normalized_key: effectiveKey,
      source: "consumer",
      status: match ? "mapped" : "pending",
      mapped_market_id: match?.marketId ?? null,
      mapped_area_id: match?.areaId ?? null,
      resolution_type: resolutionType,
      reviewed_at: match ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create Area request.");
  return { requestId: data.id, match, created: true };
}

/** One row per distinct person (signed-in user OR email) expressing
 * interest in a request — a demand COUNT, never additional
 * market_requests rows. 23505 (unique_violation, from the partial unique
 * indexes on (request_id, user_id)/(request_id, email)) means this exact
 * person already recorded interest here — a safe, expected no-op, not an
 * error, same idiom as addOccurrenceVendor's own ignoreDuplicates
 * handling elsewhere in this codebase. Recorded the same way whether the
 * request ended up 'pending' or auto-resolved to 'mapped' — either way
 * this person should hear about it once the geography is truly live. */
export async function recordMarketRequestInterest(
  admin: SupabaseClient,
  input: { requestId: string; userId?: string | null; email?: string | null }
): Promise<void> {
  const { error } = await admin.from("market_request_interests").insert({
    request_id: input.requestId,
    user_id: input.userId ?? null,
    email: input.email ?? null,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export interface LinkedMarketRequestInput {
  text: string;
  city?: string | null;
  state?: string | null;
  source: "business_creation" | "event_creation" | "location_creation";
  sourceBusinessId?: string | null;
  sourceEventId?: string | null;
  sourceLocationId?: string | null;
}

/** Business/event/location creation each get their OWN request row (1:1
 * with the business/event/location that couldn't find its Market) —
 * never deduped against a consumer request or another entity's request,
 * since each one is tied to a real linked record an admin needs to
 * resolve individually. Callers (createMemberBusiness, saveEvent,
 * createMemberLocation) are expected to have ALREADY checked
 * findExistingGeographyMatch themselves and used the match directly when
 * found — this function is only reached for genuinely unmatched
 * geography, so it always creates a plain 'pending' row. */
export interface LinkedMarketRequestResult {
  /** Admin Action Email Notifications V1 — smallest possible signal so a
   * caller can decide whether to fire a "new Market/Area request" alert:
   * true on a successful insert (this function has no dedup of its own —
   * see its own doc comment above — so every successful call creates a
   * genuinely new pending row), false only if the insert failed. */
  created: boolean;
  requestId: string | null;
}

export async function createLinkedMarketRequest(
  admin: SupabaseClient,
  input: LinkedMarketRequestInput
): Promise<LinkedMarketRequestResult> {
  const normalizedKey = normalizeMarketRequestKey(input.text);
  const { data, error } = await admin
    .from("market_requests")
    .insert({
      requested_text: input.text.trim(),
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      normalized_key: normalizedKey,
      effective_normalized_key: normalizedKey,
      source: input.source,
      source_business_id: input.sourceBusinessId ?? null,
      source_event_id: input.sourceEventId ?? null,
      source_location_id: input.sourceLocationId ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { created: true, requestId: data?.id ?? null };
}

/** Whether this business currently has an unresolved (pending) Market
 * Request linked to it — used by Business Manager to show "Primary
 * Market: Pending review — <text>" instead of a bare "Not assigned yet"
 * when the business was created via the requested-Market path. */
export async function getPendingMarketRequestForBusiness(
  admin: SupabaseClient,
  businessId: string
): Promise<{ requestedText: string } | null> {
  const { data } = await admin
    .from("market_requests")
    .select("requested_text")
    .eq("source_business_id", businessId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { requestedText: data.requested_text } : null;
}

/** Event-side counterpart to getPendingMarketRequestForBusiness above —
 * identical shape/reasoning, just source_event_id instead of
 * source_business_id. Used by Event Manager's Market/Area tab so an event
 * created via a requested (unmatched) Market shows "Pending review —
 * <text>" instead of a bare "Not assigned yet". */
export async function getPendingMarketRequestForEvent(
  admin: SupabaseClient,
  eventId: string
): Promise<{ requestedText: string } | null> {
  const { data } = await admin
    .from("market_requests")
    .select("requested_text")
    .eq("source_event_id", eventId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { requestedText: data.requested_text } : null;
}

/** Location-side counterpart to getPendingMarketRequestForBusiness/
 * getPendingMarketRequestForEvent above — identical shape/reasoning, just
 * source_location_id. Used by Location Manager's Market/Area tab. */
export async function getPendingMarketRequestForLocation(
  admin: SupabaseClient,
  locationId: string
): Promise<{ requestedText: string } | null> {
  const { data } = await admin
    .from("market_requests")
    .select("requested_text")
    .eq("source_location_id", locationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { requestedText: data.requested_text } : null;
}
