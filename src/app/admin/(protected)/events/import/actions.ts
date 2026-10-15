"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { analyzeEventText, analyzeEventUrl, defaultEventImportDeps, type EventImportDeps } from "@/lib/event-import/engine";
import { findBusinessMatches } from "@/lib/business-matching";
import { insertInlineBusiness, type InlineBusinessResult } from "@/lib/admin/inline-business";
import { publicImportAnalysis } from "@/lib/event-import/diagnostics";
import { asOperatorAnalysis } from "@/lib/event-import/operator";
import { normalizeReview, persistDiscoveryEvent, type SourceEventDeps } from "@/lib/event-import/persist";
import type { EventImportAnalysis, EventImportOutcome, EventImportReview } from "@/lib/event-import/types";
import { recoverEventImage } from "@/lib/event-import/media";
import { insertInlinePlace } from "@/lib/places/inline-place";
import type { CreateInlineLocationResult } from "@/lib/locationCreation";
import { findExistingGeographyMatch } from "@/lib/market-requests";
import { ensureUniqueSlug, resolveSlugInput } from "@/lib/slug";
import { isSlugTaken } from "@/lib/admin/queries";
import { propagateAllDatesParticipation } from "@/lib/appearance-event-sync";

/** Admin Event Import — the OPERATOR entry to the one Event Import engine
 * (lib/event-import). Every action independently verifies the founder
 * Admin session (requireAdminSupabase — the same check middleware does)
 * before any read or write; Business membership is never involved, and
 * the Business importer's own authorization is untouched. There is no
 * initiating Business: analysis runs with businessId null, and each Event
 * is saved with its OWN reviewed Business (or none) — see
 * persistDiscoveryEvent. */

/** One shared analysis rate-limit bucket for the founder Admin session. */
const ADMIN_RATE_KEY = "admin:event-import";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminClient(): Promise<SupabaseClient | null> {
  try {
    return await requireAdminSupabase();
  } catch {
    return null;
  }
}

/** The engine's dependencies for an operator import: the shared ones, with
 * Business matching widened to what Admin may see. The source's Business
 * name is suggested only when exactly ONE real Business has that exact
 * name (live or pending review — never demo, archived or trashed);
 * anything ambiguous stays unresolved for the operator. */
function operatorDeps(admin: SupabaseClient): EventImportDeps {
  return {
    ...defaultEventImportDeps(admin),
    matchOrganizer: async (name, city, state) => {
      const exact = (await findBusinessMatches(admin, { name, city, state })).filter((m) => m.reasons.includes("name_location"));
      if (exact.length !== 1) return null;
      const { data } = await admin.from("businesses").select("id, name, archived_at, trashed_at").eq("id", exact[0].id).maybeSingle();
      const row = data as { id: string; name: string; archived_at: string | null; trashed_at: string | null } | null;
      return row && !row.archived_at && !row.trashed_at ? { id: row.id, name: row.name } : null;
    },
  };
}

/** Paste Details (one Event, or several explicitly marked Events; blocks
 * in the structured "Event Name: …" syntax are read field by field). Writes nothing. */
