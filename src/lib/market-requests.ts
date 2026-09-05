// Consumer Area Picker + Market Requests V1 — shared server-only helpers
// for the market_requests / market_request_interests tables. Plain
// functions taking an already-obtained admin (service-role) client, same
// shape as lib/admin/business-markets.ts — never "use server" here since
// these aren't meant to be called directly from a client component (the
// one public-facing entry point is the "use server" action in
// src/app/(public)/actions/area-requests.ts, which calls into this file).
import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface ConsumerMarketRequestInput {
  text: string;
  city?: string | null;
  state?: string | null;
}

/** Consumer requests are deduped onto ONE pending row per normalized_key
 * — repeat interest in the same geography is recorded via
 * market_request_interests (see recordMarketRequestInterest), never as
 * additional market_requests rows. Returns the request id either way. */
export async function findOrCreateConsumerMarketRequest(
  admin: SupabaseClient,
  input: ConsumerMarketRequestInput
): Promise<string> {
  const normalizedKey = normalizeMarketRequestKey(input.text);
  const { data: existing } = await admin
    .from("market_requests")
    .select("id")
    .eq("source", "consumer")
    .eq("normalized_key", normalizedKey)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await admin
    .from("market_requests")
    .insert({
      requested_text: input.text.trim(),
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      normalized_key: normalizedKey,
      source: "consumer",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create Area request.");
  return data.id;
}

/** One row per distinct person (signed-in user OR email) expressing
 * interest in a pending request — a demand COUNT, never additional
 * pending market_requests rows. 23505 (unique_violation, from the
 * partial unique indexes on (request_id, user_id)/(request_id, email))
 * means this exact person already recorded interest here — a safe,
 * expected no-op, not an error, same idiom as addOccurrenceVendor's own
 * ignoreDuplicates handling elsewhere in this codebase. */
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

/** Business/event creation each get their OWN request row (1:1 with the
 * business/event that couldn't find its Market) — never deduped against
 * a consumer request or another business/event's request, since each
 * one is tied to a real linked record an admin needs to resolve
 * individually. */
export async function createLinkedMarketRequest(
  admin: SupabaseClient,
  input: {
    text: string;
    city?: string | null;
    state?: string | null;
    source: "business_creation" | "event_creation";
    sourceBusinessId?: string | null;
    sourceEventId?: string | null;
  }
): Promise<void> {
  const { error } = await admin.from("market_requests").insert({
    requested_text: input.text.trim(),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    normalized_key: normalizeMarketRequestKey(input.text),
    source: input.source,
    source_business_id: input.sourceBusinessId ?? null,
    source_event_id: input.sourceEventId ?? null,
    status: "pending",
  });
  if (error) throw new Error(error.message);
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