export async function adminAnalyzeEventText(text: string): Promise<EventImportAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "server" };
  try {
    const result = await analyzeEventText({ text: typeof text === "string" ? text : "", businessId: null, rateKey: ADMIN_RATE_KEY, structured: true }, operatorDeps(admin));
    return publicImportAnalysis(asOperatorAnalysis(result, { url: "", name: "Pasted Details", platform: null }));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** From Link — the same engine and safe fetch as every importer. Writes nothing. */
export async function adminAnalyzeEventUrl(url: string): Promise<EventImportAnalysis> {
  const admin = await adminClient();
  if (!admin) return { ok: false, code: "server" };
  try {
    const link = typeof url === "string" ? url.trim() : "";
    const result = await analyzeEventUrl({ url: link, businessId: null, rateKey: ADMIN_RATE_KEY }, operatorDeps(admin));
    return publicImportAnalysis(asOperatorAnalysis(result, { url: link, name: null, platform: null }));
  } catch {
    return { ok: false, code: "server" };
  }
}

/** Missing-Location Quick Create for Admin — the SAME creation rules as the
 * member-facing createInlinePlace (lib/places/inline-place.ts: address
 * required, duplicate check unless forced, unlisted, no membership),
 * authorized by the Admin session instead of Business membership. */
export async function adminCreateImportLocation(formData: FormData): Promise<CreateInlineLocationResult> {
  const admin = await adminClient();
  if (!admin) return { status: "error", error: "Your Admin session has ended. Sign in again." };
  return insertInlinePlace(admin, formData);
}

/** Missing-Business Quick Create — only on the operator's explicit action
 * in Review (never from text alone). See lib/admin/inline-business.ts:
 * pending review, no owner / membership / claim / Pro / verification, and
 * no Event link until that reviewed Event is saved. */
export async function adminCreateImportBusiness(formData: FormData): Promise<InlineBusinessResult> {
  const admin = await adminClient();
  if (!admin) return { status: "error", error: "Your Admin session has ended. Sign in again." };
  try {
    return await insertInlineBusiness(admin, { name: formData.get("name"), websiteUrl: formData.get("website_url"), force: formData.get("force") === "1" });
  } catch {
    return { status: "error", error: "Couldn't add this Business. Please try again." };
  }
}

function discoveryDeps(admin: SupabaseClient): SourceEventDeps {
  return {
    admin,
    storeImage: async (url) => {
      const stored = await recoverEventImage(admin, url);
      return stored.ok ? stored.url : null;
    },
    geography: async (text) => {
      const match = await findExistingGeographyMatch(admin, text);
      return match ? { marketId: match.marketId, areaId: match.areaId ?? null } : null;
    },
    uniqueEventSlug: async (title) => {
      const base = resolveSlugInput(null, title);
      return base ? ensureUniqueSlug(base, (candidate) => isSlugTaken("events", candidate)) : null;
    },
    propagateDates: (eventId, ids) => propagateAllDatesParticipation(admin, eventId, ids),
    findEventBySourceUrl: async (url) => {
      const { data } = await admin
        .from("events")
        .select("id")
        .eq("external_url", url)
        .is("trashed_at", null)
        .is("archived_at", null)
        .neq("publication_status", "rejected")
        .limit(1);
      return ((data ?? []) as { id: string }[])[0] ?? null;
    },
  };
}

const BATCH_MAX = 40;

/** Save reviewed Events — each validated and saved on its own (one that
 * fails never blocks the others). Every Event is a host-less source Event;
 * its Business (if any) is the one the operator reviewed for THAT Event,
 * re-checked here as a real Business. */
export async function adminCommitEventImportBatch(
  items: { review: EventImportReview; businessId: string | null }[]
): Promise<{ ok: true; results: { title: string; outcome: EventImportOutcome }[] } | { ok: false; error: string }> {
  const admin = await adminClient();
  if (!admin) return { ok: false, error: "Your Admin session has ended. Sign in again." };
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "Choose at least one Event." };
  if (items.length > BATCH_MAX) return { ok: false, error: `Add up to ${BATCH_MAX} Events at a time.` };
  const deps = discoveryDeps(admin);
  const results: { title: string; outcome: EventImportOutcome }[] = [];
  for (const item of items) {
    const review = item?.review;
    const title = typeof review?.title === "string" ? review.title : "";
    results.push({ title, outcome: await commitOne(admin, deps, review, item?.businessId ?? null) });
  }
  if (results.some((r) => r.outcome.ok)) {
    revalidatePath("/admin/events");
    revalidatePath("/events");
  }
  return { ok: true, results };
}

async function commitOne(admin: SupabaseClient, deps: SourceEventDeps, review: EventImportReview | undefined, businessId: string | null): Promise<EventImportOutcome> {
  if (!review || typeof review !== "object") return { ok: false, error: "Add the event's name." };
  // Operator imports are always genuine source Events — never hosted.
  const normalized = normalizeReview({ ...review, intent: "participating", asEvent: true });
  if (!normalized.ok) return normalized;
  let business: string | null = null;
  if (businessId) {
    if (typeof businessId !== "string" || !UUID.test(businessId)) return { ok: false, error: "That Business isn't on Findmi." };
    const { data } = await admin.from("businesses").select("id").eq("id", businessId).maybeSingle();
    if (!data) return { ok: false, error: "That Business isn't on Findmi." };
    business = businessId;
  }
  try {
    return await persistDiscoveryEvent(normalized.value, business, deps);
  } catch {
    return { ok: false, error: "Couldn't save it. Please try again." };
  }
}
